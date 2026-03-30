use std::{path::Path, sync::Mutex};

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
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, command,
    menu::{Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder},
};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize, Clone)]
struct WorkspaceOverview {
    root_dir: String,
    workspace_name: String,
    tree: TreeNode,
    sources: Vec<SourceRecord>,
    snapshots: Vec<SnapshotRecord>,
    patch_history: Vec<PatchRunRecord>,
}

#[derive(Default)]
struct DesktopState {
    current_workspace: Mutex<Option<String>>,
    menu_locale: Mutex<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ConsoleEventPayload {
    message: String,
    tone: String,
}

#[derive(Debug, Serialize, Clone)]
struct WorkspaceLoadedPayload {
    overview: WorkspaceOverview,
    message: String,
    tone: String,
}

#[derive(Debug, Serialize, Clone)]
struct PatchEditorPayload {
    patch_json: String,
    message: String,
    tone: String,
}

#[derive(Debug, Serialize, Clone)]
struct LanguagePayload {
    preference: String,
}

const EVENT_CONSOLE: &str = "desktop://console";
const EVENT_WORKSPACE_LOADED: &str = "desktop://workspace-loaded";
const EVENT_PATCH_EDITOR: &str = "desktop://patch-editor";
const EVENT_LANGUAGE: &str = "desktop://language";

const MENU_WORKSPACE_OPEN: &str = "workspace.open_or_init";
const MENU_WORKSPACE_REFRESH: &str = "workspace.refresh";
const MENU_WORKSPACE_SAVE_SNAPSHOT: &str = "workspace.save_snapshot";
const MENU_SOURCE_PREVIEW_IMPORT: &str = "source.preview_import";
const MENU_SOURCE_RUN_IMPORT: &str = "source.run_import";
const MENU_LANGUAGE_AUTO: &str = "language.auto";
const MENU_LANGUAGE_ZH: &str = "language.zh_cn";
const MENU_LANGUAGE_EN: &str = "language.en_us";
const MENU_RESTORE_PREFIX: &str = "workspace.restore.";
const MENU_HISTORY_PREFIX: &str = "history.load.";

fn menu_label(locale: &str, key: &str) -> &'static str {
    match (locale, key) {
        ("zh-CN", "workspace") => "工作区",
        ("zh-CN", "open_folder") => "打开文件夹…",
        ("zh-CN", "refresh") => "刷新",
        ("zh-CN", "save_snapshot") => "保存快照",
        ("zh-CN", "restore_snapshot") => "恢复快照",
        ("zh-CN", "source") => "来源",
        ("zh-CN", "preview_import") => "预览导入文件…",
        ("zh-CN", "run_import") => "导入文件…",
        ("zh-CN", "history") => "历史",
        ("zh-CN", "language") => "语言",
        ("zh-CN", "auto") => "跟随系统",
        ("zh-CN", "english") => "English",
        ("zh-CN", "none") => "（无）",
        (_, "workspace") => "Workspace",
        (_, "open_folder") => "Open Folder...",
        (_, "refresh") => "Refresh",
        (_, "save_snapshot") => "Save Snapshot",
        (_, "restore_snapshot") => "Restore Snapshot",
        (_, "source") => "Source",
        (_, "preview_import") => "Preview Import File...",
        (_, "run_import") => "Import File...",
        (_, "history") => "History",
        (_, "language") => "Language",
        (_, "auto") => "Auto",
        (_, "english") => "English",
        (_, "none") => "(none)",
        _ => "",
    }
}

fn current_menu_locale(state: &DesktopState) -> String {
    state
        .menu_locale
        .lock()
        .ok()
        .map(|value| value.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "en-US".to_string())
}

fn workspace_overview(workspace: &Workspace) -> Result<WorkspaceOverview> {
    Ok(WorkspaceOverview {
        root_dir: display_path(workspace.paths.root_dir.as_path()),
        workspace_name: workspace.workspace_name()?,
        tree: workspace.tree()?,
        sources: normalize_source_records(workspace.list_sources()?),
        snapshots: workspace.list_snapshots()?,
        patch_history: workspace.patch_history()?,
    })
}

fn open_workspace_from(start_path: &str) -> Result<Workspace> {
    Workspace::open_from(Path::new(start_path))
}

fn open_or_init_workspace_from(start_path: &Path) -> Result<(Workspace, bool)> {
    match Workspace::open_from(start_path) {
        Ok(workspace) => Ok((workspace, false)),
        Err(err) if err.to_string().contains("no Nodex workspace found above") => {
            Ok((Workspace::init_at(start_path)?, true))
        }
        Err(err) => Err(err),
    }
}

fn parse_patch_document(patch_json: &str) -> Result<PatchDocument> {
    serde_json::from_str(patch_json).context("failed to parse patch JSON")
}

fn set_current_workspace<R: Runtime>(app: &AppHandle<R>, state: &DesktopState, root_dir: String) {
    if let Ok(mut current_workspace) = state.current_workspace.lock() {
        *current_workspace = Some(root_dir);
    }
    let _ = refresh_native_menu(app, state);
}

fn current_workspace_path(state: &DesktopState) -> Option<String> {
    state
        .current_workspace
        .lock()
        .ok()
        .and_then(|current| current.clone())
}

fn emit_console<R: Runtime>(app: &AppHandle<R>, message: impl Into<String>, tone: &str) {
    let _ = app.emit(
        EVENT_CONSOLE,
        ConsoleEventPayload {
            message: message.into(),
            tone: tone.to_string(),
        },
    );
}

fn emit_workspace_loaded<R: Runtime>(
    app: &AppHandle<R>,
    state: &DesktopState,
    overview: WorkspaceOverview,
    message: impl Into<String>,
) {
    set_current_workspace(app, state, overview.root_dir.clone());
    let _ = app.emit(
        EVENT_WORKSPACE_LOADED,
        WorkspaceLoadedPayload {
            overview,
            message: message.into(),
            tone: "success".to_string(),
        },
    );
}

fn emit_patch_editor<R: Runtime>(
    app: &AppHandle<R>,
    patch: &PatchDocument,
    message: impl Into<String>,
) {
    let patch_json = serde_json::to_string_pretty(patch).unwrap_or_else(|_| "{}".to_string());
    let _ = app.emit(
        EVENT_PATCH_EDITOR,
        PatchEditorPayload {
            patch_json,
            message: message.into(),
            tone: "success".to_string(),
        },
    );
}

fn emit_language<R: Runtime>(app: &AppHandle<R>, preference: &str) {
    let _ = app.emit(
        EVENT_LANGUAGE,
        LanguagePayload {
            preference: preference.to_string(),
        },
    );
}

fn normalize_source_records(sources: Vec<SourceRecord>) -> Vec<SourceRecord> {
    sources.into_iter().map(normalize_source_record).collect()
}

fn normalize_source_record(mut source: SourceRecord) -> SourceRecord {
    source.original_path = display_path_text(&source.original_path);
    source
}

fn normalize_node_detail(mut detail: NodeDetail) -> NodeDetail {
    detail.sources = detail
        .sources
        .into_iter()
        .map(|mut source_detail| {
            source_detail.source = normalize_source_record(source_detail.source);
            source_detail
        })
        .collect();
    detail
}

fn normalize_source_detail(mut detail: SourceDetail) -> SourceDetail {
    detail.source = normalize_source_record(detail.source);
    detail
}

fn display_path(path: &Path) -> String {
    display_path_text(&path.display().to_string())
}

fn display_path_text(path: &str) -> String {
    #[cfg(windows)]
    {
        if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{path}");
        }

        if let Some(path) = path.strip_prefix(r"\\?\") {
            return path.to_string();
        }
    }

    path.to_string()
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

fn build_native_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: &DesktopState,
) -> tauri::Result<Menu<R>> {
    let locale = current_menu_locale(state);
    let workspace_path = current_workspace_path(state);
    let workspace = workspace_path
        .as_deref()
        .and_then(|path| open_workspace_from(path).ok());

    let restore_snapshot_menu = {
        let mut submenu = SubmenuBuilder::new(app, menu_label(&locale, "restore_snapshot"));
        if let Some(workspace) = workspace.as_ref() {
            let snapshots = workspace.list_snapshots().unwrap_or_default();
            if snapshots.is_empty() {
                submenu = submenu.item(&MenuItem::with_id(
                    app,
                    "noop.restore",
                    menu_label(&locale, "none"),
                    false,
                    None::<&str>,
                )?);
            } else {
                for snapshot in snapshots.into_iter().take(8) {
                    let label = snapshot.label.unwrap_or(snapshot.id.clone());
                    submenu = submenu.text(format!("{MENU_RESTORE_PREFIX}{}", snapshot.id), label);
                }
            }
        } else {
            submenu = submenu.item(&MenuItem::with_id(
                app,
                "noop.restore",
                menu_label(&locale, "none"),
                false,
                None::<&str>,
            )?);
        }
        submenu.build()?
    };

    let history_menu = {
        let mut submenu = SubmenuBuilder::new(app, menu_label(&locale, "history"));
        if let Some(workspace) = workspace.as_ref() {
            let history = workspace.patch_history().unwrap_or_default();
            if history.is_empty() {
                submenu = submenu.item(&MenuItem::with_id(
                    app,
                    "noop.history",
                    menu_label(&locale, "none"),
                    false,
                    None::<&str>,
                )?);
            } else {
                for entry in history.into_iter().take(8) {
                    let label = entry.summary.unwrap_or(entry.id.clone());
                    submenu = submenu.text(format!("{MENU_HISTORY_PREFIX}{}", entry.id), label);
                }
            }
        } else {
            submenu = submenu.item(&MenuItem::with_id(
                app,
                "noop.history",
                menu_label(&locale, "none"),
                false,
                None::<&str>,
            )?);
        }
        submenu.build()?
    };

    MenuBuilder::new(app)
        .item(
            &SubmenuBuilder::new(app, menu_label(&locale, "workspace"))
                .text(MENU_WORKSPACE_OPEN, menu_label(&locale, "open_folder"))
                .text(MENU_WORKSPACE_REFRESH, menu_label(&locale, "refresh"))
                .text(MENU_WORKSPACE_SAVE_SNAPSHOT, menu_label(&locale, "save_snapshot"))
                .separator()
                .item(&restore_snapshot_menu)
                .build()?,
        )
        .item(
            &SubmenuBuilder::new(app, menu_label(&locale, "source"))
                .text(MENU_SOURCE_PREVIEW_IMPORT, menu_label(&locale, "preview_import"))
                .text(MENU_SOURCE_RUN_IMPORT, menu_label(&locale, "run_import"))
                .build()?,
        )
        .item(&history_menu)
        .item(
            &SubmenuBuilder::new(app, menu_label(&locale, "language"))
                .text(MENU_LANGUAGE_AUTO, menu_label(&locale, "auto"))
                .text(MENU_LANGUAGE_ZH, "简体中文")
                .text(MENU_LANGUAGE_EN, menu_label(&locale, "english"))
                .build()?,
        )
        .build()
}

fn refresh_native_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: &DesktopState,
) -> tauri::Result<()> {
    let menu = build_native_menu(app, state)?;
    let _ = app.set_menu(menu)?;
    Ok(())
}

fn with_current_workspace<T, F>(state: &DesktopState, operation: F) -> Result<T>
where
    F: FnOnce(&mut Workspace) -> Result<T>,
{
    let workspace_path = current_workspace_path(state)
        .context("no workspace is currently open; use Workspace > Open Folder first")?;
    let mut workspace = open_workspace_from(&workspace_path)?;
    operation(&mut workspace)
}

fn handle_workspace_open_menu<R: Runtime>(app: &AppHandle<R>) {
    let app_handle = app.clone();

    app.dialog().file().pick_folder(move |folder| {
        let Some(folder) = folder.and_then(|path| path.into_path().ok()) else {
            return;
        };

        match open_or_init_workspace_from(&folder)
            .and_then(|(workspace, initialized)| Ok((workspace_overview(&workspace)?, initialized)))
        {
            Ok((overview, initialized)) => {
                let message = if initialized {
                    format!("Initialized and opened {}", overview.root_dir)
                } else {
                    format!("Opened {}", overview.root_dir)
                };
                let state = app_handle.state::<DesktopState>();
                emit_workspace_loaded(&app_handle, state.inner(), overview, message);
            }
            Err(err) => emit_console(&app_handle, err.to_string(), "error"),
        }
    });
}

fn handle_source_import_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: &DesktopState,
    preview: bool,
) {
    let app_handle = app.clone();
    let workspace_path = match current_workspace_path(state) {
        Some(path) => path,
        None => {
            emit_console(app, "Open a workspace first.", "error");
            return;
        }
    };

    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Text", &["txt", "text"])
        .pick_file(move |file| {
            let Some(file_path) = file.and_then(|path| path.into_path().ok()) else {
                return;
            };

            if preview {
                match open_workspace_from(&workspace_path)
                    .and_then(|workspace| workspace.preview_source_import(&file_path))
                {
                    Ok(preview_result) => {
                        emit_patch_editor(
                            &app_handle,
                            &preview_result.patch,
                            format!("Previewed import for {}", preview_result.report.original_name),
                        );
                    }
                    Err(err) => emit_console(&app_handle, err.to_string(), "error"),
                }
            } else {
                match open_workspace_from(&workspace_path)
                    .and_then(|mut workspace| workspace.import_source(&file_path))
                    .and_then(|report| {
                        let workspace = open_workspace_from(&workspace_path)?;
                        Ok((workspace_overview(&workspace)?, report))
                    })
                {
                    Ok((overview, report)) => {
                        let state = app_handle.state::<DesktopState>();
                        emit_workspace_loaded(
                            &app_handle,
                            state.inner(),
                            overview,
                            format!("Imported {}", report.original_name),
                        );
                    }
                    Err(err) => emit_console(&app_handle, err.to_string(), "error"),
                }
            }
        });
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, state: &DesktopState, event: MenuEvent) {
    let event_id = event.id().as_ref();

    match event_id {
        MENU_WORKSPACE_OPEN => handle_workspace_open_menu(app),
        MENU_WORKSPACE_REFRESH => match with_current_workspace(state, |workspace| workspace_overview(workspace)) {
            Ok(overview) => emit_workspace_loaded(app, state, overview, "Workspace refreshed."),
            Err(err) => emit_console(app, err.to_string(), "error"),
        },
        MENU_WORKSPACE_SAVE_SNAPSHOT => match with_current_workspace(state, |workspace| workspace.save_snapshot(None)) {
            Ok(snapshot) => {
                let _ = refresh_native_menu(app, state);
                emit_console(app, format!("Saved snapshot {}", snapshot.id), "success");
            }
            Err(err) => emit_console(app, err.to_string(), "error"),
        },
        MENU_SOURCE_PREVIEW_IMPORT => handle_source_import_menu(app, state, true),
        MENU_SOURCE_RUN_IMPORT => handle_source_import_menu(app, state, false),
        MENU_LANGUAGE_AUTO => emit_language(app, "auto"),
        MENU_LANGUAGE_ZH => emit_language(app, "zh-CN"),
        MENU_LANGUAGE_EN => emit_language(app, "en-US"),
        _ if event_id.starts_with(MENU_RESTORE_PREFIX) => {
            let snapshot_id = event_id.trim_start_matches(MENU_RESTORE_PREFIX);
            match with_current_workspace(state, |workspace| {
                workspace.restore_snapshot(snapshot_id)?;
                workspace_overview(workspace)
            }) {
                Ok(overview) => {
                    emit_workspace_loaded(app, state, overview, format!("Restored snapshot {snapshot_id}"))
                }
                Err(err) => emit_console(app, err.to_string(), "error"),
            }
        }
        _ if event_id.starts_with(MENU_HISTORY_PREFIX) => {
            let run_id = event_id.trim_start_matches(MENU_HISTORY_PREFIX);
            match with_current_workspace(state, |workspace| workspace.patch_document_by_run_id(run_id)) {
                Ok(patch) => emit_patch_editor(app, &patch, format!("Loaded patch {run_id}")),
                Err(err) => emit_console(app, err.to_string(), "error"),
            }
        }
        _ => {}
    }
}

#[command]
fn open_workspace(
    app: AppHandle,
    state: State<DesktopState>,
    start_path: String,
) -> Result<WorkspaceOverview, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let overview = workspace_overview(&workspace).map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), overview.root_dir.clone());
    Ok(overview)
}

#[command]
fn init_workspace(
    app: AppHandle,
    state: State<DesktopState>,
    root_path: String,
) -> Result<WorkspaceOverview, String> {
    let workspace = Workspace::init_at(Path::new(&root_path)).map_err(|err| err.to_string())?;
    let overview = workspace_overview(&workspace).map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), overview.root_dir.clone());
    Ok(overview)
}

#[command]
fn open_or_init_workspace(
    app: AppHandle,
    state: State<DesktopState>,
    root_path: String,
) -> Result<WorkspaceOverview, String> {
    let (workspace, _) =
        open_or_init_workspace_from(Path::new(&root_path)).map_err(|err| err.to_string())?;
    let overview = workspace_overview(&workspace).map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), overview.root_dir.clone());
    Ok(overview)
}

#[command]
fn set_menu_locale(
    app: AppHandle,
    state: State<DesktopState>,
    locale: String,
) -> Result<(), String> {
    if let Ok(mut current_locale) = state.menu_locale.lock() {
        *current_locale = locale;
    }
    refresh_native_menu(&app, state.inner()).map_err(|err| err.to_string())
}

#[command]
fn get_node_detail(start_path: String, node_id: String) -> Result<NodeDetail, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .node_detail(&node_id)
        .map(normalize_node_detail)
        .map_err(|err| err.to_string())
}

#[command]
fn get_source_detail(start_path: String, source_id: String) -> Result<SourceDetail, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .source_detail(&source_id)
        .map(normalize_source_detail)
        .map_err(|err| err.to_string())
}

#[command]
fn preview_source_import(
    start_path: String,
    source_path: String,
) -> Result<SourceImportPreview, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .preview_source_import(Path::new(&source_path))
        .map_err(|err| err.to_string())
}

#[command]
fn import_source(
    app: AppHandle,
    state: State<DesktopState>,
    start_path: String,
    source_path: String,
) -> Result<SourceImportReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let report = workspace
        .import_source(Path::new(&source_path))
        .map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), display_path(workspace.paths.root_dir.as_path()));
    Ok(report)
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
fn apply_patch(
    app: AppHandle,
    state: State<DesktopState>,
    start_path: String,
    patch_json: String,
) -> Result<ApplyPatchReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let patch = parse_patch_document(&patch_json).map_err(|err| err.to_string())?;
    let report = workspace
        .apply_patch_document(patch, "desktop", false)
        .map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), display_path(workspace.paths.root_dir.as_path()));
    Ok(report)
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
fn draft_move_node_patch(
    node_id: String,
    parent_id: String,
    position: Option<i64>,
) -> PatchDocument {
    move_node_patch(node_id, parent_id, position)
}

#[command]
fn draft_delete_node_patch(node_id: String) -> PatchDocument {
    delete_node_patch(node_id)
}

#[command]
fn save_snapshot(
    app: AppHandle,
    state: State<DesktopState>,
    start_path: String,
    label: Option<String>,
) -> Result<SnapshotRecord, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let snapshot = workspace
        .save_snapshot(label)
        .map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), display_path(workspace.paths.root_dir.as_path()));
    Ok(snapshot)
}

#[command]
fn restore_snapshot(
    app: AppHandle,
    state: State<DesktopState>,
    start_path: String,
    snapshot_id: String,
) -> Result<WorkspaceOverview, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .restore_snapshot(&snapshot_id)
        .map_err(|err| err.to_string())?;
    let overview = workspace_overview(&workspace).map_err(|err| err.to_string())?;
    set_current_workspace(&app, state.inner(), overview.root_dir.clone());
    Ok(overview)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| {
            let state = app.state::<DesktopState>();
            build_native_menu(app, state.inner())
        })
        .on_menu_event(|app, event| {
            let state = app.state::<DesktopState>();
            handle_menu_event(app, state.inner(), event);
        })
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
            open_or_init_workspace,
            open_workspace,
            preview_patch,
            preview_source_import,
            restore_snapshot,
            save_snapshot,
            set_menu_locale,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Nodex desktop shell");
}

#[cfg(test)]
mod tests {
    use super::display_path_text;

    #[test]
    #[cfg(windows)]
    fn strips_windows_verbatim_disk_prefix_for_display() {
        assert_eq!(
            display_path_text(r"\\?\C:\Users\XUO\Projects\test"),
            r"C:\Users\XUO\Projects\test"
        );
    }

    #[test]
    #[cfg(windows)]
    fn strips_windows_verbatim_unc_prefix_for_display() {
        assert_eq!(
            display_path_text(r"\\?\UNC\server\share\folder"),
            r"\\server\share\folder"
        );
    }
}
