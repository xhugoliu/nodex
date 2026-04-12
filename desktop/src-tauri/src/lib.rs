use std::{
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, Stdio},
    sync::Mutex,
};

use anyhow::{Context, Result};
use nodex::{
    ai::{AiPatchExplanation, AiRunCompareOutput, AiRunShowOutput, ExternalRunnerReport},
    model::{
        AiRunArtifact, AiRunRecord, AiRunReplayReport, ApplyPatchReport, NodeDetail,
        PatchRunRecord, SnapshotRecord, SourceDetail, SourceImportPreview, SourceImportReport,
        SourceRecord, TreeNode,
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

#[derive(Debug, Serialize, Clone)]
struct NodeWorkspaceContext {
    node_detail: NodeDetail,
}

#[derive(Debug, Serialize, Clone)]
struct DraftReviewPayload {
    run: AiRunRecord,
    explanation: AiPatchExplanation,
    response_notes: Vec<String>,
    patch: PatchDocument,
    patch_preview: Vec<String>,
    report: ApplyPatchReport,
}

#[derive(Debug, Serialize, Clone)]
struct ApplyReviewedPatchOutput {
    report: ApplyPatchReport,
    overview: WorkspaceOverview,
    preferred_focus_node_id: Option<String>,
    focus_node_context: Option<NodeWorkspaceContext>,
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
    focus_node_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct PatchEditorPayload {
    patch_json: String,
    message: String,
    tone: String,
    reveal_advanced: bool,
}

#[derive(Debug, Serialize, Clone)]
struct LanguagePayload {
    preference: String,
}

#[derive(Debug, Serialize, Clone)]
struct DesktopAiStatus {
    command: String,
    command_source: String,
    provider: Option<String>,
    runner: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    has_auth: Option<bool>,
    has_process_env_conflict: Option<bool>,
    has_shell_env_conflict: Option<bool>,
    uses_provider_defaults: bool,
    status_error: Option<String>,
}

#[derive(Debug)]
struct ProviderDoctorSummary {
    model: Option<String>,
    reasoning_effort: Option<String>,
    has_auth: bool,
    has_process_env_conflict: bool,
    has_shell_env_conflict: bool,
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

fn node_workspace_context(workspace: &Workspace, node_id: &str) -> Result<NodeWorkspaceContext> {
    Ok(NodeWorkspaceContext {
        node_detail: normalize_node_detail(workspace.node_detail(node_id)?),
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
    focus_node_id: Option<String>,
) {
    set_current_workspace(app, state, overview.root_dir.clone());
    let _ = app.emit(
        EVENT_WORKSPACE_LOADED,
        WorkspaceLoadedPayload {
            overview,
            message: message.into(),
            tone: "success".to_string(),
            focus_node_id,
        },
    );
}

fn emit_patch_editor<R: Runtime>(
    app: &AppHandle<R>,
    patch: &PatchDocument,
    message: impl Into<String>,
    reveal_advanced: bool,
) {
    let patch_json = serde_json::to_string_pretty(patch).unwrap_or_else(|_| "{}".to_string());
    let _ = app.emit(
        EVENT_PATCH_EDITOR,
        PatchEditorPayload {
            patch_json,
            message: message.into(),
            tone: "success".to_string(),
            reveal_advanced,
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

fn normalize_ai_run_record(mut record: AiRunRecord) -> AiRunRecord {
    record.request_path = display_path_text(&record.request_path);
    record.response_path = display_path_text(&record.response_path);
    record
}

fn normalize_ai_run_records(records: Vec<AiRunRecord>) -> Vec<AiRunRecord> {
    records.into_iter().map(normalize_ai_run_record).collect()
}

fn normalize_ai_run_show_output(mut output: AiRunShowOutput) -> AiRunShowOutput {
    output.record = normalize_ai_run_record(output.record);
    output.metadata_path = output.metadata_path.map(|path| display_path_text(&path));
    output
}

fn normalize_ai_run_compare_output(mut output: AiRunCompareOutput) -> AiRunCompareOutput {
    output.left = normalize_ai_run_show_output(output.left);
    output.right = normalize_ai_run_show_output(output.right);
    output
}

fn normalize_ai_run_replay_report(mut replay: AiRunReplayReport) -> AiRunReplayReport {
    replay.source_run = normalize_ai_run_record(replay.source_run);
    replay
}

fn normalize_node_workspace_context(mut context: NodeWorkspaceContext) -> NodeWorkspaceContext {
    context.node_detail = normalize_node_detail(context.node_detail);
    context
}

fn normalize_external_runner_report(mut report: ExternalRunnerReport) -> ExternalRunnerReport {
    report.request_path = display_path_text(&report.request_path);
    report.response_path = display_path_text(&report.response_path);
    report.metadata_path = display_path_text(&report.metadata_path);
    report.metadata.request_path = display_path_text(&report.metadata.request_path);
    report.metadata.response_path = display_path_text(&report.metadata.response_path);
    report
}

fn ai_run_record_from_runner_report(report: &ExternalRunnerReport) -> AiRunRecord {
    AiRunRecord {
        id: report.metadata.run_id.clone(),
        capability: report.metadata.capability.clone(),
        explore_by: report.metadata.explore_by.clone(),
        node_id: report.metadata.node_id.clone(),
        command: report.metadata.command.clone(),
        dry_run: report.metadata.dry_run,
        status: report.metadata.status.clone(),
        started_at: report.metadata.started_at,
        finished_at: report.metadata.finished_at,
        request_path: report.metadata.request_path.clone(),
        response_path: report.metadata.response_path.clone(),
        exit_code: report.metadata.exit_code,
        provider: report.metadata.provider.clone(),
        model: report.metadata.model.clone(),
        provider_run_id: report.metadata.provider_run_id.clone(),
        retry_count: report.metadata.retry_count,
        last_error_category: report.metadata.last_error_category.clone(),
        last_error_message: report.metadata.last_error_message.clone(),
        last_status_code: report.metadata.last_status_code,
        patch_run_id: report.metadata.patch_run_id.clone(),
        patch_summary: report.metadata.patch_summary.clone(),
    }
}

fn draft_review_payload_from_report(report: ExternalRunnerReport) -> DraftReviewPayload {
    let run = normalize_ai_run_record(ai_run_record_from_runner_report(&report));
    DraftReviewPayload {
        run,
        explanation: report.explanation,
        response_notes: report.notes,
        patch_preview: report.patch.preview_lines(),
        patch: report.patch,
        report: report.report,
    }
}

fn preferred_focus_node_id_after_apply(
    report: &ApplyPatchReport,
    fallback_focus_node_id: Option<&str>,
) -> Option<String> {
    report
        .created_nodes
        .first()
        .map(|node| node.id.clone())
        .or_else(|| fallback_focus_node_id.map(ToOwned::to_owned))
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

fn cite_source_chunk_patch(node_id: String, chunk_id: String) -> PatchDocument {
    PatchDocument {
        version: 1,
        summary: Some(format!("Cite chunk {chunk_id} for node {node_id}")),
        ops: vec![PatchOp::CiteSourceChunk {
            node_id,
            chunk_id,
            citation_kind: None,
            rationale: None,
        }],
    }
}

fn uncite_source_chunk_patch(node_id: String, chunk_id: String) -> PatchDocument {
    PatchDocument {
        version: 1,
        summary: Some(format!("Remove cited chunk {chunk_id} from node {node_id}")),
        ops: vec![PatchOp::UnciteSourceChunk { node_id, chunk_id }],
    }
}

#[command]
fn draft_ai_expand_patch(
    start_path: String,
    node_id: String,
) -> Result<ExternalRunnerReport, String> {
    draft_ai_patch(start_path, node_id, "expand", None)
}

#[command]
fn draft_ai_explore_patch(
    start_path: String,
    node_id: String,
    by: String,
) -> Result<ExternalRunnerReport, String> {
    draft_ai_patch(start_path, node_id, "explore", Some(by))
}

fn draft_ai_patch(
    start_path: String,
    node_id: String,
    capability: &str,
    by: Option<String>,
) -> Result<ExternalRunnerReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let command = desktop_ai_runner_command().map_err(|err| err.to_string())?;
    let report = match capability {
        "expand" => workspace.run_external_ai_expand(&node_id, &command, true),
        "explore" => workspace.run_external_ai_explore(
            &node_id,
            by.as_deref()
                .ok_or_else(|| "desktop explore drafts require a `by` angle".to_string())?,
            &command,
            true,
        ),
        _ => Err(anyhow::anyhow!(
            "unsupported desktop AI capability `{capability}`"
        )),
    }
    .map(normalize_external_runner_report)
    .map_err(|err| err.to_string())?;
    Ok(report)
}

fn desktop_ai_runner_override_command() -> Option<String> {
    std::env::var("NODEX_DESKTOP_AI_COMMAND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn desktop_ai_runner_command_source() -> &'static str {
    if desktop_ai_runner_override_command().is_some() {
        "override"
    } else {
        "default"
    }
}

fn desktop_ai_runner_command() -> Result<String> {
    if let Some(command) = desktop_ai_runner_override_command() {
        return Ok(command);
    }

    let runner_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../scripts/provider_runner.py")
        .canonicalize()
        .context("failed to resolve scripts/provider_runner.py for desktop AI expand")?;
    Ok(desktop_default_ai_runner_command(runner_path.as_path()))
}

fn desktop_default_ai_runner_command(script_path: &Path) -> String {
    format!(
        "python3 {} --provider anthropic --use-default-args",
        shell_quote(&display_path(script_path))
    )
}

fn provider_script_path(script_name: &str) -> Result<PathBuf> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../scripts")
        .join(script_name);
    if !path.exists() {
        anyhow::bail!("provider script {} was not found", path.display());
    }
    Ok(path)
}

fn run_provider_doctor(provider: &str) -> Result<ProviderDoctorSummary> {
    let output = ProcessCommand::new("python3")
        .arg(provider_script_path("provider_doctor.py")?)
        .args(["--provider", provider, "--json"])
        .stdin(Stdio::null())
        .output()
        .context("failed to run provider doctor")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!(
                "provider doctor exited with status {}",
                output.status.code().unwrap_or(-1)
            )
        };
        anyhow::bail!("{detail}");
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_provider_doctor_summary(provider, &stdout)
}

fn parse_provider_doctor_summary(provider: &str, json_text: &str) -> Result<ProviderDoctorSummary> {
    let root: serde_json::Value =
        serde_json::from_str(json_text).context("provider doctor did not return valid JSON")?;
    let provider_payload = root
        .get(provider)
        .and_then(|value| value.as_object())
        .with_context(|| format!("provider doctor JSON did not include `{provider}` payload"))?;
    let summary = provider_payload
        .get("summary")
        .and_then(|value| value.as_object())
        .context("provider doctor JSON did not include a summary object")?;

    Ok(ProviderDoctorSummary {
        model: provider_payload
            .get("model")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        reasoning_effort: provider_payload
            .get("reasoning_effort")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        has_auth: summary
            .get("has_auth")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        has_process_env_conflict: summary
            .get("has_process_env_conflict")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        has_shell_env_conflict: summary
            .get("has_shell_env_conflict")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    })
}

fn extract_command_flag_value(command: &str, flag: &str) -> Option<String> {
    let spaced_flag = format!("{flag} ");
    let equals_flag = format!("{flag}=");

    if let Some(value) = command.split_once(&equals_flag).map(|(_, value)| value) {
        return extract_flag_token(value);
    }

    if let Some(value) = command.split_once(&spaced_flag).map(|(_, value)| value) {
        return extract_flag_token(value);
    }

    None
}

fn extract_flag_token(value: &str) -> Option<String> {
    let trimmed = value.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let end = trimmed
        .char_indices()
        .find_map(|(index, ch)| ch.is_whitespace().then_some(index))
        .unwrap_or(trimmed.len());
    let token = trimmed[..end].trim_matches(|ch| ch == '\'' || ch == '"');
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn provider_default_reasoning_effort(provider: Option<&str>) -> Option<&'static str> {
    match provider {
        Some("codex") => Some("low"),
        _ => None,
    }
}

fn effective_model_for_command(command: &str, doctor_model: Option<String>) -> Option<String> {
    extract_command_flag_value(command, "--model").or(doctor_model)
}

fn effective_reasoning_for_command(
    command: &str,
    provider: Option<&str>,
    uses_provider_defaults: bool,
    doctor_reasoning_effort: Option<String>,
) -> Option<String> {
    extract_command_flag_value(command, "--reasoning-effort")
        .or_else(|| {
            if uses_provider_defaults {
                provider_default_reasoning_effort(provider).map(|value| value.to_string())
            } else {
                None
            }
        })
        .or(doctor_reasoning_effort)
}

fn detected_provider_from_command(command: &str) -> Option<&'static str> {
    if command.contains("--provider codex")
        || command.contains("--provider=codex")
        || command.contains("codex_runner.py")
    {
        Some("codex")
    } else if command.contains("--provider anthropic")
        || command.contains("--provider=anthropic")
        || command.contains("langchain_anthropic_runner.py")
    {
        Some("anthropic")
    } else if command.contains("--provider openai")
        || command.contains("--provider=openai")
        || command.contains("openai_runner.py")
    {
        Some("openai")
    } else if command.contains("--provider gemini")
        || command.contains("--provider=gemini")
        || command.contains("gemini_runner.py")
    {
        Some("gemini")
    } else {
        None
    }
}

fn detected_runner_from_command(command: &str) -> &'static str {
    if command.contains("provider_runner.py") {
        "provider_runner.py"
    } else if command.contains("langchain_anthropic_runner.py") {
        "langchain_anthropic_runner.py"
    } else if command.contains("langchain_openai_runner.py") {
        "langchain_openai_runner.py"
    } else if command.contains("codex_runner.py") {
        "codex_runner.py"
    } else if command.contains("openai_runner.py") {
        "openai_runner.py"
    } else if command.contains("gemini_runner.py") {
        "gemini_runner.py"
    } else {
        "custom"
    }
}

fn desktop_ai_status() -> DesktopAiStatus {
    let command_source = desktop_ai_runner_command_source().to_string();
    let command = match desktop_ai_runner_command() {
        Ok(command) => command,
        Err(err) => {
            return DesktopAiStatus {
                command: String::new(),
                command_source,
                provider: None,
                runner: "unavailable".to_string(),
                model: None,
                reasoning_effort: None,
                has_auth: None,
                has_process_env_conflict: None,
                has_shell_env_conflict: None,
                uses_provider_defaults: false,
                status_error: Some(err.to_string()),
            };
        }
    };

    let provider = detected_provider_from_command(&command).map(ToOwned::to_owned);
    let mut status = DesktopAiStatus {
        command: command.clone(),
        command_source: command_source.clone(),
        provider: provider.clone(),
        runner: detected_runner_from_command(&command).to_string(),
        model: None,
        reasoning_effort: None,
        has_auth: None,
        has_process_env_conflict: None,
        has_shell_env_conflict: None,
        uses_provider_defaults: command.contains("--use-default-args"),
        status_error: None,
    };

    let mut doctor_model = None;
    let mut doctor_reasoning_effort = None;

    match provider.as_deref() {
        Some(provider_name) => match run_provider_doctor(provider_name) {
            Ok(summary) => {
                doctor_model = summary.model;
                doctor_reasoning_effort = summary.reasoning_effort;
                status.has_auth = Some(summary.has_auth);
                status.has_process_env_conflict = Some(summary.has_process_env_conflict);
                status.has_shell_env_conflict = Some(summary.has_shell_env_conflict);
            }
            Err(err) => {
                status.status_error = Some(err.to_string());
            }
        },
        None if command_source == "override" => {
            status.status_error = Some(
                "NODEX_DESKTOP_AI_COMMAND does not map to a known provider runner.".to_string(),
            );
        }
        None => {}
    }

    status.model = effective_model_for_command(&command, doctor_model);
    status.reasoning_effort = effective_reasoning_for_command(
        &command,
        provider.as_deref(),
        status.uses_provider_defaults,
        doctor_reasoning_effort,
    );

    status
}

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
                .text(
                    MENU_WORKSPACE_SAVE_SNAPSHOT,
                    menu_label(&locale, "save_snapshot"),
                )
                .separator()
                .item(&restore_snapshot_menu)
                .build()?,
        )
        .item(
            &SubmenuBuilder::new(app, menu_label(&locale, "source"))
                .text(
                    MENU_SOURCE_PREVIEW_IMPORT,
                    menu_label(&locale, "preview_import"),
                )
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

fn refresh_native_menu<R: Runtime>(app: &AppHandle<R>, state: &DesktopState) -> tauri::Result<()> {
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
                emit_workspace_loaded(&app_handle, state.inner(), overview, message, None);
            }
            Err(err) => emit_console(&app_handle, err.to_string(), "error"),
        }
    });
}

fn handle_source_import_menu<R: Runtime>(app: &AppHandle<R>, state: &DesktopState, preview: bool) {
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
                            format!(
                                "Previewed import for {}",
                                preview_result.report.original_name
                            ),
                            false,
                        );
                    }
                    Err(err) => emit_console(&app_handle, err.to_string(), "error"),
                }
            } else {
                match open_workspace_from(&workspace_path)
                    .and_then(|mut workspace| {
                        let report = workspace.import_source(&file_path)?;
                        let overview = workspace_overview(&workspace)?;
                        Ok((overview, report))
                    }) {
                    Ok((overview, report)) => {
                        let state = app_handle.state::<DesktopState>();
                        emit_workspace_loaded(
                            &app_handle,
                            state.inner(),
                            overview,
                            format!("Imported {}", report.original_name),
                            Some(report.root_node_id),
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
        MENU_WORKSPACE_REFRESH => {
            match with_current_workspace(state, |workspace| workspace_overview(workspace)) {
                Ok(overview) => {
                    emit_workspace_loaded(app, state, overview, "Workspace refreshed.", None)
                }
                Err(err) => emit_console(app, err.to_string(), "error"),
            }
        }
        MENU_WORKSPACE_SAVE_SNAPSHOT => {
            match with_current_workspace(state, |workspace| workspace.save_snapshot(None)) {
                Ok(snapshot) => {
                    let _ = refresh_native_menu(app, state);
                    emit_console(app, format!("Saved snapshot {}", snapshot.id), "success");
                }
                Err(err) => emit_console(app, err.to_string(), "error"),
            }
        }
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
                Ok(overview) => emit_workspace_loaded(
                    app,
                    state,
                    overview,
                    format!("Restored snapshot {snapshot_id}"),
                    None,
                ),
                Err(err) => emit_console(app, err.to_string(), "error"),
            }
        }
        _ if event_id.starts_with(MENU_HISTORY_PREFIX) => {
            let run_id = event_id.trim_start_matches(MENU_HISTORY_PREFIX);
            match with_current_workspace(state, |workspace| {
                workspace.patch_document_by_run_id(run_id)
            }) {
                Ok(patch) => emit_patch_editor(app, &patch, format!("Loaded patch {run_id}"), true),
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
fn get_node_workspace_context(
    start_path: String,
    node_id: String,
) -> Result<NodeWorkspaceContext, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    node_workspace_context(&workspace, &node_id)
        .map(normalize_node_workspace_context)
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
fn draft_node_expand(start_path: String, node_id: String) -> Result<DraftReviewPayload, String> {
    let report = draft_ai_patch(start_path, node_id, "expand", None)?;
    Ok(draft_review_payload_from_report(report))
}

#[command]
fn draft_node_explore(
    start_path: String,
    node_id: String,
    by: String,
) -> Result<DraftReviewPayload, String> {
    let report = draft_ai_patch(start_path, node_id, "explore", Some(by))?;
    Ok(draft_review_payload_from_report(report))
}

#[command]
fn get_ai_run_history(
    start_path: String,
    node_id: Option<String>,
) -> Result<Vec<AiRunRecord>, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .ai_run_history(node_id.as_deref())
        .map(normalize_ai_run_records)
        .map_err(|err| err.to_string())
}

#[command]
fn get_ai_run_record(start_path: String, run_id: String) -> Result<AiRunRecord, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let record = workspace
        .ai_run_record_by_id(&run_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("AI run {run_id} was not found"))?;
    let mut normalized = normalize_ai_run_records(vec![record]);
    Ok(normalized.remove(0))
}

#[command]
fn get_ai_run_show(start_path: String, run_id: String) -> Result<AiRunShowOutput, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .ai_run_show_output(&run_id)
        .map(normalize_ai_run_show_output)
        .map_err(|err| err.to_string())
}

#[command]
fn get_ai_run_patch(start_path: String, run_id: String) -> Result<PatchDocument, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .ai_run_patch_document(&run_id)
        .map_err(|err| err.to_string())
}

#[command]
fn compare_ai_runs(
    start_path: String,
    left_run_id: String,
    right_run_id: String,
) -> Result<AiRunCompareOutput, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .ai_run_compare_output(&left_run_id, &right_run_id)
        .map(normalize_ai_run_compare_output)
        .map_err(|err| err.to_string())
}

#[command]
fn get_ai_run_artifact(
    start_path: String,
    run_id: String,
    kind: String,
) -> Result<AiRunArtifact, String> {
    let workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let mut artifact = workspace
        .ai_run_artifact(&run_id, &kind)
        .map_err(|err| err.to_string())?;
    artifact.path = display_path_text(&artifact.path);
    Ok(artifact)
}

#[command]
fn preview_ai_run_replay(start_path: String, run_id: String) -> Result<AiRunReplayReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    workspace
        .replay_ai_run_patch(&run_id, true)
        .map(normalize_ai_run_replay_report)
        .map_err(|err| err.to_string())
}

#[command]
fn get_desktop_ai_status() -> DesktopAiStatus {
    desktop_ai_status()
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
    set_current_workspace(
        &app,
        state.inner(),
        display_path(workspace.paths.root_dir.as_path()),
    );
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
    ai_run_id: Option<String>,
) -> Result<ApplyPatchReport, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let patch = parse_patch_document(&patch_json).map_err(|err| err.to_string())?;
    let report = workspace
        .apply_patch_document_with_ai_run(patch, "desktop", false, ai_run_id.as_deref())
        .map_err(|err| err.to_string())?;
    set_current_workspace(
        &app,
        state.inner(),
        display_path(workspace.paths.root_dir.as_path()),
    );
    Ok(report)
}

#[command]
fn apply_reviewed_patch(
    app: AppHandle,
    state: State<DesktopState>,
    start_path: String,
    patch_json: String,
    ai_run_id: Option<String>,
    focus_node_id: Option<String>,
) -> Result<ApplyReviewedPatchOutput, String> {
    let mut workspace = open_workspace_from(&start_path).map_err(|err| err.to_string())?;
    let patch = parse_patch_document(&patch_json).map_err(|err| err.to_string())?;
    let report = workspace
        .apply_patch_document_with_ai_run(patch, "desktop", false, ai_run_id.as_deref())
        .map_err(|err| err.to_string())?;
    let overview = workspace_overview(&workspace).map_err(|err| err.to_string())?;
    let preferred_focus_node_id =
        preferred_focus_node_id_after_apply(&report, focus_node_id.as_deref());
    let focus_node_context = preferred_focus_node_id
        .as_deref()
        .and_then(|node_id| node_workspace_context(&workspace, node_id).ok())
        .map(normalize_node_workspace_context);
    set_current_workspace(&app, state.inner(), overview.root_dir.clone());
    Ok(ApplyReviewedPatchOutput {
        report,
        overview,
        preferred_focus_node_id,
        focus_node_context,
    })
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
fn draft_cite_source_chunk_patch(node_id: String, chunk_id: String) -> PatchDocument {
    cite_source_chunk_patch(node_id, chunk_id)
}

#[command]
fn draft_uncite_source_chunk_patch(node_id: String, chunk_id: String) -> PatchDocument {
    uncite_source_chunk_patch(node_id, chunk_id)
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
    set_current_workspace(
        &app,
        state.inner(),
        display_path(workspace.paths.root_dir.as_path()),
    );
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
            apply_reviewed_patch,
            draft_add_node_patch,
            draft_ai_expand_patch,
            draft_ai_explore_patch,
            draft_node_expand,
            draft_node_explore,
            draft_cite_source_chunk_patch,
            draft_delete_node_patch,
            draft_move_node_patch,
            draft_uncite_source_chunk_patch,
            draft_update_node_patch,
            get_node_detail,
            get_node_workspace_context,
            get_ai_run_history,
            get_ai_run_record,
            get_ai_run_show,
            compare_ai_runs,
            get_ai_run_artifact,
            get_ai_run_patch,
            preview_ai_run_replay,
            get_desktop_ai_status,
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
    use std::{
        path::Path,
        sync::{Mutex, OnceLock},
    };

    use super::{
        desktop_ai_status, desktop_default_ai_runner_command, detected_provider_from_command,
        effective_model_for_command, effective_reasoning_for_command,
        parse_provider_doctor_summary, preferred_focus_node_id_after_apply,
    };
    use nodex::model::{ApplyPatchReport, NodeSummary};

    #[cfg(windows)]
    use super::display_path_text;

    fn desktop_ai_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn desktop_default_ai_runner_uses_provider_entry_defaults() {
        let command = desktop_default_ai_runner_command(Path::new("/tmp/provider_runner.py"));
        assert_eq!(
            command,
            "python3 '/tmp/provider_runner.py' --provider anthropic --use-default-args"
        );
    }

    #[test]
    fn detects_provider_from_supported_runner_commands() {
        assert_eq!(
            detected_provider_from_command(
                "python3 '/tmp/provider_runner.py' --provider anthropic --use-default-args"
            ),
            Some("anthropic")
        );
        assert_eq!(
            detected_provider_from_command("python3 scripts/openai_runner.py"),
            Some("openai")
        );
        assert_eq!(
            detected_provider_from_command("python3 scripts/langchain_anthropic_runner.py"),
            Some("anthropic")
        );
        assert_eq!(detected_provider_from_command("bash ./custom.sh"), None);
    }

    #[test]
    fn parses_provider_doctor_summary_from_json_payload() {
        let summary = parse_provider_doctor_summary(
            "anthropic",
            r#"{
              "anthropic": {
                "summary": {
                  "provider": "anthropic",
                  "runnable": true,
                  "has_auth": true,
                  "has_process_env_conflict": false,
                  "has_shell_env_conflict": true
                },
                "model": "glm-5.1",
                "reasoning_effort": null
              }
            }"#,
        )
        .expect("summary should parse");

        assert_eq!(summary.model.as_deref(), Some("glm-5.1"));
        assert_eq!(summary.reasoning_effort, None);
        assert!(summary.has_auth);
        assert!(!summary.has_process_env_conflict);
        assert!(summary.has_shell_env_conflict);
    }

    #[test]
    fn effective_model_prefers_command_override_over_doctor_summary() {
        assert_eq!(
            effective_model_for_command(
                "python3 scripts/codex_runner.py --model gpt-5.4-mini",
                Some("gpt-5.4".to_string())
            )
            .as_deref(),
            Some("gpt-5.4-mini")
        );
    }

    #[test]
    fn effective_reasoning_ignores_provider_defaults_for_desktop_anthropic_route() {
        assert_eq!(
            effective_reasoning_for_command(
                "python3 '/tmp/provider_runner.py' --provider anthropic --use-default-args",
                Some("anthropic"),
                true,
                Some("medium".to_string())
            )
            .as_deref(),
            Some("medium")
        );
    }

    #[test]
    fn effective_reasoning_prefers_explicit_command_override() {
        assert_eq!(
            effective_reasoning_for_command(
                "python3 scripts/codex_runner.py --reasoning-effort medium",
                Some("codex"),
                true,
                Some("xhigh".to_string())
            )
            .as_deref(),
            Some("medium")
        );
    }

    #[test]
    fn desktop_ai_status_marks_unknown_override_command_as_needing_attention() {
        let _guard = desktop_ai_env_lock()
            .lock()
            .expect("desktop ai env lock should not be poisoned");
        let previous = std::env::var_os("NODEX_DESKTOP_AI_COMMAND");
        unsafe {
            std::env::set_var("NODEX_DESKTOP_AI_COMMAND", "bash ./custom-runner.sh");
        }

        let status = desktop_ai_status();

        if let Some(previous) = previous {
            unsafe {
                std::env::set_var("NODEX_DESKTOP_AI_COMMAND", previous);
            }
        } else {
            unsafe {
                std::env::remove_var("NODEX_DESKTOP_AI_COMMAND");
            }
        }

        assert_eq!(status.command_source, "override");
        assert_eq!(status.command, "bash ./custom-runner.sh");
        assert_eq!(status.provider, None);
        assert_eq!(status.runner, "custom");
        assert_eq!(status.has_auth, None);
        assert_eq!(status.has_process_env_conflict, None);
        assert_eq!(status.has_shell_env_conflict, None);
        assert_eq!(status.reasoning_effort, None);
        assert!(!status.uses_provider_defaults);
        assert!(
            status
                .status_error
                .as_deref()
                .is_some_and(|value| value.contains("does not map to a known provider runner"))
        );
    }

    #[test]
    fn preferred_focus_node_uses_first_created_node_when_available() {
        let report = ApplyPatchReport {
            run_id: Some("run-1".to_string()),
            summary: Some("Applied patch".to_string()),
            preview: vec!["add child".to_string()],
            created_nodes: vec![
                NodeSummary {
                    id: "node-created-1".to_string(),
                    title: "First".to_string(),
                },
                NodeSummary {
                    id: "node-created-2".to_string(),
                    title: "Second".to_string(),
                },
            ],
        };

        assert_eq!(
            preferred_focus_node_id_after_apply(&report, Some("fallback-node")).as_deref(),
            Some("node-created-1")
        );
    }

    #[test]
    fn preferred_focus_node_falls_back_to_current_selection_when_no_nodes_were_created() {
        let report = ApplyPatchReport {
            run_id: Some("run-2".to_string()),
            summary: Some("Updated node".to_string()),
            preview: vec!["update node".to_string()],
            created_nodes: vec![],
        };

        assert_eq!(
            preferred_focus_node_id_after_apply(&report, Some("current-node")).as_deref(),
            Some("current-node")
        );
        assert_eq!(preferred_focus_node_id_after_apply(&report, None), None);
    }

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
