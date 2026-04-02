use super::*;

impl Workspace {
    pub fn save_snapshot(&mut self, label: Option<String>) -> Result<SnapshotRecord> {
        let snapshot_id = Uuid::new_v4().to_string();
        let file_name = format!("{snapshot_id}.json");
        let snapshot_path = self.paths.snapshots_dir.join(&file_name);
        let state = self.snapshot_state()?;
        let state_json = serde_json::to_string_pretty(&state)?;
        std::fs::write(&snapshot_path, state_json.as_bytes())
            .with_context(|| format!("failed to write {}", snapshot_path.display()))?;

        let created_at = timestamp_now();
        let insert_result = self.conn.execute(
            "INSERT INTO snapshots (id, label, state_json, file_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![snapshot_id, label, state_json, file_name, created_at],
        );

        if let Err(err) = insert_result {
            let _ = std::fs::remove_file(&snapshot_path);
            return Err(err.into());
        }

        Ok(SnapshotRecord {
            id: snapshot_id,
            label,
            file_name,
            created_at,
        })
    }

    pub fn list_snapshots(&self) -> Result<Vec<SnapshotRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, file_name, created_at
             FROM snapshots
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SnapshotRecord {
                id: row.get(0)?,
                label: row.get(1)?,
                file_name: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;

        let mut snapshots = Vec::new();
        for snapshot in rows {
            snapshots.push(snapshot?);
        }
        Ok(snapshots)
    }

    pub fn restore_snapshot(&mut self, snapshot_id: &str) -> Result<()> {
        let snapshot = self
            .load_snapshot_state(snapshot_id)?
            .with_context(|| format!("snapshot {snapshot_id} was not found"))?;
        let safety_label = format!("auto-before-restore-{snapshot_id}");
        self.save_snapshot(Some(safety_label))?;

        let transaction = self.conn.transaction()?;
        transaction.execute("DELETE FROM source_chunks", [])?;
        transaction.execute("DELETE FROM sources", [])?;
        transaction.execute("DELETE FROM nodes", [])?;
        transaction.execute("DELETE FROM metadata", [])?;

        for (key, value) in snapshot.metadata {
            transaction.execute(
                "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }

        for node in sort_nodes_for_restore(snapshot.nodes)? {
            transaction.execute(
                "INSERT INTO nodes (id, parent_id, title, body, kind, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    node.id,
                    node.parent_id,
                    node.title,
                    node.body,
                    node.kind,
                    node.position,
                    node.created_at,
                    node.updated_at
                ],
            )?;
        }

        for source in snapshot.sources {
            transaction.execute(
                "INSERT INTO sources (id, original_path, original_name, stored_name, format, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    source.id,
                    source.original_path,
                    source.original_name,
                    source.stored_name,
                    source.format,
                    source.imported_at
                ],
            )?;
        }

        for chunk in snapshot.source_chunks {
            transaction.execute(
                "INSERT INTO source_chunks (id, source_id, ordinal, label, text, start_line, end_line)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    chunk.id,
                    chunk.source_id,
                    chunk.ordinal,
                    chunk.label,
                    chunk.text,
                    chunk.start_line,
                    chunk.end_line
                ],
            )?;
        }

        for node_source in snapshot.node_sources {
            transaction.execute(
                "INSERT INTO node_sources (node_id, source_id) VALUES (?1, ?2)",
                params![node_source.node_id, node_source.source_id],
            )?;
        }

        for node_source_chunk in snapshot.node_source_chunks {
            transaction.execute(
                "INSERT INTO node_source_chunks (node_id, chunk_id) VALUES (?1, ?2)",
                params![node_source_chunk.node_id, node_source_chunk.chunk_id],
            )?;
        }

        for node_evidence_chunk in snapshot.node_evidence_chunks {
            transaction.execute(
                "INSERT INTO node_evidence_chunks (node_id, chunk_id, citation_kind, rationale) VALUES (?1, ?2, ?3, ?4)",
                params![
                    node_evidence_chunk.node_id,
                    node_evidence_chunk.chunk_id,
                    node_evidence_chunk.citation_kind,
                    node_evidence_chunk.rationale
                ],
            )?;
        }

        transaction.commit()?;
        Ok(())
    }

    pub(super) fn snapshot_state(&self) -> Result<SnapshotState> {
        Ok(SnapshotState {
            metadata: self.all_metadata()?,
            nodes: self.list_nodes()?,
            sources: self.list_sources()?,
            node_sources: self.list_node_sources()?,
            source_chunks: self.list_source_chunks()?,
            node_source_chunks: self.list_node_source_chunks()?,
            node_evidence_chunks: self.list_node_evidence_chunks()?,
        })
    }

    pub(super) fn load_snapshot_state(&self, snapshot_id: &str) -> Result<Option<SnapshotState>> {
        let state_json: Option<String> = self
            .conn
            .query_row(
                "SELECT state_json FROM snapshots WHERE id = ?1",
                [snapshot_id],
                |row| row.get(0),
            )
            .optional()?;
        match state_json {
            Some(state_json) => Ok(Some(serde_json::from_str(&state_json)?)),
            None => Ok(None),
        }
    }
}

fn sort_nodes_for_restore(nodes: Vec<Node>) -> Result<Vec<Node>> {
    fn visit(
        node_id: &str,
        nodes_by_id: &HashMap<String, Node>,
        visiting: &mut HashMap<String, bool>,
        ordered: &mut Vec<Node>,
    ) -> Result<()> {
        if ordered.iter().any(|node| node.id == node_id) {
            return Ok(());
        }
        if visiting.get(node_id).copied().unwrap_or(false) {
            bail!("cycle detected while restoring snapshot around node {node_id}");
        }

        let node = nodes_by_id
            .get(node_id)
            .with_context(|| format!("node {node_id} missing during snapshot restore"))?;
        visiting.insert(node_id.to_string(), true);
        if let Some(parent_id) = node.parent_id.as_deref()
            && nodes_by_id.contains_key(parent_id)
        {
            visit(parent_id, nodes_by_id, visiting, ordered)?;
        }
        visiting.remove(node_id);
        ordered.push(node.clone());
        Ok(())
    }

    let nodes_by_id = nodes
        .into_iter()
        .map(|node| (node.id.clone(), node))
        .collect::<HashMap<_, _>>();
    let mut ordered = Vec::new();
    let mut visiting = HashMap::new();
    let mut ids = nodes_by_id.keys().cloned().collect::<Vec<_>>();
    ids.sort();
    for id in ids {
        visit(&id, &nodes_by_id, &mut visiting, &mut ordered)?;
    }
    Ok(ordered)
}
