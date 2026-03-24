use super::queries::read_node;
use super::*;

impl Workspace {
    pub fn add_node(
        &mut self,
        title: String,
        parent_id: String,
        kind: String,
        body: Option<String>,
        position: Option<i64>,
    ) -> Result<ApplyPatchReport> {
        let patch = PatchDocument {
            version: 1,
            summary: Some(format!("Add node \"{title}\"")),
            ops: vec![PatchOp::AddNode {
                id: None,
                parent_id,
                title,
                kind: Some(kind),
                body,
                position,
            }],
        };
        self.apply_patch_document(patch, "cli", false)
    }

    pub fn update_node(
        &mut self,
        id: String,
        title: Option<String>,
        body: Option<String>,
        kind: Option<String>,
    ) -> Result<ApplyPatchReport> {
        let patch = PatchDocument {
            version: 1,
            summary: Some(format!("Update node {id}")),
            ops: vec![PatchOp::UpdateNode {
                id,
                title,
                body,
                kind,
            }],
        };
        self.apply_patch_document(patch, "cli", false)
    }

    pub fn move_node(
        &mut self,
        id: String,
        parent_id: String,
        position: Option<i64>,
    ) -> Result<ApplyPatchReport> {
        let patch = PatchDocument {
            version: 1,
            summary: Some(format!("Move node {id}")),
            ops: vec![PatchOp::MoveNode {
                id,
                parent_id,
                position,
            }],
        };
        self.apply_patch_document(patch, "cli", false)
    }

    pub fn delete_node(&mut self, id: String) -> Result<ApplyPatchReport> {
        let patch = PatchDocument {
            version: 1,
            summary: Some(format!("Delete node {id}")),
            ops: vec![PatchOp::DeleteNode { id }],
        };
        self.apply_patch_document(patch, "cli", false)
    }

    pub fn apply_patch_document(
        &mut self,
        patch: PatchDocument,
        origin: &str,
        dry_run: bool,
    ) -> Result<ApplyPatchReport> {
        let patch = self.prepare_patch_document(patch)?;
        let preview = patch.preview_lines();

        if dry_run {
            return Ok(ApplyPatchReport {
                run_id: None,
                summary: patch.summary.clone(),
                preview,
            });
        }

        let archive = write_patch_archive(&self.paths, &patch)?;
        let transaction = self.conn.transaction()?;
        let apply_result = (|| -> Result<()> {
            apply_patch_ops_tx(&transaction, &patch.ops)?;
            insert_patch_run_tx(&transaction, &archive, patch.summary.as_ref(), origin)?;
            Ok(())
        })();

        if let Err(err) = apply_result {
            let _ = std::fs::remove_file(&archive.run_path);
            return Err(err);
        }

        if let Err(err) = transaction.commit() {
            let _ = std::fs::remove_file(&archive.run_path);
            return Err(err.into());
        }

        Ok(ApplyPatchReport {
            run_id: Some(archive.run_id),
            summary: patch.summary,
            preview,
        })
    }

    pub fn patch_history(&self) -> Result<Vec<PatchRunRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, summary, origin, file_name, applied_at
             FROM patch_runs
             ORDER BY applied_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PatchRunRecord {
                id: row.get(0)?,
                summary: row.get(1)?,
                origin: row.get(2)?,
                file_name: row.get(3)?,
                applied_at: row.get(4)?,
            })
        })?;

        let mut records = Vec::new();
        for record in rows {
            records.push(record?);
        }
        Ok(records)
    }

    pub fn patch_document_by_run_id(&self, run_id: &str) -> Result<PatchDocument> {
        let patch_json: Option<String> = self
            .conn
            .query_row(
                "SELECT patch_json FROM patch_runs WHERE id = ?1",
                [run_id],
                |row| row.get(0),
            )
            .optional()?;
        let patch_json = patch_json.with_context(|| format!("patch run {run_id} was not found"))?;
        Ok(serde_json::from_str(&patch_json)?)
    }

    pub(super) fn prepare_patch_document(&self, patch: PatchDocument) -> Result<PatchDocument> {
        self.prepare_patch_document_with_context(patch, PatchValidationContext::default())
    }

    pub(super) fn prepare_patch_document_with_context(
        &self,
        patch: PatchDocument,
        validation_context: PatchValidationContext,
    ) -> Result<PatchDocument> {
        if patch.version != 1 {
            bail!("unsupported patch version {}; expected 1", patch.version);
        }
        if patch.ops.is_empty() {
            bail!("patch must contain at least one operation");
        }

        let patch = patch.resolved();
        self.validate_patch(&patch, &validation_context)?;
        Ok(patch)
    }

    fn validate_patch(
        &self,
        patch: &PatchDocument,
        validation_context: &PatchValidationContext,
    ) -> Result<()> {
        let root_id = self.root_id()?;
        let mut state = SimulatedWorkspaceState::from_workspace(
            root_id,
            self.list_nodes()?,
            self.list_sources()?,
            self.list_source_chunks()?,
            self.list_node_sources()?,
            self.list_node_source_chunks()?,
            validation_context,
        );
        for (index, op) in patch.ops.iter().enumerate() {
            state
                .validate_and_apply(op)
                .map_err(|err| wrap_patch_op_error(index, op, err))?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub(super) struct PatchValidationContext {
    pub(super) source_ids: HashSet<String>,
    pub(super) chunk_source_ids: HashMap<String, String>,
}

struct SimulatedWorkspaceState {
    root_id: String,
    parent_ids: HashMap<String, Option<String>>,
    source_ids: HashSet<String>,
    chunk_source_ids: HashMap<String, String>,
    node_sources: HashSet<(String, String)>,
    node_source_chunks: HashSet<(String, String)>,
}

pub(super) struct PatchArchive {
    pub(super) run_id: String,
    pub(super) file_name: String,
    pub(super) patch_json: String,
    pub(super) applied_at: i64,
    pub(super) run_path: PathBuf,
}

impl SimulatedWorkspaceState {
    fn from_workspace(
        root_id: String,
        nodes: Vec<Node>,
        sources: Vec<SourceRecord>,
        source_chunks: Vec<SourceChunkRecord>,
        node_sources: Vec<NodeSourceRecord>,
        node_source_chunks: Vec<NodeSourceChunkRecord>,
        validation_context: &PatchValidationContext,
    ) -> Self {
        let parent_ids = nodes
            .into_iter()
            .map(|node| (node.id, node.parent_id))
            .collect::<HashMap<_, _>>();
        let mut source_ids = sources
            .into_iter()
            .map(|source| source.id)
            .collect::<HashSet<_>>();
        source_ids.extend(validation_context.source_ids.iter().cloned());

        let mut chunk_source_ids = source_chunks
            .into_iter()
            .map(|chunk| (chunk.id, chunk.source_id))
            .collect::<HashMap<_, _>>();
        chunk_source_ids.extend(
            validation_context
                .chunk_source_ids
                .iter()
                .map(|(chunk_id, source_id)| (chunk_id.clone(), source_id.clone())),
        );

        let node_sources = node_sources
            .into_iter()
            .map(|link| (link.node_id, link.source_id))
            .collect::<HashSet<_>>();
        let node_source_chunks = node_source_chunks
            .into_iter()
            .map(|link| (link.node_id, link.chunk_id))
            .collect::<HashSet<_>>();
        Self {
            root_id,
            parent_ids,
            source_ids,
            chunk_source_ids,
            node_sources,
            node_source_chunks,
        }
    }

    fn validate_and_apply(&mut self, op: &PatchOp) -> Result<()> {
        match op {
            PatchOp::AddNode {
                id,
                parent_id,
                position,
                ..
            } => {
                let node_id = id
                    .as_deref()
                    .context("resolved add_node operation is missing an id")?;
                if self.parent_ids.contains_key(node_id) {
                    bail!("cannot add node {node_id}: a node with that id already exists");
                }
                if !self.parent_ids.contains_key(parent_id) {
                    bail!("cannot add node {node_id}: parent {parent_id} was not found");
                }
                validate_position(*position)?;
                self.parent_ids
                    .insert(node_id.to_string(), Some(parent_id.clone()));
            }
            PatchOp::UpdateNode {
                id,
                title,
                body,
                kind,
            } => {
                if !self.parent_ids.contains_key(id) {
                    bail!("cannot update node {id}: node was not found");
                }
                if title.is_none() && body.is_none() && kind.is_none() {
                    bail!("cannot update node {id}: provide at least one field to change");
                }
            }
            PatchOp::MoveNode {
                id,
                parent_id,
                position,
            } => {
                if id == &self.root_id {
                    bail!("cannot move the root node");
                }
                if !self.parent_ids.contains_key(id) {
                    bail!("cannot move node {id}: node was not found");
                }
                if !self.parent_ids.contains_key(parent_id) {
                    bail!("cannot move node {id}: parent {parent_id} was not found");
                }
                self.ensure_move_is_acyclic(id, parent_id)?;
                validate_position(*position)?;
                self.parent_ids.insert(id.clone(), Some(parent_id.clone()));
            }
            PatchOp::DeleteNode { id } => {
                if id == &self.root_id {
                    bail!("cannot delete the root node");
                }
                if !self.parent_ids.contains_key(id) {
                    bail!("cannot delete node {id}: node was not found");
                }
                self.delete_subtree(id);
            }
            PatchOp::AttachSource { node_id, source_id } => {
                if !self.parent_ids.contains_key(node_id) {
                    bail!("cannot attach source {source_id} to node {node_id}: node was not found");
                }
                if !self.source_ids.contains(source_id) {
                    bail!(
                        "cannot attach source {source_id} to node {node_id}: source was not found"
                    );
                }
                if !self
                    .node_sources
                    .insert((node_id.clone(), source_id.clone()))
                {
                    bail!(
                        "cannot attach source {source_id} to node {node_id}: link already exists"
                    );
                }
            }
            PatchOp::AttachSourceChunk { node_id, chunk_id } => {
                if !self.parent_ids.contains_key(node_id) {
                    bail!(
                        "cannot attach source chunk {chunk_id} to node {node_id}: node was not found"
                    );
                }
                let source_id = self.chunk_source_ids.get(chunk_id).with_context(|| {
                    format!(
                        "cannot attach source chunk {chunk_id} to node {node_id}: chunk was not found"
                    )
                })?;
                if !self
                    .node_sources
                    .contains(&(node_id.clone(), source_id.clone()))
                {
                    bail!(
                        "cannot attach source chunk {chunk_id} to node {node_id}: attach source {source_id} first"
                    );
                }
                if !self
                    .node_source_chunks
                    .insert((node_id.clone(), chunk_id.clone()))
                {
                    bail!(
                        "cannot attach source chunk {chunk_id} to node {node_id}: link already exists"
                    );
                }
            }
            PatchOp::DetachSource { node_id, source_id } => {
                if !self.parent_ids.contains_key(node_id) {
                    bail!(
                        "cannot detach source {source_id} from node {node_id}: node was not found"
                    );
                }
                if !self
                    .node_sources
                    .contains(&(node_id.clone(), source_id.clone()))
                {
                    bail!(
                        "cannot detach source {source_id} from node {node_id}: link was not found"
                    );
                }
                if self
                    .node_source_chunks
                    .iter()
                    .any(|(current_node_id, chunk_id)| {
                        current_node_id == node_id
                            && self
                                .chunk_source_ids
                                .get(chunk_id)
                                .is_some_and(|current_source_id| current_source_id == source_id)
                    })
                {
                    bail!(
                        "cannot detach source {source_id} from node {node_id}: detach linked source chunks first"
                    );
                }
                self.node_sources
                    .remove(&(node_id.clone(), source_id.clone()));
            }
            PatchOp::DetachSourceChunk { node_id, chunk_id } => {
                if !self.parent_ids.contains_key(node_id) {
                    bail!(
                        "cannot detach source chunk {chunk_id} from node {node_id}: node was not found"
                    );
                }
                if !self.chunk_source_ids.contains_key(chunk_id) {
                    bail!(
                        "cannot detach source chunk {chunk_id} from node {node_id}: chunk was not found"
                    );
                }
                if !self
                    .node_source_chunks
                    .remove(&(node_id.clone(), chunk_id.clone()))
                {
                    bail!(
                        "cannot detach source chunk {chunk_id} from node {node_id}: link was not found"
                    );
                }
            }
        }
        Ok(())
    }

    fn ensure_move_is_acyclic(&self, node_id: &str, new_parent_id: &str) -> Result<()> {
        if node_id == new_parent_id {
            bail!("cannot move node {node_id} under itself");
        }

        let mut cursor = Some(new_parent_id.to_string());
        while let Some(current) = cursor {
            if current == node_id {
                bail!("cannot move node {node_id}: that would create a cycle");
            }
            cursor = self.parent_ids.get(&current).cloned().flatten();
        }
        Ok(())
    }

    fn delete_subtree(&mut self, node_id: &str) {
        let mut pending = vec![node_id.to_string()];
        let mut to_remove = Vec::new();

        while let Some(current_id) = pending.pop() {
            to_remove.push(current_id.clone());
            for (child_id, parent_id) in &self.parent_ids {
                if parent_id.as_deref() == Some(current_id.as_str()) {
                    pending.push(child_id.clone());
                }
            }
        }

        for node_id in to_remove {
            self.parent_ids.remove(&node_id);
            self.node_sources
                .retain(|(current_node_id, _)| current_node_id != &node_id);
            self.node_source_chunks
                .retain(|(current_node_id, _)| current_node_id != &node_id);
        }
    }
}

fn validate_position(position: Option<i64>) -> Result<()> {
    if let Some(position) = position
        && position < 0
    {
        bail!("position must be greater than or equal to 0");
    }
    Ok(())
}

fn apply_op_transaction(transaction: &Transaction<'_>, op: &PatchOp) -> Result<()> {
    match op {
        PatchOp::AddNode {
            id,
            parent_id,
            title,
            kind,
            body,
            position,
        } => {
            let now = timestamp_now();
            let node_id = id
                .as_deref()
                .context("resolved add_node operation is missing an id")?;
            let final_position = match position {
                Some(position) => *position,
                None => next_position_tx(transaction, parent_id)?,
            };
            transaction.execute(
                "INSERT INTO nodes (id, parent_id, title, body, kind, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![
                    node_id,
                    parent_id,
                    title,
                    body,
                    kind.as_deref().unwrap_or("topic"),
                    final_position,
                    now
                ],
            )?;
            normalize_children_tx(transaction, Some(parent_id.as_str()))?;
        }
        PatchOp::UpdateNode {
            id,
            title,
            body,
            kind,
        } => {
            let current = get_node_tx(transaction, id)?
                .with_context(|| format!("node {id} was not found"))?;
            transaction.execute(
                "UPDATE nodes
                 SET title = ?2, body = ?3, kind = ?4, updated_at = ?5
                 WHERE id = ?1",
                params![
                    id,
                    title.as_ref().unwrap_or(&current.title),
                    body.as_ref().or(current.body.as_ref()),
                    kind.as_ref().unwrap_or(&current.kind),
                    timestamp_now()
                ],
            )?;
        }
        PatchOp::MoveNode {
            id,
            parent_id,
            position,
        } => {
            let current = get_node_tx(transaction, id)?
                .with_context(|| format!("node {id} was not found"))?;
            let target_position = match position {
                Some(position) => *position,
                None => next_position_tx(transaction, parent_id)?,
            };
            transaction.execute(
                "UPDATE nodes
                 SET parent_id = ?2, position = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![id, parent_id, target_position, timestamp_now()],
            )?;
            if let Some(old_parent) = current.parent_id.as_deref() {
                normalize_children_tx(transaction, Some(old_parent))?;
            }
            normalize_children_tx(transaction, Some(parent_id.as_str()))?;
        }
        PatchOp::DeleteNode { id } => {
            let old_parent = get_node_tx(transaction, id)?
                .and_then(|node| node.parent_id)
                .context("delete target was not found")?;
            transaction.execute("DELETE FROM nodes WHERE id = ?1", [id])?;
            normalize_children_tx(transaction, Some(old_parent.as_str()))?;
        }
        PatchOp::AttachSource { node_id, source_id } => {
            transaction.execute(
                "INSERT INTO node_sources (node_id, source_id) VALUES (?1, ?2)",
                params![node_id, source_id],
            )?;
        }
        PatchOp::AttachSourceChunk { node_id, chunk_id } => {
            let source_id: String = transaction
                .query_row(
                    "SELECT source_id FROM source_chunks WHERE id = ?1",
                    [chunk_id],
                    |row| row.get(0),
                )
                .optional()?
                .with_context(|| format!("source chunk {chunk_id} was not found"))?;
            let source_link_exists: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM node_sources WHERE node_id = ?1 AND source_id = ?2",
                    params![node_id, source_id],
                    |row| row.get(0),
                )
                .optional()?;
            if source_link_exists.is_none() {
                bail!(
                    "cannot attach source chunk {chunk_id} to node {node_id}: attach source {source_id} first"
                );
            }
            transaction.execute(
                "INSERT INTO node_source_chunks (node_id, chunk_id) VALUES (?1, ?2)",
                params![node_id, chunk_id],
            )?;
        }
        PatchOp::DetachSource { node_id, source_id } => {
            let chunk_link_exists: Option<i64> = transaction
                .query_row(
                    "SELECT 1
                     FROM node_source_chunks
                     JOIN source_chunks ON source_chunks.id = node_source_chunks.chunk_id
                     WHERE node_source_chunks.node_id = ?1 AND source_chunks.source_id = ?2
                     LIMIT 1",
                    params![node_id, source_id],
                    |row| row.get(0),
                )
                .optional()?;
            if chunk_link_exists.is_some() {
                bail!(
                    "cannot detach source {source_id} from node {node_id}: detach linked source chunks first"
                );
            }
            let removed = transaction.execute(
                "DELETE FROM node_sources WHERE node_id = ?1 AND source_id = ?2",
                params![node_id, source_id],
            )?;
            if removed == 0 {
                bail!("cannot detach source {source_id} from node {node_id}: link was not found");
            }
        }
        PatchOp::DetachSourceChunk { node_id, chunk_id } => {
            let chunk_exists: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM source_chunks WHERE id = ?1",
                    [chunk_id],
                    |row| row.get(0),
                )
                .optional()?;
            if chunk_exists.is_none() {
                bail!(
                    "cannot detach source chunk {chunk_id} from node {node_id}: chunk was not found"
                );
            }
            let removed = transaction.execute(
                "DELETE FROM node_source_chunks WHERE node_id = ?1 AND chunk_id = ?2",
                params![node_id, chunk_id],
            )?;
            if removed == 0 {
                bail!(
                    "cannot detach source chunk {chunk_id} from node {node_id}: link was not found"
                );
            }
        }
    }
    Ok(())
}

fn get_node_tx(transaction: &Transaction<'_>, id: &str) -> Result<Option<Node>> {
    transaction
        .query_row(
            "SELECT id, parent_id, title, body, kind, position, created_at, updated_at
             FROM nodes WHERE id = ?1",
            [id],
            read_node,
        )
        .optional()
        .map_err(Into::into)
}

pub(super) fn apply_patch_ops_tx(transaction: &Transaction<'_>, ops: &[PatchOp]) -> Result<()> {
    for (index, op) in ops.iter().enumerate() {
        apply_op_transaction(transaction, op).map_err(|err| wrap_patch_op_error(index, op, err))?;
    }
    Ok(())
}

fn wrap_patch_op_error(index: usize, op: &PatchOp, err: anyhow::Error) -> anyhow::Error {
    anyhow!("op {} {}: {}", index + 1, op.kind_name(), err)
}

pub(super) fn write_patch_archive(
    paths: &ProjectPaths,
    patch: &PatchDocument,
) -> Result<PatchArchive> {
    let run_id = Uuid::new_v4().to_string();
    let file_name = format!("{run_id}.json");
    let run_path = paths.runs_dir.join(&file_name);
    let patch_json = serde_json::to_string_pretty(patch)?;
    std::fs::write(&run_path, patch_json.as_bytes())
        .with_context(|| format!("failed to write {}", run_path.display()))?;
    Ok(PatchArchive {
        run_id,
        file_name,
        patch_json,
        applied_at: timestamp_now(),
        run_path,
    })
}

pub(super) fn insert_patch_run_tx(
    transaction: &Transaction<'_>,
    archive: &PatchArchive,
    summary: Option<&String>,
    origin: &str,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO patch_runs (id, summary, origin, patch_json, file_name, applied_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            archive.run_id,
            summary,
            origin,
            archive.patch_json,
            archive.file_name,
            archive.applied_at
        ],
    )?;
    Ok(())
}

fn next_position_tx(transaction: &Transaction<'_>, parent_id: &str) -> Result<i64> {
    let next_position: Option<i64> = transaction.query_row(
        "SELECT MAX(position) + 1 FROM nodes WHERE parent_id = ?1",
        [parent_id],
        |row| row.get(0),
    )?;
    Ok(next_position.unwrap_or(0))
}

fn normalize_children_tx(transaction: &Transaction<'_>, parent_id: Option<&str>) -> Result<()> {
    let child_ids = if let Some(parent_id) = parent_id {
        let mut stmt = transaction
            .prepare("SELECT id FROM nodes WHERE parent_id = ?1 ORDER BY position, id")?;
        let rows = stmt.query_map([parent_id], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        ids
    } else {
        let mut stmt = transaction
            .prepare("SELECT id FROM nodes WHERE parent_id IS NULL ORDER BY position, id")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        ids
    };

    for (position, child_id) in child_ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE nodes SET position = ?2 WHERE id = ?1",
            params![child_id, position as i64],
        )?;
    }
    Ok(())
}
