use super::*;
use crate::ai::{AiPatchResponse, AiRunMetadata, derive_ai_metadata_path, parse_ai_patch_response};
use crate::model::AiRunArtifact;

impl Workspace {
    pub fn workspace_name(&self) -> Result<String> {
        self.metadata_value("workspace_name")?
            .context("workspace_name metadata is missing")
    }

    pub fn list_nodes(&self) -> Result<Vec<Node>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_id, title, body, kind, position, created_at, updated_at
             FROM nodes
             ORDER BY parent_id IS NOT NULL, parent_id, position, id",
        )?;
        let rows = stmt.query_map([], read_node)?;
        let mut nodes = Vec::new();
        for node in rows {
            nodes.push(node?);
        }
        Ok(nodes)
    }

    pub fn tree(&self) -> Result<TreeNode> {
        let nodes = self.list_nodes()?;
        let root_id = self.root_id()?;
        build_tree(&root_id, nodes)
    }

    pub fn tree_string(&self) -> Result<String> {
        let tree = self.tree()?;
        let mut output = String::new();
        render_tree(&tree, 0, &mut output);
        Ok(output)
    }

    pub fn tree_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(&self.tree()?)?)
    }

    pub fn node_detail(&self, node_id: &str) -> Result<NodeDetail> {
        let node = self
            .node_by_id(node_id)?
            .with_context(|| format!("node {node_id} was not found"))?;
        let parent = match node.parent_id.as_deref() {
            Some(parent_id) => self.node_summary_by_id(parent_id)?,
            None => None,
        };
        let children = self.child_summaries(node_id)?;
        let sources = self.sources_for_node(node_id)?;
        let evidence = self.evidence_for_node(node_id)?;
        Ok(NodeDetail {
            node,
            parent,
            children,
            sources,
            evidence,
        })
    }

    pub fn list_sources(&self) -> Result<Vec<SourceRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, original_path, original_name, stored_name, format, imported_at
             FROM sources
             ORDER BY imported_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SourceRecord {
                id: row.get(0)?,
                original_path: row.get(1)?,
                original_name: row.get(2)?,
                stored_name: row.get(3)?,
                format: row.get(4)?,
                imported_at: row.get(5)?,
            })
        })?;

        let mut sources = Vec::new();
        for source in rows {
            sources.push(source?);
        }
        Ok(sources)
    }

    pub fn source_detail(&self, source_id: &str) -> Result<SourceDetail> {
        let source = self
            .source_by_id(source_id)?
            .with_context(|| format!("source {source_id} was not found"))?;
        let chunks = self.source_chunks_for_source(source_id)?;
        let mut chunk_details = Vec::with_capacity(chunks.len());
        for chunk in chunks {
            let linked_nodes = self.nodes_for_chunk(&chunk.id)?;
            let evidence_links = self.evidence_links_for_chunk(&chunk.id)?;
            let evidence_nodes = evidence_links
                .iter()
                .map(|link| link.node.clone())
                .collect::<Vec<_>>();
            chunk_details.push(SourceChunkDetail {
                chunk,
                linked_nodes,
                evidence_nodes,
                evidence_links,
            });
        }
        Ok(SourceDetail {
            source,
            chunks: chunk_details,
        })
    }

    pub fn export_outline(&self) -> Result<String> {
        let tree = self.tree()?;
        let mut output = String::new();
        render_outline(&tree, 0, &mut output);
        Ok(output)
    }

    pub fn ai_run_history(&self, node_id: Option<&str>) -> Result<Vec<AiRunRecord>> {
        let sql = if node_id.is_some() {
            "SELECT id, capability, explore_by, node_id, command, dry_run, status, started_at, finished_at, request_path, response_path, exit_code, provider, model, provider_run_id, retry_count, last_error_category, last_error_message, last_status_code, patch_run_id, patch_summary
             FROM ai_runs
             WHERE node_id = ?1
             ORDER BY started_at DESC, id DESC"
        } else {
            "SELECT id, capability, explore_by, node_id, command, dry_run, status, started_at, finished_at, request_path, response_path, exit_code, provider, model, provider_run_id, retry_count, last_error_category, last_error_message, last_status_code, patch_run_id, patch_summary
             FROM ai_runs
             ORDER BY started_at DESC, id DESC"
        };
        let mut stmt = self.conn.prepare(sql)?;
        let mut records = Vec::new();
        if let Some(node_id) = node_id {
            let rows = stmt.query_map([node_id], read_ai_run_record)?;
            for row in rows {
                records.push(row?);
            }
        } else {
            let rows = stmt.query_map([], read_ai_run_record)?;
            for row in rows {
                records.push(row?);
            }
        }
        Ok(records)
    }

    pub fn ai_run_record_by_id(&self, run_id: &str) -> Result<Option<AiRunRecord>> {
        self.conn
            .query_row(
                "SELECT id, capability, explore_by, node_id, command, dry_run, status, started_at, finished_at, request_path, response_path, exit_code, provider, model, provider_run_id, retry_count, last_error_category, last_error_message, last_status_code, patch_run_id, patch_summary
                 FROM ai_runs
                 WHERE id = ?1",
                [run_id],
                read_ai_run_record,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn ai_run_patch_document(&self, run_id: &str) -> Result<PatchDocument> {
        let record = self
            .ai_run_record_by_id(run_id)?
            .with_context(|| format!("AI run {run_id} was not found"))?;

        if let Some(patch_run_id) = record.patch_run_id.as_deref() {
            return self.patch_document_by_run_id(patch_run_id);
        }

        let response_json = std::fs::read_to_string(&record.response_path)
            .with_context(|| format!("failed to read {}", record.response_path))?;
        let response = parse_ai_patch_response(&response_json)
            .with_context(|| format!("failed to parse {}", record.response_path))?;
        Ok(response.patch)
    }

    pub fn ai_run_response(&self, run_id: &str) -> Result<AiPatchResponse> {
        let record = self
            .ai_run_record_by_id(run_id)?
            .with_context(|| format!("AI run {run_id} was not found"))?;
        let response_json = std::fs::read_to_string(&record.response_path)
            .with_context(|| format!("failed to read {}", record.response_path))?;
        parse_ai_patch_response(&response_json)
            .with_context(|| format!("failed to parse {}", record.response_path))
    }

    pub fn ai_run_artifact(&self, run_id: &str, kind: &str) -> Result<AiRunArtifact> {
        let record = self
            .ai_run_record_by_id(run_id)?
            .with_context(|| format!("AI run {run_id} was not found"))?;

        let artifact_path = match kind {
            "request" => record.request_path.clone(),
            "response" => record.response_path.clone(),
            "metadata" => derive_ai_metadata_path(&record.response_path)
                .ok_or_else(|| anyhow!("AI run {} has no derived metadata path", record.id))?,
            other => anyhow::bail!("unsupported AI run artifact kind `{other}`"),
        };

        let raw = std::fs::read_to_string(&artifact_path)
            .with_context(|| format!("failed to read {}", artifact_path))?;
        let content = serde_json::from_str::<serde_json::Value>(&raw)
            .and_then(|value| serde_json::to_string_pretty(&value))
            .unwrap_or(raw);

        Ok(AiRunArtifact {
            kind: kind.to_string(),
            path: artifact_path,
            content,
        })
    }

    pub fn write_outline(&self, output: Option<&Path>) -> Result<std::path::PathBuf> {
        let outline = self.export_outline()?;
        let target = match output {
            Some(path) => {
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    self.paths.root_dir.join(path)
                }
            }
            None => self
                .paths
                .exports_dir
                .join(format!("outline-{}.md", timestamp_now())),
        };

        if let Some(parent) = target.parent().filter(|path| !path.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        std::fs::write(&target, outline)
            .with_context(|| format!("failed to write {}", target.display()))?;
        Ok(target)
    }

    pub(super) fn all_metadata(&self) -> Result<BTreeMap<String, String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM metadata ORDER BY key")?;
        let rows = stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })?;

        let mut metadata = BTreeMap::new();
        for row in rows {
            let (key, value) = row?;
            metadata.insert(key, value);
        }
        Ok(metadata)
    }

    pub(super) fn list_node_sources(&self) -> Result<Vec<NodeSourceRecord>> {
        let mut stmt = self
            .conn
            .prepare("SELECT node_id, source_id FROM node_sources ORDER BY source_id, node_id")?;
        let rows = stmt.query_map([], |row| {
            Ok(NodeSourceRecord {
                node_id: row.get(0)?,
                source_id: row.get(1)?,
            })
        })?;

        let mut node_sources = Vec::new();
        for node_source in rows {
            node_sources.push(node_source?);
        }
        Ok(node_sources)
    }

    pub(super) fn node_by_id(&self, node_id: &str) -> Result<Option<Node>> {
        self.conn
            .query_row(
                "SELECT id, parent_id, title, body, kind, position, created_at, updated_at
                 FROM nodes
                 WHERE id = ?1",
                [node_id],
                read_node,
            )
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn node_summary_by_id(&self, node_id: &str) -> Result<Option<NodeSummary>> {
        self.conn
            .query_row(
                "SELECT id, title FROM nodes WHERE id = ?1",
                [node_id],
                |row| {
                    Ok(NodeSummary {
                        id: row.get(0)?,
                        title: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn child_summaries(&self, node_id: &str) -> Result<Vec<NodeSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title
             FROM nodes
             WHERE parent_id = ?1
             ORDER BY position, id",
        )?;
        let rows = stmt.query_map([node_id], |row| {
            Ok(NodeSummary {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        })?;

        let mut children = Vec::new();
        for child in rows {
            children.push(child?);
        }
        Ok(children)
    }

    pub(super) fn source_by_id(&self, source_id: &str) -> Result<Option<SourceRecord>> {
        self.conn
            .query_row(
                "SELECT id, original_path, original_name, stored_name, format, imported_at
                 FROM sources
                 WHERE id = ?1",
                [source_id],
                |row| {
                    Ok(SourceRecord {
                        id: row.get(0)?,
                        original_path: row.get(1)?,
                        original_name: row.get(2)?,
                        stored_name: row.get(3)?,
                        format: row.get(4)?,
                        imported_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn list_source_chunks(&self) -> Result<Vec<SourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, ordinal, label, text, start_line, end_line
             FROM source_chunks
             ORDER BY source_id, ordinal, id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SourceChunkRecord {
                id: row.get(0)?,
                source_id: row.get(1)?,
                ordinal: row.get(2)?,
                label: row.get(3)?,
                text: row.get(4)?,
                start_line: row.get(5)?,
                end_line: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn source_chunks_for_source(
        &self,
        source_id: &str,
    ) -> Result<Vec<SourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, ordinal, label, text, start_line, end_line
             FROM source_chunks
             WHERE source_id = ?1
             ORDER BY ordinal, id",
        )?;
        let rows = stmt.query_map([source_id], |row| {
            Ok(SourceChunkRecord {
                id: row.get(0)?,
                source_id: row.get(1)?,
                ordinal: row.get(2)?,
                label: row.get(3)?,
                text: row.get(4)?,
                start_line: row.get(5)?,
                end_line: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn list_node_source_chunks(&self) -> Result<Vec<NodeSourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT node_id, chunk_id FROM node_source_chunks ORDER BY chunk_id, node_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NodeSourceChunkRecord {
                node_id: row.get(0)?,
                chunk_id: row.get(1)?,
            })
        })?;

        let mut chunk_links = Vec::new();
        for chunk_link in rows {
            chunk_links.push(chunk_link?);
        }
        Ok(chunk_links)
    }

    pub(super) fn list_node_evidence_chunks(&self) -> Result<Vec<NodeEvidenceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT node_id, chunk_id, citation_kind, rationale
             FROM node_evidence_chunks
             ORDER BY chunk_id, node_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NodeEvidenceChunkRecord {
                node_id: row.get(0)?,
                chunk_id: row.get(1)?,
                citation_kind: row.get(2)?,
                rationale: row.get(3)?,
            })
        })?;

        let mut chunk_links = Vec::new();
        for chunk_link in rows {
            chunk_links.push(chunk_link?);
        }
        Ok(chunk_links)
    }

    pub(super) fn nodes_for_chunk(&self, chunk_id: &str) -> Result<Vec<NodeSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT nodes.id, nodes.title
             FROM node_source_chunks
             JOIN nodes ON nodes.id = node_source_chunks.node_id
             WHERE node_source_chunks.chunk_id = ?1
             ORDER BY nodes.title, nodes.id",
        )?;
        let rows = stmt.query_map([chunk_id], |row| {
            Ok(NodeSummary {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        })?;

        let mut nodes = Vec::new();
        for node in rows {
            nodes.push(node?);
        }
        Ok(nodes)
    }

    pub(super) fn evidence_links_for_chunk(
        &self,
        chunk_id: &str,
    ) -> Result<Vec<EvidenceNodeSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT nodes.id, nodes.title, node_evidence_chunks.citation_kind, node_evidence_chunks.rationale
             FROM node_evidence_chunks
             JOIN nodes ON nodes.id = node_evidence_chunks.node_id
             WHERE node_evidence_chunks.chunk_id = ?1
             ORDER BY nodes.title, nodes.id",
        )?;
        let rows = stmt.query_map([chunk_id], |row| {
            Ok(EvidenceNodeSummary {
                node: NodeSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                },
                citation_kind: row.get(2)?,
                rationale: row.get(3)?,
            })
        })?;

        let mut nodes = Vec::new();
        for node in rows {
            nodes.push(node?);
        }
        Ok(nodes)
    }

    pub(super) fn sources_for_node(&self, node_id: &str) -> Result<Vec<NodeSourceDetail>> {
        let mut stmt = self.conn.prepare(
            "SELECT sources.id, sources.original_path, sources.original_name, sources.stored_name, sources.format, sources.imported_at
             FROM node_sources
             JOIN sources ON sources.id = node_sources.source_id
             WHERE node_sources.node_id = ?1
             ORDER BY sources.imported_at DESC, sources.id",
        )?;
        let rows = stmt.query_map([node_id], |row| {
            Ok(SourceRecord {
                id: row.get(0)?,
                original_path: row.get(1)?,
                original_name: row.get(2)?,
                stored_name: row.get(3)?,
                format: row.get(4)?,
                imported_at: row.get(5)?,
            })
        })?;

        let mut sources = Vec::new();
        for source in rows {
            let source = source?;
            let chunks = self.chunks_for_node_and_source(node_id, &source.id)?;
            sources.push(NodeSourceDetail { source, chunks });
        }
        Ok(sources)
    }

    pub(super) fn evidence_for_node(&self, node_id: &str) -> Result<Vec<NodeEvidenceDetail>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT sources.id, sources.original_path, sources.original_name, sources.stored_name, sources.format, sources.imported_at
             FROM node_evidence_chunks
             JOIN source_chunks ON source_chunks.id = node_evidence_chunks.chunk_id
             JOIN sources ON sources.id = source_chunks.source_id
             WHERE node_evidence_chunks.node_id = ?1
             ORDER BY sources.imported_at DESC, sources.id",
        )?;
        let rows = stmt.query_map([node_id], |row| {
            Ok(SourceRecord {
                id: row.get(0)?,
                original_path: row.get(1)?,
                original_name: row.get(2)?,
                stored_name: row.get(3)?,
                format: row.get(4)?,
                imported_at: row.get(5)?,
            })
        })?;

        let mut sources = Vec::new();
        for source in rows {
            let source = source?;
            let citations = self.citations_for_node_and_source(node_id, &source.id)?;
            let chunks = citations
                .iter()
                .map(|citation| citation.chunk.clone())
                .collect::<Vec<_>>();
            sources.push(NodeEvidenceDetail {
                source,
                chunks,
                citations,
            });
        }
        Ok(sources)
    }

    pub(super) fn chunks_for_node_and_source(
        &self,
        node_id: &str,
        source_id: &str,
    ) -> Result<Vec<SourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_chunks.id, source_chunks.source_id, source_chunks.ordinal, source_chunks.label, source_chunks.text, source_chunks.start_line, source_chunks.end_line
             FROM node_source_chunks
             JOIN source_chunks ON source_chunks.id = node_source_chunks.chunk_id
             WHERE node_source_chunks.node_id = ?1 AND source_chunks.source_id = ?2
             ORDER BY source_chunks.ordinal, source_chunks.id",
        )?;
        let rows = stmt.query_map(params![node_id, source_id], |row| {
            Ok(SourceChunkRecord {
                id: row.get(0)?,
                source_id: row.get(1)?,
                ordinal: row.get(2)?,
                label: row.get(3)?,
                text: row.get(4)?,
                start_line: row.get(5)?,
                end_line: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn citations_for_node_and_source(
        &self,
        node_id: &str,
        source_id: &str,
    ) -> Result<Vec<EvidenceCitationDetail>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_chunks.id, source_chunks.source_id, source_chunks.ordinal, source_chunks.label, source_chunks.text, source_chunks.start_line, source_chunks.end_line, node_evidence_chunks.citation_kind, node_evidence_chunks.rationale
             FROM node_evidence_chunks
             JOIN source_chunks ON source_chunks.id = node_evidence_chunks.chunk_id
             WHERE node_evidence_chunks.node_id = ?1 AND source_chunks.source_id = ?2
             ORDER BY source_chunks.ordinal, source_chunks.id",
        )?;
        let rows = stmt.query_map(params![node_id, source_id], |row| {
            Ok(EvidenceCitationDetail {
                chunk: SourceChunkRecord {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    ordinal: row.get(2)?,
                    label: row.get(3)?,
                    text: row.get(4)?,
                    start_line: row.get(5)?,
                    end_line: row.get(6)?,
                },
                citation_kind: row.get(7)?,
                rationale: row.get(8)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn set_metadata(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub(super) fn metadata_value(&self, key: &str) -> Result<Option<String>> {
        let value = self
            .conn
            .query_row("SELECT value FROM metadata WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value)
    }

    pub(super) fn root_id(&self) -> Result<String> {
        self.metadata_value("root_id")?
            .context("root_id metadata is missing")
    }

    pub(crate) fn upsert_ai_run_index(&self, metadata: &AiRunMetadata) -> Result<()> {
        self.conn.execute(
            "INSERT INTO ai_runs (
                id, capability, explore_by, node_id, command, dry_run, status, started_at,
                finished_at, request_path, response_path, exit_code, provider, model,
                provider_run_id, retry_count, last_error_category, last_error_message,
                last_status_code, patch_run_id, patch_summary
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19, ?20, ?21
            )
            ON CONFLICT(id) DO UPDATE SET
                capability = excluded.capability,
                explore_by = excluded.explore_by,
                node_id = excluded.node_id,
                command = excluded.command,
                dry_run = excluded.dry_run,
                status = excluded.status,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                request_path = excluded.request_path,
                response_path = excluded.response_path,
                exit_code = excluded.exit_code,
                provider = excluded.provider,
                model = excluded.model,
                provider_run_id = excluded.provider_run_id,
                retry_count = excluded.retry_count,
                last_error_category = excluded.last_error_category,
                last_error_message = excluded.last_error_message,
                last_status_code = excluded.last_status_code,
                patch_run_id = excluded.patch_run_id,
                patch_summary = excluded.patch_summary",
            params![
                metadata.run_id,
                metadata.capability,
                metadata.explore_by,
                metadata.node_id,
                metadata.command,
                if metadata.dry_run { 1 } else { 0 },
                metadata.status,
                metadata.started_at,
                metadata.finished_at,
                metadata.request_path,
                metadata.response_path,
                metadata.exit_code,
                metadata.provider,
                metadata.model,
                metadata.provider_run_id,
                metadata.retry_count as i64,
                metadata.last_error_category,
                metadata.last_error_message,
                metadata.last_status_code,
                metadata.patch_run_id,
                metadata.patch_summary,
            ],
        )?;
        Ok(())
    }
}

pub(super) fn read_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        kind: row.get(4)?,
        position: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn read_ai_run_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiRunRecord> {
    Ok(AiRunRecord {
        id: row.get(0)?,
        capability: row.get(1)?,
        explore_by: row.get(2)?,
        node_id: row.get(3)?,
        command: row.get(4)?,
        dry_run: row.get::<_, i64>(5)? != 0,
        status: row.get(6)?,
        started_at: row.get(7)?,
        finished_at: row.get(8)?,
        request_path: row.get(9)?,
        response_path: row.get(10)?,
        exit_code: row.get(11)?,
        provider: row.get(12)?,
        model: row.get(13)?,
        provider_run_id: row.get(14)?,
        retry_count: row.get::<_, i64>(15)? as u32,
        last_error_category: row.get(16)?,
        last_error_message: row.get(17)?,
        last_status_code: row.get(18)?,
        patch_run_id: row.get(19)?,
        patch_summary: row.get(20)?,
    })
}

fn build_tree(root_id: &str, nodes: Vec<Node>) -> Result<TreeNode> {
    let mut nodes_by_id = HashMap::new();
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();

    for node in nodes {
        if let Some(parent_id) = node.parent_id.clone() {
            children_by_parent
                .entry(parent_id)
                .or_default()
                .push(node.id.clone());
        }
        nodes_by_id.insert(node.id.clone(), node);
    }

    fn build_subtree(
        node_id: &str,
        nodes_by_id: &HashMap<String, Node>,
        children_by_parent: &HashMap<String, Vec<String>>,
    ) -> Result<TreeNode> {
        let node = nodes_by_id
            .get(node_id)
            .with_context(|| format!("node {node_id} was not found while building the tree"))?
            .clone();
        let mut children = Vec::new();
        if let Some(child_ids) = children_by_parent.get(node_id) {
            for child_id in child_ids {
                children.push(build_subtree(child_id, nodes_by_id, children_by_parent)?);
            }
        }
        Ok(TreeNode { node, children })
    }

    build_subtree(root_id, &nodes_by_id, &children_by_parent)
}

fn render_tree(node: &TreeNode, depth: usize, output: &mut String) {
    let indent = "  ".repeat(depth);
    output.push_str(&format!(
        "{indent}- {} [{}]\n",
        node.node.title, node.node.id
    ));
    for child in &node.children {
        render_tree(child, depth + 1, output);
    }
}

fn render_outline(node: &TreeNode, depth: usize, output: &mut String) {
    let indent = "  ".repeat(depth);
    match &node.node.body {
        Some(body) if !body.is_empty() => {
            output.push_str(&format!("{indent}- {}: {}\n", node.node.title, body))
        }
        _ => output.push_str(&format!("{indent}- {}\n", node.node.title)),
    }
    for child in &node.children {
        render_outline(child, depth + 1, output);
    }
}
