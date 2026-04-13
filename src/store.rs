use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use uuid::Uuid;

use crate::model::{
    AiRunRecord, AiRunReplayReport, ApplyPatchReport, EvidenceCitationDetail, EvidenceNodeSummary,
    Node, NodeDetail, NodeEvidenceChunkRecord, NodeEvidenceDetail, NodeSourceChunkRecord,
    NodeSourceDetail, NodeSourceRecord, NodeSummary, PatchRunRecord, SnapshotRecord, SnapshotState,
    SourceChunkDetail, SourceChunkRecord, SourceDetail, SourceImportPreview, SourceImportReport,
    SourceRecord, TreeNode,
};
use crate::patch::{PatchDocument, PatchOp};
use crate::project::ProjectPaths;
use crate::source::{ImportedNode, SourceChunkDraft, load_source_plan};

mod patching;
mod queries;
mod snapshots;
mod source_import;

const CURRENT_SCHEMA_VERSION: &str = "5";

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
        workspace.create_schema()?;
        workspace.sync_schema_version()?;
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

            CREATE TABLE IF NOT EXISTS ai_runs (
                id TEXT PRIMARY KEY,
                capability TEXT NOT NULL,
                explore_by TEXT,
                node_id TEXT NOT NULL,
                command TEXT NOT NULL,
                dry_run INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER NOT NULL,
                request_path TEXT NOT NULL,
                response_path TEXT NOT NULL,
                exit_code INTEGER,
                provider TEXT,
                model TEXT,
                provider_run_id TEXT,
                retry_count INTEGER NOT NULL,
                used_plain_json_fallback INTEGER NOT NULL DEFAULT 0,
                normalization_notes TEXT NOT NULL DEFAULT '[]',
                last_error_category TEXT,
                last_error_message TEXT,
                last_status_code INTEGER,
                patch_run_id TEXT,
                patch_summary TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_ai_runs_node_started
                ON ai_runs(node_id, started_at DESC, id DESC);

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

            CREATE TABLE IF NOT EXISTS node_evidence_chunks (
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
                citation_kind TEXT NOT NULL DEFAULT 'direct',
                rationale TEXT,
                PRIMARY KEY (node_id, chunk_id)
            );
            ",
        )?;
        self.ensure_node_evidence_schema()?;
        self.ensure_ai_run_metadata_schema()?;
        Ok(())
    }

    fn sync_schema_version(&self) -> Result<()> {
        let has_workspace: Option<i64> = self
            .conn
            .query_row("SELECT 1 FROM metadata LIMIT 1", [], |row| row.get(0))
            .optional()?;
        if has_workspace.is_some() {
            self.set_metadata("schema_version", CURRENT_SCHEMA_VERSION)?;
        }
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

        self.set_metadata("schema_version", CURRENT_SCHEMA_VERSION)?;
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

    fn ensure_node_evidence_schema(&self) -> Result<()> {
        if !self.table_has_column("node_evidence_chunks", "citation_kind")? {
            self.conn.execute(
                "ALTER TABLE node_evidence_chunks ADD COLUMN citation_kind TEXT NOT NULL DEFAULT 'direct'",
                [],
            )?;
        }
        if !self.table_has_column("node_evidence_chunks", "rationale")? {
            self.conn.execute(
                "ALTER TABLE node_evidence_chunks ADD COLUMN rationale TEXT",
                [],
            )?;
        }
        Ok(())
    }

    fn ensure_ai_run_metadata_schema(&self) -> Result<()> {
        if !self.table_has_column("ai_runs", "used_plain_json_fallback")? {
            self.conn.execute(
                "ALTER TABLE ai_runs ADD COLUMN used_plain_json_fallback INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !self.table_has_column("ai_runs", "normalization_notes")? {
            self.conn.execute(
                "ALTER TABLE ai_runs ADD COLUMN normalization_notes TEXT NOT NULL DEFAULT '[]'",
                [],
            )?;
        }
        Ok(())
    }

    fn table_has_column(&self, table_name: &str, column_name: &str) -> Result<bool> {
        let pragma = format!("PRAGMA table_info({table_name})");
        let mut stmt = self.conn.prepare(&pragma)?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for row in rows {
            if row? == column_name {
                return Ok(true);
            }
        }
        Ok(false)
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
    use std::path::Path;

    use tempfile::tempdir;

    use super::*;

    fn shell_quote(value: &str) -> String {
        #[cfg(windows)]
        {
            format!("'{}'", value.replace('\'', "''"))
        }

        #[cfg(not(windows))]
        {
            format!("'{}'", value.replace('\'', "'\\''"))
        }
    }

    fn test_python_command(
        temp_dir: &tempfile::TempDir,
        file_name: &str,
        script: &str,
    ) -> Result<String> {
        let script_path = temp_dir.path().join(file_name);
        std::fs::write(&script_path, script)?;
        Ok(format!(
            "python3 {}",
            shell_quote(&script_path.display().to_string())
        ))
    }

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
        let patch_history = workspace.patch_history()?;
        assert_eq!(patch_history.len(), 1);
        assert_eq!(patch_history[0].origin, "source_import");
        assert_eq!(
            patch_history[0].summary.as_deref(),
            Some("Import source \"notes.md\"")
        );
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
        assert!(snapshot_state.node_evidence_chunks.is_empty());
        let imported_root_id = import_report.root_node_id.clone();
        workspace.delete_node(imported_root_id)?;
        assert_eq!(workspace.list_sources()?.len(), 1);

        workspace.restore_snapshot(&snapshot.id)?;
        assert!(workspace.tree_string()?.contains("Launch Plan"));
        assert_eq!(workspace.list_sources()?.len(), 1);
        assert_eq!(workspace.list_source_chunks()?.len(), 2);
        assert_eq!(workspace.list_node_source_chunks()?.len(), 2);
        assert_eq!(workspace.patch_history()?.len(), 2);

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
    fn preview_source_import_generates_patch_without_mutating_workspace() -> Result<()> {
        let temp_dir = tempdir()?;
        let workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let preview = workspace.preview_source_import(&source_path)?;

        assert_eq!(preview.report.original_name, "notes.md");
        assert_eq!(preview.report.root_title, "Launch Plan");
        assert_eq!(preview.report.chunk_count, 1);
        assert!(preview.report.stored_name.ends_with(".md"));
        assert!(matches!(
            preview.patch.ops.first(),
            Some(PatchOp::AddNode { .. })
        ));
        assert!(
            preview
                .patch
                .ops
                .iter()
                .any(|op| matches!(op, PatchOp::AttachSource { .. }))
        );
        assert!(
            preview
                .patch
                .ops
                .iter()
                .any(|op| matches!(op, PatchOp::AttachSourceChunk { .. }))
        );
        assert_eq!(workspace.list_nodes()?.len(), 1);
        assert!(workspace.list_sources()?.is_empty());
        assert!(workspace.patch_history()?.is_empty());
        Ok(())
    }

    #[test]
    fn patch_can_attach_existing_source_and_chunk_to_new_node() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Attach imported evidence to a new node".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AttachSource {
                    node_id: "idea".to_string(),
                    source_id: import_report.source_id.clone(),
                },
                PatchOp::AttachSourceChunk {
                    node_id: "idea".to_string(),
                    chunk_id,
                },
            ],
        };

        let report = workspace.apply_patch_document(patch, "test", false)?;
        assert!(report.run_id.is_some());

        let detail = workspace.node_detail("idea")?;
        assert_eq!(detail.sources.len(), 1);
        assert_eq!(detail.sources[0].source.id, import_report.source_id);
        assert_eq!(detail.sources[0].chunks.len(), 1);
        assert_eq!(
            detail.sources[0].chunks[0].label.as_deref(),
            Some("Problem")
        );
        Ok(())
    }

    #[test]
    fn patch_can_cite_source_chunk_without_mutating_source_chunk_links() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Cite imported chunk on a new node".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AttachSource {
                    node_id: "idea".to_string(),
                    source_id: import_report.source_id.clone(),
                },
                PatchOp::CiteSourceChunk {
                    node_id: "idea".to_string(),
                    chunk_id: chunk_id.clone(),
                    citation_kind: None,
                    rationale: None,
                },
            ],
        };

        let report = workspace.apply_patch_document(patch, "test", false)?;
        assert!(report.run_id.is_some());

        let detail = workspace.node_detail("idea")?;
        assert_eq!(detail.sources.len(), 1);
        assert!(detail.sources[0].chunks.is_empty());
        assert_eq!(detail.evidence.len(), 1);
        assert_eq!(detail.evidence[0].source.id, import_report.source_id);
        assert_eq!(detail.evidence[0].chunks.len(), 1);
        assert_eq!(detail.evidence[0].citations[0].citation_kind, "direct");
        assert!(detail.evidence[0].citations[0].rationale.is_none());
        assert_eq!(
            detail.evidence[0].chunks[0].label.as_deref(),
            Some("Problem")
        );

        let refreshed_source = workspace.source_detail(&import_report.source_id)?;
        let linked_titles = refreshed_source.chunks[0]
            .linked_nodes
            .iter()
            .map(|node| node.title.clone())
            .collect::<Vec<_>>();
        let evidence_titles = refreshed_source.chunks[0]
            .evidence_nodes
            .iter()
            .map(|node| node.title.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            refreshed_source.chunks[0].evidence_links[0].citation_kind,
            "direct"
        );
        assert!(
            refreshed_source.chunks[0].evidence_links[0]
                .rationale
                .is_none()
        );
        assert!(linked_titles.contains(&"Problem".to_string()));
        assert!(!linked_titles.contains(&"Idea".to_string()));
        assert!(evidence_titles.contains(&"Idea".to_string()));
        assert!(!evidence_titles.contains(&"Problem".to_string()));
        Ok(())
    }

    #[test]
    fn convenience_methods_can_cite_and_uncite_source_chunks() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let problem_id = source_detail.chunks[0].linked_nodes[0].id.clone();
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        let cite_report = workspace.cite_source_chunk(
            problem_id.clone(),
            chunk_id.clone(),
            "inferred".to_string(),
            Some("This chunk supports the draft indirectly.".to_string()),
        )?;
        assert!(cite_report.run_id.is_some());
        let cited_detail = workspace.node_detail(&problem_id)?;
        assert_eq!(cited_detail.evidence.len(), 1);
        assert_eq!(
            cited_detail.evidence[0].citations[0].citation_kind,
            "inferred"
        );
        assert_eq!(
            cited_detail.evidence[0].citations[0].rationale.as_deref(),
            Some("This chunk supports the draft indirectly.")
        );

        let uncite_report = workspace.uncite_source_chunk(problem_id.clone(), chunk_id.clone())?;
        assert!(uncite_report.run_id.is_some());
        assert!(workspace.node_detail(&problem_id)?.evidence.is_empty());
        assert_eq!(workspace.patch_history()?.len(), 3);
        Ok(())
    }

    #[test]
    fn patch_validation_requires_source_link_before_chunk_link() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();
        let node_count_before = workspace.list_nodes()?.len();
        let patch_history_before = workspace.patch_history()?.len();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Attach chunk without source link".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AttachSourceChunk {
                    node_id: "idea".to_string(),
                    chunk_id,
                },
            ],
        };

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("chunk attachment should require a source-level link first");
        assert!(
            error
                .to_string()
                .contains("op 2 attach_source_chunk: cannot attach source chunk")
        );
        assert_eq!(workspace.list_nodes()?.len(), node_count_before);
        assert_eq!(workspace.patch_history()?.len(), patch_history_before);
        Ok(())
    }

    #[test]
    fn patch_validation_requires_source_link_before_citation() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();
        let node_count_before = workspace.list_nodes()?.len();
        let patch_history_before = workspace.patch_history()?.len();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Cite chunk without source link".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::CiteSourceChunk {
                    node_id: "idea".to_string(),
                    chunk_id,
                    citation_kind: None,
                    rationale: None,
                },
            ],
        };

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("citations should require a source-level link first");
        assert!(
            error
                .to_string()
                .contains("op 2 cite_source_chunk: cannot cite source chunk")
        );
        assert_eq!(workspace.list_nodes()?.len(), node_count_before);
        assert_eq!(workspace.patch_history()?.len(), patch_history_before);
        Ok(())
    }

    #[test]
    fn patch_can_detach_source_chunk_then_source_from_node() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let problem_id = source_detail.chunks[0].linked_nodes[0].id.clone();
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Detach imported evidence from a node".to_string()),
            ops: vec![
                PatchOp::DetachSourceChunk {
                    node_id: problem_id.clone(),
                    chunk_id,
                },
                PatchOp::DetachSource {
                    node_id: problem_id.clone(),
                    source_id: import_report.source_id.clone(),
                },
            ],
        };

        let report = workspace.apply_patch_document(patch, "test", false)?;
        assert!(report.run_id.is_some());

        let detail = workspace.node_detail(&problem_id)?;
        assert!(detail.sources.is_empty());

        let refreshed_source = workspace.source_detail(&import_report.source_id)?;
        assert!(refreshed_source.chunks[0].linked_nodes.is_empty());
        Ok(())
    }

    #[test]
    fn patch_validation_rejects_detach_source_before_detach_chunk() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let problem_id = source_detail.chunks[0].linked_nodes[0].id.clone();
        let patch_history_before = workspace.patch_history()?.len();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Detach source too early".to_string()),
            ops: vec![PatchOp::DetachSource {
                node_id: problem_id.clone(),
                source_id: import_report.source_id.clone(),
            }],
        };

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("source detach should require chunk links to be removed first");
        assert!(
            error
                .to_string()
                .contains("op 1 detach_source: cannot detach source")
        );
        assert_eq!(workspace.patch_history()?.len(), patch_history_before);
        assert_eq!(workspace.node_detail(&problem_id)?.sources.len(), 1);
        Ok(())
    }

    #[test]
    fn snapshot_restore_recovers_attached_source_links_without_rewinding_patch_history()
    -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        workspace.apply_patch_document(
            PatchDocument {
                version: 1,
                summary: Some("Attach evidence to idea".to_string()),
                ops: vec![
                    PatchOp::AddNode {
                        id: Some("idea".to_string()),
                        parent_id: "root".to_string(),
                        title: "Idea".to_string(),
                        kind: Some("topic".to_string()),
                        body: None,
                        position: None,
                    },
                    PatchOp::AttachSource {
                        node_id: "idea".to_string(),
                        source_id: import_report.source_id.clone(),
                    },
                    PatchOp::AttachSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_id.clone(),
                    },
                ],
            },
            "test",
            false,
        )?;

        let snapshot = workspace.save_snapshot(Some("with-attached-evidence".to_string()))?;
        assert_eq!(workspace.patch_history()?.len(), 2);
        assert_eq!(workspace.node_detail("idea")?.sources.len(), 1);

        workspace.apply_patch_document(
            PatchDocument {
                version: 1,
                summary: Some("Detach evidence from idea".to_string()),
                ops: vec![
                    PatchOp::DetachSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_id.clone(),
                    },
                    PatchOp::DetachSource {
                        node_id: "idea".to_string(),
                        source_id: import_report.source_id.clone(),
                    },
                ],
            },
            "test",
            false,
        )?;

        assert!(workspace.node_detail("idea")?.sources.is_empty());
        assert_eq!(workspace.patch_history()?.len(), 3);

        workspace.restore_snapshot(&snapshot.id)?;

        let restored_idea = workspace.node_detail("idea")?;
        assert_eq!(restored_idea.sources.len(), 1);
        assert_eq!(restored_idea.sources[0].source.id, import_report.source_id);
        assert_eq!(restored_idea.sources[0].chunks.len(), 1);
        assert_eq!(restored_idea.sources[0].chunks[0].id, chunk_id);

        let restored_source = workspace.source_detail(&import_report.source_id)?;
        let linked_titles = restored_source.chunks[0]
            .linked_nodes
            .iter()
            .map(|node| node.title.clone())
            .collect::<Vec<_>>();
        assert!(linked_titles.contains(&"Idea".to_string()));
        assert!(linked_titles.contains(&"Problem".to_string()));
        assert_eq!(workspace.patch_history()?.len(), 3);
        Ok(())
    }

    #[test]
    fn snapshot_restore_recovers_evidence_citations_without_rewinding_patch_history() -> Result<()>
    {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        workspace.apply_patch_document(
            PatchDocument {
                version: 1,
                summary: Some("Cite evidence for idea".to_string()),
                ops: vec![
                    PatchOp::AddNode {
                        id: Some("idea".to_string()),
                        parent_id: "root".to_string(),
                        title: "Idea".to_string(),
                        kind: Some("topic".to_string()),
                        body: None,
                        position: None,
                    },
                    PatchOp::AttachSource {
                        node_id: "idea".to_string(),
                        source_id: import_report.source_id.clone(),
                    },
                    PatchOp::CiteSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_id.clone(),
                        citation_kind: Some("inferred".to_string()),
                        rationale: Some("Supports the hypothesis indirectly.".to_string()),
                    },
                ],
            },
            "test",
            false,
        )?;

        let snapshot = workspace.save_snapshot(Some("with-citation".to_string()))?;
        assert_eq!(workspace.patch_history()?.len(), 2);
        assert_eq!(workspace.node_detail("idea")?.evidence.len(), 1);

        workspace.apply_patch_document(
            PatchDocument {
                version: 1,
                summary: Some("Remove citation from idea".to_string()),
                ops: vec![PatchOp::UnciteSourceChunk {
                    node_id: "idea".to_string(),
                    chunk_id: chunk_id.clone(),
                }],
            },
            "test",
            false,
        )?;

        assert!(workspace.node_detail("idea")?.evidence.is_empty());
        assert_eq!(workspace.patch_history()?.len(), 3);

        workspace.restore_snapshot(&snapshot.id)?;

        let restored_idea = workspace.node_detail("idea")?;
        assert_eq!(restored_idea.evidence.len(), 1);
        assert_eq!(restored_idea.evidence[0].source.id, import_report.source_id);
        assert_eq!(restored_idea.evidence[0].chunks.len(), 1);
        assert_eq!(restored_idea.evidence[0].chunks[0].id, chunk_id);
        assert_eq!(
            restored_idea.evidence[0].citations[0].citation_kind,
            "inferred"
        );
        assert_eq!(
            restored_idea.evidence[0].citations[0].rationale.as_deref(),
            Some("Supports the hypothesis indirectly.")
        );

        let restored_source = workspace.source_detail(&import_report.source_id)?;
        let evidence_titles = restored_source.chunks[0]
            .evidence_nodes
            .iter()
            .map(|node| node.title.clone())
            .collect::<Vec<_>>();
        assert!(evidence_titles.contains(&"Idea".to_string()));
        assert_eq!(
            restored_source.chunks[0].evidence_links[0].citation_kind,
            "inferred"
        );
        assert_eq!(
            restored_source.chunks[0].evidence_links[0]
                .rationale
                .as_deref(),
            Some("Supports the hypothesis indirectly.")
        );
        assert_eq!(workspace.patch_history()?.len(), 3);
        Ok(())
    }

    #[test]
    fn restoring_snapshot_after_detach_recovers_removed_source_links_but_keeps_later_patch_history()
    -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let imported_problem_id = source_detail.chunks[0].linked_nodes[0].id.clone();
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        workspace.apply_patch_document(
            PatchDocument {
                version: 1,
                summary: Some("Detach imported problem evidence".to_string()),
                ops: vec![
                    PatchOp::DetachSourceChunk {
                        node_id: imported_problem_id.clone(),
                        chunk_id: chunk_id.clone(),
                    },
                    PatchOp::DetachSource {
                        node_id: imported_problem_id.clone(),
                        source_id: import_report.source_id.clone(),
                    },
                ],
            },
            "test",
            false,
        )?;

        let detached_snapshot = workspace.save_snapshot(Some("after-detach".to_string()))?;
        assert!(
            workspace
                .node_detail(&imported_problem_id)?
                .sources
                .is_empty()
        );
        assert_eq!(workspace.patch_history()?.len(), 2);

        workspace.add_node(
            "Later".to_string(),
            "root".to_string(),
            "topic".to_string(),
            None,
            None,
        )?;
        assert_eq!(workspace.patch_history()?.len(), 3);

        workspace.restore_snapshot(&detached_snapshot.id)?;

        assert!(
            workspace
                .node_detail(&imported_problem_id)?
                .sources
                .is_empty()
        );
        assert!(!workspace.tree_string()?.contains("Later"));
        assert_eq!(workspace.patch_history()?.len(), 3);
        Ok(())
    }

    #[test]
    fn patch_validation_allows_new_nodes_referenced_by_later_ops() -> Result<()> {
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
                PatchOp::UpdateNode {
                    id: "parent".to_string(),
                    title: None,
                    body: Some("Generated in one patch".to_string()),
                    kind: None,
                },
            ],
        };

        let report = workspace.apply_patch_document(patch, "test", false)?;
        assert!(report.run_id.is_some());
        assert_eq!(workspace.patch_history()?.len(), 1);
        assert_eq!(workspace.list_nodes()?.len(), 3);

        let parent = workspace.node_detail("parent")?;
        assert_eq!(parent.node.body.as_deref(), Some("Generated in one patch"));
        assert_eq!(parent.children.len(), 1);
        assert_eq!(parent.children[0].id, "child");
        Ok(())
    }

    #[test]
    fn patch_validation_rejects_references_to_nodes_deleted_earlier_in_same_patch() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;

        let patch = PatchDocument {
            version: 1,
            summary: Some("Delete a branch before a later update".to_string()),
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
                PatchOp::DeleteNode {
                    id: "parent".to_string(),
                },
                PatchOp::UpdateNode {
                    id: "child".to_string(),
                    title: Some("Still here".to_string()),
                    body: None,
                    kind: None,
                },
            ],
        };

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("updates after a subtree delete should fail validation");
        assert!(
            error
                .to_string()
                .contains("op 4 update_node: cannot update node child: node was not found")
        );
        assert_eq!(workspace.list_nodes()?.len(), 1);
        assert!(workspace.patch_history()?.is_empty());
        Ok(())
    }

    #[test]
    fn failed_patch_validation_keeps_database_and_archive_clean() -> Result<()> {
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

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("duplicate ids in one patch should fail validation");
        assert!(
            error
                .to_string()
                .contains("op 2 add_node: cannot add node duplicate")
        );

        assert_eq!(workspace.list_nodes()?.len(), 1);
        assert!(workspace.patch_history()?.is_empty());
        assert_eq!(std::fs::read_dir(&workspace.paths.runs_dir)?.count(), 0);
        Ok(())
    }

    #[test]
    fn patch_validation_rejects_invalid_citation_metadata() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## Problem\nThe project needs a crisp scope.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_id = source_detail.chunks[0].chunk.id.clone();

        let patch = PatchDocument {
            version: 1,
            summary: Some("Cite with invalid metadata".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AttachSource {
                    node_id: "idea".to_string(),
                    source_id: import_report.source_id.clone(),
                },
                PatchOp::CiteSourceChunk {
                    node_id: "idea".to_string(),
                    chunk_id,
                    citation_kind: Some("weak".to_string()),
                    rationale: Some("".to_string()),
                },
            ],
        };

        let error = workspace
            .apply_patch_document(patch, "test", false)
            .expect_err("invalid citation metadata should fail validation");
        assert!(
            error
                .to_string()
                .contains("citation_kind must be `direct` or `inferred`")
                || error
                    .to_string()
                    .contains("citation rationale must not be empty")
        );
        Ok(())
    }

    #[test]
    fn applying_patch_from_ai_run_records_patch_link() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;

        workspace.upsert_ai_run_index(&crate::ai::AiRunMetadata {
            run_id: "ai-run-1".to_string(),
            capability: "expand".to_string(),
            explore_by: None,
            node_id: "root".to_string(),
            command: "python3 scripts/provider_runner.py --provider codex".to_string(),
            dry_run: true,
            status: "dry_run_succeeded".to_string(),
            started_at: 1,
            finished_at: 2,
            request_path: temp_dir.path().join("request.json").display().to_string(),
            response_path: temp_dir.path().join("response.json").display().to_string(),
            exit_code: Some(0),
            provider: Some("codex".to_string()),
            model: Some("gpt-5.4-mini".to_string()),
            provider_run_id: Some("provider-run-1".to_string()),
            retry_count: 0,
            used_plain_json_fallback: false,
            normalization_notes: vec![],
            last_error_category: None,
            last_error_message: None,
            last_status_code: None,
            patch_run_id: None,
            patch_summary: None,
        })?;

        let report = workspace.apply_patch_document_with_ai_run(
            PatchDocument {
                version: 1,
                summary: Some("Add linked child".to_string()),
                ops: vec![PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                }],
            },
            "desktop",
            false,
            Some("ai-run-1"),
        )?;

        let ai_run = workspace
            .ai_run_record_by_id("ai-run-1")?
            .context("linked AI run should exist")?;
        assert_eq!(ai_run.patch_run_id, report.run_id);
        assert_eq!(ai_run.patch_summary.as_deref(), Some("Add linked child"));
        Ok(())
    }

    #[test]
    fn ai_run_patch_and_artifacts_can_be_loaded_from_indexed_run() -> Result<()> {
        let temp_dir = tempdir()?;
        let workspace = Workspace::init_at(temp_dir.path())?;
        let preview = workspace.preview_ai_expand("root")?;
        let request_path = temp_dir.path().join("indexed-run.request.json");
        let response_path = temp_dir.path().join("indexed-run.response.json");
        let metadata_path = temp_dir.path().join("indexed-run.meta.json");

        crate::ai::write_ai_json_document(&request_path, &preview.request)?;
        crate::ai::write_ai_json_document(&response_path, &preview.response_template)?;
        crate::ai::write_ai_json_document(
            &metadata_path,
            &serde_json::json!({
                "provider": "test_runner",
                "model": "test-model",
                "provider_run_id": "provider-run-1",
                "retry_count": 0,
                "last_error_category": null,
                "last_error_message": null,
                "last_status_code": null
            }),
        )?;

        workspace.upsert_ai_run_index(&crate::ai::AiRunMetadata {
            run_id: "ai-run-indexed".to_string(),
            capability: "expand".to_string(),
            explore_by: None,
            node_id: "root".to_string(),
            command: "python3 runner.py".to_string(),
            dry_run: true,
            status: "dry_run_succeeded".to_string(),
            started_at: 10,
            finished_at: 11,
            request_path: request_path.display().to_string(),
            response_path: response_path.display().to_string(),
            exit_code: Some(0),
            provider: Some("test_runner".to_string()),
            model: Some("test-model".to_string()),
            provider_run_id: Some("provider-run-1".to_string()),
            retry_count: 0,
            used_plain_json_fallback: false,
            normalization_notes: vec![],
            last_error_category: None,
            last_error_message: None,
            last_status_code: None,
            patch_run_id: None,
            patch_summary: None,
        })?;

        let patch = workspace.ai_run_patch_document("ai-run-indexed")?;
        assert_eq!(patch.summary, preview.response_template.patch.summary);
        let response = workspace.ai_run_response("ai-run-indexed")?;
        assert_eq!(
            response.explanation.rationale_summary,
            preview.response_template.explanation.rationale_summary
        );

        let request_artifact = workspace.ai_run_artifact("ai-run-indexed", "request")?;
        assert_eq!(request_artifact.kind, "request");
        assert_eq!(request_artifact.path, request_path.display().to_string());
        assert!(
            request_artifact
                .content
                .contains("\"kind\": \"nodex_ai_expand_request\"")
        );

        let response_artifact = workspace.ai_run_artifact("ai-run-indexed", "response")?;
        assert_eq!(response_artifact.kind, "response");
        assert_eq!(response_artifact.path, response_path.display().to_string());
        assert!(
            response_artifact
                .content
                .contains("\"kind\": \"nodex_ai_patch_response\"")
        );

        let metadata_artifact = workspace.ai_run_artifact("ai-run-indexed", "metadata")?;
        assert_eq!(metadata_artifact.kind, "metadata");
        assert_eq!(metadata_artifact.path, metadata_path.display().to_string());
        assert!(
            metadata_artifact
                .content
                .contains("\"provider\": \"test_runner\"")
        );
        Ok(())
    }

    #[test]
    fn replay_ai_run_patch_can_preview_response_patch() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let preview = workspace.preview_ai_expand("root")?;
        let request_path = temp_dir.path().join("replay.request.json");
        let response_path = temp_dir.path().join("replay.response.json");

        crate::ai::write_ai_json_document(&request_path, &preview.request)?;
        crate::ai::write_ai_json_document(&response_path, &preview.response_template)?;

        workspace.upsert_ai_run_index(&crate::ai::AiRunMetadata {
            run_id: "ai-run-replay".to_string(),
            capability: "expand".to_string(),
            explore_by: None,
            node_id: "root".to_string(),
            command: "python3 runner.py".to_string(),
            dry_run: true,
            status: "dry_run_succeeded".to_string(),
            started_at: 20,
            finished_at: 21,
            request_path: request_path.display().to_string(),
            response_path: response_path.display().to_string(),
            exit_code: Some(0),
            provider: Some("test_runner".to_string()),
            model: Some("test-model".to_string()),
            provider_run_id: Some("provider-run-2".to_string()),
            retry_count: 0,
            used_plain_json_fallback: false,
            normalization_notes: vec![],
            last_error_category: None,
            last_error_message: None,
            last_status_code: None,
            patch_run_id: None,
            patch_summary: None,
        })?;

        let replay = workspace.replay_ai_run_patch("ai-run-replay", true)?;

        assert_eq!(replay.patch_source, "response_patch");
        assert!(replay.source_patch_run_id.is_none());
        assert!(replay.dry_run);
        assert!(replay.report.run_id.is_none());
        assert!(!replay.report.preview.is_empty());
        assert!(workspace.patch_history()?.is_empty());
        Ok(())
    }

    #[test]
    fn replay_ai_run_patch_apply_links_original_dry_run() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let preview = workspace.preview_ai_expand("root")?;
        let request_path = temp_dir.path().join("replay-apply.request.json");
        let response_path = temp_dir.path().join("replay-apply.response.json");

        crate::ai::write_ai_json_document(&request_path, &preview.request)?;
        crate::ai::write_ai_json_document(&response_path, &preview.response_template)?;

        workspace.upsert_ai_run_index(&crate::ai::AiRunMetadata {
            run_id: "ai-run-replay-apply".to_string(),
            capability: "expand".to_string(),
            explore_by: None,
            node_id: "root".to_string(),
            command: "python3 runner.py".to_string(),
            dry_run: true,
            status: "dry_run_succeeded".to_string(),
            started_at: 22,
            finished_at: 23,
            request_path: request_path.display().to_string(),
            response_path: response_path.display().to_string(),
            exit_code: Some(0),
            provider: Some("test_runner".to_string()),
            model: Some("test-model".to_string()),
            provider_run_id: Some("provider-run-apply".to_string()),
            retry_count: 0,
            used_plain_json_fallback: false,
            normalization_notes: vec![],
            last_error_category: None,
            last_error_message: None,
            last_status_code: None,
            patch_run_id: None,
            patch_summary: None,
        })?;

        let replay = workspace.replay_ai_run_patch("ai-run-replay-apply", false)?;
        let ai_run = workspace
            .ai_run_record_by_id("ai-run-replay-apply")?
            .context("AI run should still exist after replay apply")?;

        assert_eq!(replay.patch_source, "response_patch");
        assert!(replay.report.run_id.is_some());
        assert_eq!(ai_run.patch_run_id, replay.report.run_id);
        assert_eq!(ai_run.patch_summary, replay.report.summary);
        Ok(())
    }

    #[test]
    fn replay_ai_run_patch_reuses_applied_patch_with_fresh_node_ids() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;

        workspace.upsert_ai_run_index(&crate::ai::AiRunMetadata {
            run_id: "ai-run-applied".to_string(),
            capability: "expand".to_string(),
            explore_by: None,
            node_id: "root".to_string(),
            command: "python3 runner.py".to_string(),
            dry_run: false,
            status: "applied".to_string(),
            started_at: 30,
            finished_at: 31,
            request_path: temp_dir.path().join("request.json").display().to_string(),
            response_path: temp_dir.path().join("response.json").display().to_string(),
            exit_code: Some(0),
            provider: Some("test_runner".to_string()),
            model: Some("test-model".to_string()),
            provider_run_id: Some("provider-run-3".to_string()),
            retry_count: 0,
            used_plain_json_fallback: false,
            normalization_notes: vec![],
            last_error_category: None,
            last_error_message: None,
            last_status_code: None,
            patch_run_id: None,
            patch_summary: None,
        })?;

        let original_report = workspace.apply_patch_document_with_ai_run(
            PatchDocument {
                version: 1,
                summary: Some("Replayable branch".to_string()),
                ops: vec![PatchOp::AddNode {
                    id: Some("idea".to_string()),
                    parent_id: "root".to_string(),
                    title: "Idea".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                }],
            },
            "desktop",
            false,
            Some("ai-run-applied"),
        )?;
        assert!(original_report.run_id.is_some());

        let replay = workspace.replay_ai_run_patch("ai-run-applied", false)?;

        assert_eq!(replay.patch_source, "patch_run");
        assert_eq!(replay.source_patch_run_id, original_report.run_id);
        assert!(!replay.dry_run);
        assert!(replay.report.run_id.is_some());
        assert_eq!(
            workspace
                .list_nodes()?
                .into_iter()
                .filter(|node| node.title == "Idea")
                .count(),
            2
        );
        assert_eq!(workspace.patch_history()?.len(), 2);
        Ok(())
    }

    #[test]
    fn snapshot_restore_keeps_ai_runs_and_ai_artifacts() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let command = test_python_command(
            &temp_dir,
            "snapshot_boundary_runner.py",
            r#"import json
import os
from pathlib import Path

request = json.loads(Path(os.environ["NODEX_AI_REQUEST"]).read_text())
response = {
    "version": request["contract"]["version"],
    "kind": request["contract"]["response_kind"],
    "capability": request["capability"],
    "request_node_id": request["target_node"]["id"],
    "status": "ok",
    "summary": "Snapshot boundary runner response",
    "explanation": {
        "rationale_summary": "Create one branch for snapshot boundary testing.",
        "direct_evidence": [],
        "inferred_suggestions": []
    },
    "generator": {
        "provider": "test_runner",
        "model": None,
        "run_id": "snapshot-boundary-run"
    },
    "patch": {
        "version": request["contract"]["patch_version"],
        "summary": "Snapshot boundary runner response",
        "ops": [
            {
                "type": "add_node",
                "parent_id": request["target_node"]["id"],
                "title": "Snapshot Boundary Branch",
                "kind": "topic",
                "body": "Generated for snapshot boundary coverage"
            }
        ]
    },
    "notes": []
}
Path(os.environ["NODEX_AI_RESPONSE"]).write_text(json.dumps(response, indent=2))
"#,
        )?;

        let runner_report = workspace.run_external_ai_expand("root", &command, true)?;
        let snapshot = workspace.save_snapshot(Some("before-local-edit".to_string()))?;
        workspace.add_node(
            "Local Edit".to_string(),
            "root".to_string(),
            "topic".to_string(),
            None,
            None,
        )?;

        workspace.restore_snapshot(&snapshot.id)?;

        let ai_history = workspace.ai_run_history(Some("root"))?;
        assert_eq!(ai_history.len(), 1);
        assert_eq!(ai_history[0].status, "dry_run_succeeded");
        assert_eq!(
            ai_history[0].request_path,
            runner_report.metadata.request_path
        );
        assert_eq!(
            ai_history[0].response_path,
            runner_report.metadata.response_path
        );
        assert!(Path::new(&ai_history[0].request_path).exists());
        assert!(Path::new(&ai_history[0].response_path).exists());
        let metadata_path = crate::ai::derive_ai_metadata_path(&ai_history[0].response_path)
            .context("expected metadata path to be derivable from response path")?;
        assert!(Path::new(&metadata_path).exists());
        assert!(
            !workspace.tree_string()?.contains("Local Edit"),
            "snapshot restore should rewind content state"
        );
        Ok(())
    }

    #[test]
    fn open_workspace_migrates_legacy_node_evidence_schema() -> Result<()> {
        let temp_dir = tempdir()?;
        let root = temp_dir.path().canonicalize()?;
        let paths = ProjectPaths::for_root(root.clone());
        paths.create_layout()?;

        let conn = rusqlite::Connection::open(&paths.db_path)?;
        conn.execute_batch(
            "
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE nodes (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                body TEXT,
                kind TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                original_path TEXT NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                format TEXT NOT NULL,
                imported_at INTEGER NOT NULL
            );

            CREATE TABLE source_chunks (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL,
                label TEXT,
                text TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL
            );

            CREATE TABLE node_sources (
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                PRIMARY KEY (node_id, source_id)
            );

            CREATE TABLE node_source_chunks (
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
                PRIMARY KEY (node_id, chunk_id)
            );

            CREATE TABLE node_evidence_chunks (
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
                PRIMARY KEY (node_id, chunk_id)
            );
            ",
        )?;
        conn.execute(
            "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
            params!["schema_version", "2"],
        )?;
        conn.execute(
            "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
            params!["workspace_name", "Legacy Workspace"],
        )?;
        conn.execute(
            "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
            params!["root_id", "root"],
        )?;
        conn.execute(
            "INSERT INTO nodes (id, parent_id, title, body, kind, position, created_at, updated_at)
             VALUES ('root', NULL, 'Legacy Workspace', NULL, 'topic', 0, 0, 0)",
            [],
        )?;
        conn.execute(
            "INSERT INTO sources (id, original_path, original_name, stored_name, format, imported_at)
             VALUES ('source-1', '/tmp/legacy.md', 'legacy.md', 'source-1.md', 'markdown', 0)",
            [],
        )?;
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, ordinal, label, text, start_line, end_line)
             VALUES ('chunk-1', 'source-1', 0, 'Problem', 'Legacy text', 1, 1)",
            [],
        )?;
        conn.execute(
            "INSERT INTO node_sources (node_id, source_id) VALUES ('root', 'source-1')",
            [],
        )?;
        conn.execute(
            "INSERT INTO node_evidence_chunks (node_id, chunk_id) VALUES ('root', 'chunk-1')",
            [],
        )?;
        drop(conn);

        let workspace = Workspace::open_from(&root)?;
        let evidence = workspace.list_node_evidence_chunks()?;

        assert_eq!(
            workspace.metadata_value("schema_version")?.as_deref(),
            Some("5")
        );
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].citation_kind, "direct");
        assert!(evidence[0].rationale.is_none());
        Ok(())
    }

    #[test]
    fn open_workspace_migrates_legacy_ai_run_metadata_schema() -> Result<()> {
        let temp_dir = tempdir()?;
        let root = temp_dir.path().canonicalize()?;
        let paths = ProjectPaths::for_root(root.clone());
        paths.create_layout()?;

        let conn = rusqlite::Connection::open(&paths.db_path)?;
        conn.execute_batch(
            "
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE ai_runs (
                id TEXT PRIMARY KEY,
                capability TEXT NOT NULL,
                explore_by TEXT,
                node_id TEXT NOT NULL,
                command TEXT NOT NULL,
                dry_run INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER NOT NULL,
                request_path TEXT NOT NULL,
                response_path TEXT NOT NULL,
                exit_code INTEGER,
                provider TEXT,
                model TEXT,
                provider_run_id TEXT,
                retry_count INTEGER NOT NULL,
                last_error_category TEXT,
                last_error_message TEXT,
                last_status_code INTEGER,
                patch_run_id TEXT,
                patch_summary TEXT
            );
            ",
        )?;
        conn.execute(
            "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
            params!["schema_version", "4"],
        )?;
        conn.execute(
            "INSERT INTO ai_runs (
                id, capability, explore_by, node_id, command, dry_run, status, started_at,
                finished_at, request_path, response_path, exit_code, provider, model,
                provider_run_id, retry_count, last_error_category, last_error_message,
                last_status_code, patch_run_id, patch_summary
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19, ?20, ?21
            )",
            params![
                "legacy-run",
                "expand",
                Option::<String>::None,
                "root",
                "python3 legacy_runner.py",
                1,
                "dry_run_succeeded",
                10,
                11,
                "/tmp/legacy.request.json",
                "/tmp/legacy.response.json",
                0,
                "legacy-provider",
                "legacy-model",
                "legacy-provider-run",
                0,
                Option::<String>::None,
                Option::<String>::None,
                Option::<i32>::None,
                Option::<String>::None,
                Option::<String>::None,
            ],
        )?;
        drop(conn);

        let workspace = Workspace::open_from(&root)?;
        let record = workspace
            .ai_run_record_by_id("legacy-run")?
            .context("legacy ai run should still exist after migration")?;

        assert_eq!(
            workspace.metadata_value("schema_version")?.as_deref(),
            Some("5")
        );
        assert!(workspace.table_has_column("ai_runs", "used_plain_json_fallback")?);
        assert!(workspace.table_has_column("ai_runs", "normalization_notes")?);
        assert!(!record.used_plain_json_fallback);
        assert!(record.normalization_notes.is_empty());
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
