use std::path::Path;

use anyhow::{Context, Result};
use nodex::{
    model::{
        ApplyPatchReport, NodeDetail, PatchRunRecord, SnapshotRecord, SourceDetail,
        SourceImportPreview, SourceImportReport, SourceRecord, TreeNode,
    },
    patch::{PatchDocument, PatchOp},
    store::Workspace,
};
use serde::Serialize;
use tauri::command;

#[derive(Debug, Serialize)]
struct WorkspaceOverview {
    root_dir: String,
    workspace_name: String,
    tree: TreeNode,
    sources: Vec<SourceRecord>,
    snapshots: Vec<SnapshotRecord>,
    patch_history: Vec<PatchRunRecord>,
}

fn workspace_overview(workspace: &Workspace) -> Result<WorkspaceOverview> {
    Ok(WorkspaceOverview {
        root_dir: workspace.paths.root_dir.display().to_string(),
        workspace_name: workspace.workspace_name()?,
        tree: workspace.tree()?,
        sources: workspace.list_sources()?,
        snapshots: workspace.list_snapshots()?,
        patch_history: workspace.patch_history()?,
    })
}

fn open_workspace_from(start_path: &str) -> Result<Workspace> {
    Workspace::open_from(Path::new(start_path))
}

fn parse_patch_document(patch_json: &str) -> Result<PatchDocument> {
    serde_json::from_str(patch_json).context("failed to parse patch JSON")
}

fn add_node_patch(
    title: String,
    parent_id: String,
    kind: Option<String>,
    body: Option<String>,
    position: Option<i64>,
) -> PatchDocument {
    PatchDocument {
        version: 1,
        summary: Some(format!("Add node \"{title}\"")),
        ops: vec![PatchOp::AddNode {
            id: None,
            parent_id,
            title,
            kind,
            body,
            position,
        }],
    }
}

fn update_node_patch(
    node_id: String,
    title: Option<String>,
    body: Option<String>,
    kind: Option<String>,
) -> PatchDocument {
    PatchDocument {
        version: 1,
        summary: Some(format!("Update node {node_id}")),
        ops: vec![PatchOp::UpdateNode {
            id: node_id,
            title,
            body,
            kind,
        }],
    }
}

fn move_node_patch(node_id: String, parent_id: String, position: Option<i64>) -> PatchDocument {
    PatchDocument {
        version: 1,
        summary: Some(format!("Move node {node_id}")),
        ops: vec![PatchOp::MoveNode {
            id: node_id,
            parent_id,
            position,
        }],
    }
}

fn delete_node_patch(node_id: String) -> PatchDocument {
    PatchDocument {
        version: 1,
        summary: Some(format!("Delete node {node_id}")),
        ops: vec![PatchOp::DeleteNode { id: node_id }],
    }
}

#[command]
fn open_workspace(start_path: String) -> Result<WorkspaceOverview, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace_overview(&workspace).map_err(|err| err.to_string())
}

#[command]
fn init_workspace(root_path: String) -> Result<WorkspaceOverview, String> {
    let workspace = Workspace::init_at(Path::new(&root_path)).map_err(|err| err.to_string())?;
    workspace_overview(&workspace).map_err(|err| err.to_string())
}

#[command]
fn get_node_detail(start_path: String, node_id: String) -> Result<NodeDetail, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace.node_detail(&node_id).map_err(|err| err.to_string())
}

#[command]
fn get_source_detail(start_path: String, source_id: String) -> Result<SourceDetail, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace.source_detail(&source_id).map_err(|err| err.to_string())
}

#[command]
fn preview_source_import(start_path: String, source_path: String) -> Result<SourceImportPreview, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .preview_source_import(Path::new(&source_path))
        .map_err(|err| err.to_string())
}

#[command]
fn import_source(start_path: String, source_path: String) -> Result<SourceImportReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .import_source(Path::new(&source_path))
        .map_err(|err| err.to_string())
}

#[command]
fn preview_patch(start_path: String, patch_json: String) -> Result<ApplyPatchReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let patch = parse_patch_document(&patch_json).map_err(|err| err.to_string())?;
    workspace
        .apply_patch_document(patch, "desktop", true)
        .map_err(|err| err.to_string())
}

#[command]
fn apply_patch(start_path: String, patch_json: String) -> Result<ApplyPatchReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let patch = parse_patch_document(&patch_json).map_err(|err| err.to_string())?;
    workspace
        .apply_patch_document(patch, "desktop", false)
        .map_err(|err| err.to_string())
}

#[command]
fn get_patch_document(start_path: String, run_id: String) -> Result<PatchDocument, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .patch_document_by_run_id(&run_id)
        .map_err(|err| err.to_string())
}

#[command]
fn draft_add_node_patch(
    title: String,
    parent_id: String,
    kind: Option<String>,
    body: Option<String>,
    position: Option<i64>,
) -> PatchDocument {
    add_node_patch(title, parent_id, kind, body, position)
}

#[command]
fn draft_update_node_patch(
    node_id: String,
    title: Option<String>,
    body: Option<String>,
    kind: Option<String>,
) -> PatchDocument {
    update_node_patch(node_id, title, body, kind)
}

#[command]
fn draft_move_node_patch(node_id: String, parent_id: String, position: Option<i64>) -> PatchDocument {
    move_node_patch(node_id, parent_id, position)
}

#[command]
fn draft_delete_node_patch(node_id: String) -> PatchDocument {
    delete_node_patch(node_id)
}

#[command]
fn save_snapshot(start_path: String, label: Option<String>) -> Result<SnapshotRecord, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace.save_snapshot(label).map_err(|err| err.to_string())
}

#[command]
fn restore_snapshot(start_path: String, snapshot_id: String) -> Result<WorkspaceOverview, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .restore_snapshot(&snapshot_id)
        .map_err(|err| err.to_string())?;
    workspace_overview(&workspace).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            apply_patch,
            draft_add_node_patch,
            draft_delete_node_patch,
            draft_move_node_patch,
            draft_update_node_patch,
            get_node_detail,
            get_patch_document,
            get_source_detail,
            import_source,
            init_workspace,
            open_workspace,
            preview_patch,
            preview_source_import,
            restore_snapshot,
            save_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Nodex desktop shell");
}
