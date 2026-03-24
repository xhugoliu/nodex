use std::path::Path;

use anyhow::{Context, Result};
use nodex::{
    model::{
        ApplyPatchReport, NodeDetail, PatchRunRecord, SnapshotRecord, SourceDetail,
        SourceImportPreview, SourceImportReport, SourceRecord, TreeNode,
    },
    patch::PatchDocument,
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
        .invoke_handler(tauri::generate_handler![
            apply_patch,
            get_node_detail,
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
