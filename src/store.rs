use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use uuid::Uuid;

use crate::model::{
    ApplyPatchReport, Node, PatchRunRecord, SnapshotRecord, SnapshotState, TreeNode,
};
use crate::patch::{PatchDocument, PatchOp};
use crate::project::ProjectPaths;

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
        transaction.execute("DELETE FROM nodes", [])?;
        transaction.execute("DELETE FROM metadata", [])?;

        for (key, value) in snapshot.metadata {
            transaction.execute(
                "INSERT INTO metadata (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }

        for node in snapshot.nodes {
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
        Ok(())
    }
}
