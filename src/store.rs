use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use uuid::Uuid;

use crate::model::{
    ApplyPatchReport, Node, NodeDetail, NodeSourceChunkRecord, NodeSourceDetail, NodeSourceRecord,
    NodeSummary, PatchRunRecord, SnapshotRecord, SnapshotState, SourceChunkDetail,
    SourceChunkRecord, SourceDetail, SourceImportPreview, SourceImportReport, SourceRecord,
    TreeNode,
};
use crate::patch::{PatchDocument, PatchOp};
use crate::project::ProjectPaths;
use crate::source::{ImportedNode, SourceChunkDraft, load_source_plan};

mod patching;
mod queries;
mod snapshots;
mod source_import;

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
