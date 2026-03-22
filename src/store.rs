use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use uuid::Uuid;

use crate::model::{
    ApplyPatchReport, Node, NodeDetail, NodeSourceChunkRecord, NodeSourceDetail, NodeSourceRecord,
    NodeSummary, PatchRunRecord, SnapshotRecord, SnapshotState, SourceChunkDetail,
    SourceChunkRecord, SourceDetail, SourceImportReport, SourceRecord, TreeNode,
};
use crate::patch::{PatchDocument, PatchOp};
use crate::project::ProjectPaths;
use crate::source::{ImportedNode, SourceChunkDraft, load_source_plan};

pub struct Workspace {
    pub paths: ProjectPaths,
    conn: Connection,
}

impl Workspace {
    pub fn init_at(root_dir: &Path) -> Result<Self> {
        let paths =
            ProjectPaths::for_root(root_dir.canonicalize().with_context(|| {
                format!("failed to resolve workspace root {}", root_dir.display())
            })?);
        if paths.data_dir.exists() {
            bail!(
                "workspace already contains {}; refusing to overwrite it",
                paths.data_dir.display()
            );
        }

        paths.create_layout()?;
        let conn = Connection::open(&paths.db_path)
            .with_context(|| format!("failed to open {}", paths.db_path.display()))?;
        let mut workspace = Self { paths, conn };
        workspace.enable_foreign_keys()?;
        workspace.create_schema()?;
        workspace.seed_workspace()?;
        workspace.save_snapshot(Some("initial".to_string()))?;
        Ok(workspace)
    }

    pub fn open_from(start: &Path) -> Result<Self> {
        let paths = ProjectPaths::discover_from(start)?;
        Self::open_with_paths(paths)
    }

    fn open_with_paths(paths: ProjectPaths) -> Result<Self> {
        let conn = Connection::open(&paths.db_path)
            .with_context(|| format!("failed to open {}", paths.db_path.display()))?;
        let mut workspace = Self { paths, conn };
        workspace.enable_foreign_keys()?;
        Ok(workspace)
    }

    fn enable_foreign_keys(&mut self) -> Result<()> {
        self.conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    }

    fn create_schema(&mut self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                body TEXT,
                kind TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_parent_position
                ON nodes(parent_id, position, id);

            CREATE TABLE IF NOT EXISTS patch_runs (
                id TEXT PRIMARY KEY,
                summary TEXT,
                origin TEXT NOT NULL,
                patch_json TEXT NOT NULL,
                file_name TEXT NOT NULL,
                applied_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                label TEXT,
                state_json TEXT NOT NULL,
                file_name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                original_path TEXT NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                format TEXT NOT NULL,
                imported_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS node_sources (
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                PRIMARY KEY (node_id, source_id)
            );

            CREATE TABLE IF NOT EXISTS source_chunks (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL,
                label TEXT,
                text TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS node_source_chunks (
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
                PRIMARY KEY (node_id, chunk_id)
            );
            ",
        )?;
        Ok(())
    }

    fn seed_workspace(&mut self) -> Result<()> {
        let workspace_name = self
            .paths
            .root_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Nodex Workspace")
            .to_string();
        let now = timestamp_now();

        self.set_metadata("schema_version", "1")?;
        self.set_metadata("created_at", &now.to_string())?;
        self.set_metadata("workspace_name", &workspace_name)?;
        self.set_metadata("root_id", "root")?;

        self.conn.execute(
            "INSERT INTO nodes (id, parent_id, title, body, kind, position, created_at, updated_at)
             VALUES (?1, NULL, ?2, NULL, 'topic', 0, ?3, ?3)",
            params!["root", workspace_name, now],
        )?;
        Ok(())
    }

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
        Ok(NodeDetail {
            node,
            parent,
            children,
            sources,
        })
    }

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
        if patch.version != 1 {
            bail!("unsupported patch version {}; expected 1", patch.version);
        }
        if patch.ops.is_empty() {
            bail!("patch must contain at least one operation");
        }

        let patch = patch.resolved();
        self.validate_patch(&patch)?;
        let preview = patch.preview_lines();

        if dry_run {
            return Ok(ApplyPatchReport {
                run_id: None,
                summary: patch.summary.clone(),
                preview,
            });
        }

        let run_id = Uuid::new_v4().to_string();
        let file_name = format!("{run_id}.json");
        let run_path = self.paths.runs_dir.join(&file_name);
        let patch_json = serde_json::to_string_pretty(&patch)?;
        std::fs::write(&run_path, patch_json.as_bytes())
            .with_context(|| format!("failed to write {}", run_path.display()))?;

        let applied_at = timestamp_now();
        let transaction = self.conn.transaction()?;
        let apply_result =
            (|| -> Result<()> {
                for op in &patch.ops {
                    apply_op_transaction(&transaction, op)?;
                }
                transaction.execute(
                "INSERT INTO patch_runs (id, summary, origin, patch_json, file_name, applied_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![run_id, patch.summary, origin, patch_json, file_name, applied_at],
            )?;
                Ok(())
            })();

        if let Err(err) = apply_result {
            let _ = std::fs::remove_file(&run_path);
            return Err(err);
        }

        if let Err(err) = transaction.commit() {
            let _ = std::fs::remove_file(&run_path);
            return Err(err.into());
        }

        Ok(ApplyPatchReport {
            run_id: Some(run_id),
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

    pub fn import_source(&mut self, source_path: &Path) -> Result<SourceImportReport> {
        let source_path = source_path
            .canonicalize()
            .with_context(|| format!("failed to resolve source file {}", source_path.display()))?;
        if !source_path.is_file() {
            bail!("{} is not a file", source_path.display());
        }

        let import_plan = load_source_plan(&source_path)?;
        let source_id = Uuid::new_v4().to_string();
        let stored_name = build_stored_source_name(&source_id, &source_path);
        let stored_path = self.paths.sources_dir.join(&stored_name);
        std::fs::copy(&source_path, &stored_path).with_context(|| {
            format!(
                "failed to copy source file from {} to {}",
                source_path.display(),
                stored_path.display()
            )
        })?;

        let imported_at = timestamp_now();
        let original_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .context("source file name is missing or invalid unicode")?
            .to_string();
        let root_parent_id = self.root_id()?;
        let transaction = self.conn.transaction()?;
        let import_result = (|| -> Result<(String, usize)> {
            transaction.execute(
                "INSERT INTO sources (id, original_path, original_name, stored_name, format, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    source_id,
                    source_path.display().to_string(),
                    original_name,
                    stored_name,
                    import_plan.format,
                    imported_at
                ],
            )?;

            let chunk_ids = insert_source_chunks_tx(&transaction, &source_id, &import_plan.chunks)?;
            insert_imported_tree_tx(
                &transaction,
                &root_parent_id,
                &source_id,
                &chunk_ids,
                &import_plan.root,
            )
        })();

        match import_result {
            Ok((root_node_id, node_count)) => {
                if let Err(err) = transaction.commit() {
                    let _ = std::fs::remove_file(&stored_path);
                    return Err(err.into());
                }
                Ok(SourceImportReport {
                    source_id,
                    original_name,
                    stored_name,
                    root_node_id,
                    root_title: import_plan.root.title,
                    node_count,
                    chunk_count: import_plan.chunks.len(),
                })
            }
            Err(err) => {
                let _ = std::fs::remove_file(&stored_path);
                Err(err)
            }
        }
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
            chunk_details.push(SourceChunkDetail {
                chunk,
                linked_nodes,
            });
        }
        Ok(SourceDetail {
            source,
            chunks: chunk_details,
        })
    }

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

        transaction.commit()?;
        Ok(())
    }

    pub fn export_outline(&self) -> Result<String> {
        let tree = self.tree()?;
        let mut output = String::new();
        render_outline(&tree, 0, &mut output);
        Ok(output)
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

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        std::fs::write(&target, outline)
            .with_context(|| format!("failed to write {}", target.display()))?;
        Ok(target)
    }

    fn snapshot_state(&self) -> Result<SnapshotState> {
        Ok(SnapshotState {
            metadata: self.all_metadata()?,
            nodes: self.list_nodes()?,
            sources: self.list_sources()?,
            node_sources: self.list_node_sources()?,
            source_chunks: self.list_source_chunks()?,
            node_source_chunks: self.list_node_source_chunks()?,
        })
    }

    fn load_snapshot_state(&self, snapshot_id: &str) -> Result<Option<SnapshotState>> {
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

    fn all_metadata(&self) -> Result<BTreeMap<String, String>> {
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

    fn list_node_sources(&self) -> Result<Vec<NodeSourceRecord>> {
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

    fn node_by_id(&self, node_id: &str) -> Result<Option<Node>> {
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

    fn node_summary_by_id(&self, node_id: &str) -> Result<Option<NodeSummary>> {
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

    fn child_summaries(&self, node_id: &str) -> Result<Vec<NodeSummary>> {
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

    fn source_by_id(&self, source_id: &str) -> Result<Option<SourceRecord>> {
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

    fn list_source_chunks(&self) -> Result<Vec<SourceChunkRecord>> {
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

    fn source_chunks_for_source(&self, source_id: &str) -> Result<Vec<SourceChunkRecord>> {
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

    fn list_node_source_chunks(&self) -> Result<Vec<NodeSourceChunkRecord>> {
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

    fn nodes_for_chunk(&self, chunk_id: &str) -> Result<Vec<NodeSummary>> {
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

    fn sources_for_node(&self, node_id: &str) -> Result<Vec<NodeSourceDetail>> {
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

    fn chunks_for_node_and_source(
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

    fn set_metadata(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    fn metadata_value(&self, key: &str) -> Result<Option<String>> {
        let value = self
            .conn
            .query_row("SELECT value FROM metadata WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value)
    }

    fn root_id(&self) -> Result<String> {
        self.metadata_value("root_id")?
            .context("root_id metadata is missing")
    }

    fn validate_patch(&self, patch: &PatchDocument) -> Result<()> {
        let root_id = self.root_id()?;
        for op in &patch.ops {
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
                    if self.node_exists(node_id)? {
                        bail!("cannot add node {node_id}: a node with that id already exists");
                    }
                    if !self.node_exists(parent_id)? {
                        bail!("cannot add node {node_id}: parent {parent_id} was not found");
                    }
                    validate_position(*position)?;
                }
                PatchOp::UpdateNode {
                    id,
                    title,
                    body,
                    kind,
                } => {
                    if !self.node_exists(id)? {
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
                    if id == &root_id {
                        bail!("cannot move the root node");
                    }
                    if !self.node_exists(id)? {
                        bail!("cannot move node {id}: node was not found");
                    }
                    if !self.node_exists(parent_id)? {
                        bail!("cannot move node {id}: parent {parent_id} was not found");
                    }
                    self.ensure_move_is_acyclic(id, parent_id)?;
                    validate_position(*position)?;
                }
                PatchOp::DeleteNode { id } => {
                    if id == &root_id {
                        bail!("cannot delete the root node");
                    }
                    if !self.node_exists(id)? {
                        bail!("cannot delete node {id}: node was not found");
                    }
                }
            }
        }
        Ok(())
    }

    fn node_exists(&self, id: &str) -> Result<bool> {
        let exists: Option<i64> = self
            .conn
            .query_row("SELECT 1 FROM nodes WHERE id = ?1", [id], |row| row.get(0))
            .optional()?;
        Ok(exists.is_some())
    }

    fn parent_id_of(&self, id: &str) -> Result<Option<String>> {
        self.conn
            .query_row("SELECT parent_id FROM nodes WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map(|value| value.flatten())
            .map_err(Into::into)
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
            cursor = self.parent_id_of(&current)?;
        }
        Ok(())
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

fn read_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
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

fn insert_source_chunks_tx(
    transaction: &Transaction<'_>,
    source_id: &str,
    chunks: &[SourceChunkDraft],
) -> Result<Vec<String>> {
    let mut chunk_ids = Vec::with_capacity(chunks.len());
    for (ordinal, chunk) in chunks.iter().enumerate() {
        let chunk_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO source_chunks (id, source_id, ordinal, label, text, start_line, end_line)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                chunk_id,
                source_id,
                ordinal as i64,
                chunk.label,
                chunk.text,
                chunk.start_line as i64,
                chunk.end_line as i64
            ],
        )?;
        chunk_ids.push(chunk_id);
    }
    Ok(chunk_ids)
}

fn insert_imported_tree_tx(
    transaction: &Transaction<'_>,
    parent_id: &str,
    source_id: &str,
    chunk_ids: &[String],
    node: &ImportedNode,
) -> Result<(String, usize)> {
    let node_id = Uuid::new_v4().to_string();
    let now = timestamp_now();
    let position = next_position_tx(transaction, parent_id)?;
    transaction.execute(
        "INSERT INTO nodes (id, parent_id, title, body, kind, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            node_id, parent_id, node.title, node.body, node.kind, position, now
        ],
    )?;
    transaction.execute(
        "INSERT INTO node_sources (node_id, source_id) VALUES (?1, ?2)",
        params![node_id, source_id],
    )?;
    for chunk_index in &node.chunk_indexes {
        let chunk_id = chunk_ids.get(*chunk_index).with_context(|| {
            format!(
                "chunk index {} was not found while importing source",
                chunk_index
            )
        })?;
        transaction.execute(
            "INSERT INTO node_source_chunks (node_id, chunk_id) VALUES (?1, ?2)",
            params![node_id, chunk_id],
        )?;
    }

    let mut total_nodes = 1usize;
    for child in &node.children {
        let (_, child_count) =
            insert_imported_tree_tx(transaction, &node_id, source_id, chunk_ids, child)?;
        total_nodes += child_count;
    }
    Ok((node_id, total_nodes))
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

fn build_stored_source_name(source_id: &str, source_path: &Path) -> String {
    match source_path.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => {
            format!("{source_id}.{}", extension.to_ascii_lowercase())
        }
        _ => source_id.to_string(),
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

pub fn format_timestamp(timestamp: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp, 0)
        .map(|date_time| date_time.to_rfc3339())
        .unwrap_or_else(|| timestamp.to_string())
}

fn timestamp_now() -> i64 {
    chrono::Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn init_creates_root_and_initial_snapshot() -> Result<()> {
        let temp_dir = tempdir()?;
        let workspace = Workspace::init_at(temp_dir.path())?;

        let tree = workspace.tree()?;
        assert_eq!(tree.node.id, "root");
        assert_eq!(tree.node.title, workspace.workspace_name()?);

        let snapshots = workspace.list_snapshots()?;
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].label.as_deref(), Some("initial"));
        Ok(())
    }

    #[test]
    fn patch_application_and_snapshot_restore_round_trip() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;

        let add_result = workspace.add_node(
            "Problem".to_string(),
            "root".to_string(),
            "topic".to_string(),
            Some("Why is this hard?".to_string()),
            None,
        )?;
        assert!(add_result.run_id.is_some());
        assert_eq!(workspace.patch_history()?.len(), 1);

        let snapshot = workspace.save_snapshot(Some("after-add".to_string()))?;
        let outline = workspace.export_outline()?;
        assert!(outline.contains("Problem"));

        let problem_id = workspace
            .list_nodes()?
            .into_iter()
            .find(|node| node.title == "Problem")
            .context("Problem node missing")?
            .id;
        workspace.delete_node(problem_id)?;
        assert!(!workspace.export_outline()?.contains("Problem"));

        workspace.restore_snapshot(&snapshot.id)?;
        assert!(workspace.export_outline()?.contains("Problem"));
        assert_eq!(workspace.patch_history()?.len(), 2);
        Ok(())
    }

    #[test]
    fn import_source_copies_file_and_restores_source_state() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n\n## Next Step\nShip a tiny import MVP.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        assert_eq!(workspace.list_sources()?.len(), 1);
        assert!(workspace.tree_string()?.contains("Launch Plan"));
        assert_eq!(import_report.chunk_count, 2);
        assert_eq!(workspace.list_source_chunks()?.len(), 2);
        assert_eq!(workspace.list_node_source_chunks()?.len(), 2);
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        assert_eq!(source_detail.chunks.len(), 2);
        assert_eq!(
            source_detail.chunks[0].chunk.label.as_deref(),
            Some("Problem")
        );
        assert_eq!(source_detail.chunks[0].linked_nodes.len(), 1);
        assert_eq!(source_detail.chunks[0].linked_nodes[0].title, "Problem");
        assert!(
            workspace
                .paths
                .sources_dir
                .join(&import_report.stored_name)
                .exists()
        );

        let snapshot = workspace.save_snapshot(Some("after-import".to_string()))?;
        let snapshot_path = workspace.paths.snapshots_dir.join(&snapshot.file_name);
        let snapshot_state: SnapshotState =
            serde_json::from_str(&std::fs::read_to_string(&snapshot_path)?)?;
        assert_eq!(snapshot_state.sources.len(), 1);
        assert_eq!(snapshot_state.node_sources.len(), import_report.node_count);
        assert_eq!(
            snapshot_state.source_chunks.len(),
            import_report.chunk_count
        );
        assert_eq!(snapshot_state.node_source_chunks.len(), 2);
        let imported_root_id = import_report.root_node_id.clone();
        workspace.delete_node(imported_root_id)?;
        assert_eq!(workspace.list_sources()?.len(), 1);

        workspace.restore_snapshot(&snapshot.id)?;
        assert!(workspace.tree_string()?.contains("Launch Plan"));
        assert_eq!(workspace.list_sources()?.len(), 1);
        assert_eq!(workspace.list_source_chunks()?.len(), 2);
        assert_eq!(workspace.list_node_source_chunks()?.len(), 2);

        let root_detail = workspace.node_detail(&import_report.root_node_id)?;
        assert_eq!(root_detail.sources.len(), 1);
        assert!(root_detail.sources[0].chunks.is_empty());

        let problem_id = source_detail.chunks[0].linked_nodes[0].id.clone();
        let problem_detail = workspace.node_detail(&problem_id)?;
        assert_eq!(problem_detail.sources.len(), 1);
        assert_eq!(problem_detail.sources[0].chunks.len(), 1);
        assert_eq!(
            problem_detail.sources[0].chunks[0].label.as_deref(),
            Some("Problem")
        );
        Ok(())
    }

    #[test]
    fn patch_validation_rejects_new_nodes_referenced_by_later_ops() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;

        let patch = PatchDocument {
            version: 1,
            summary: Some("Build a nested branch in one patch".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("parent".to_string()),
                    parent_id: "root".to_string(),
                    title: "Parent".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AddNode {
                    id: Some("child".to_string()),
                    parent_id: "parent".to_string(),
                    title: "Child".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
            ],
        };

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("patch should be validated against the pre-apply workspace state");
        assert!(error.to_string().contains("parent parent was not found"));
        assert_eq!(workspace.list_nodes()?.len(), 1);
        assert!(workspace.patch_history()?.is_empty());
        Ok(())
    }

    #[test]
    fn failed_patch_apply_rolls_back_database_and_archive() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;

        let patch = PatchDocument {
            version: 1,
            summary: Some("Introduce a duplicate node id".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("duplicate".to_string()),
                    parent_id: "root".to_string(),
                    title: "First".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AddNode {
                    id: Some("duplicate".to_string()),
                    parent_id: "root".to_string(),
                    title: "Second".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
            ],
        };

        workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("duplicate ids in one patch should fail during apply");

        assert_eq!(workspace.list_nodes()?.len(), 1);
        assert!(workspace.patch_history()?.is_empty());
        assert_eq!(std::fs::read_dir(&workspace.paths.runs_dir)?.count(), 0);
        Ok(())
    }

    #[test]
    fn workspace_is_discovered_from_nested_directories() -> Result<()> {
        let temp_dir = tempdir()?;
        let workspace = Workspace::init_at(temp_dir.path())?;
        let nested_dir = temp_dir.path().join("notes").join("drafts").join("today");
        std::fs::create_dir_all(&nested_dir)?;

        let discovered = Workspace::open_from(&nested_dir)?;

        assert_eq!(discovered.paths.root_dir, workspace.paths.root_dir);
        assert_eq!(discovered.workspace_name()?, workspace.workspace_name()?);
        Ok(())
    }
}
