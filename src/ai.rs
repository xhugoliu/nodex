use std::process::{Command, Output};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    model::{ApplyPatchReport, NodeDetail, SourceChunkRecord},
    patch::{PatchDocument, PatchOp},
    project::ProjectPaths,
    store::Workspace,
};

const AI_CONTRACT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiNodeContext {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub body: Option<String>,
    pub parent_title: Option<String>,
    pub child_titles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChunkContext {
    pub chunk_id: String,
    pub label: Option<String>,
    pub excerpt: String,
    pub start_line: i64,
    pub end_line: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSourceContext {
    pub source_id: String,
    pub original_name: String,
    pub relation: String,
    pub chunks: Vec<AiChunkContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiContract {
    pub version: u32,
    pub patch_version: u32,
    pub response_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiExpandRequest {
    pub version: u32,
    pub kind: String,
    pub capability: String,
    pub workspace_name: String,
    pub target_node: AiNodeContext,
    pub linked_sources: Vec<AiSourceContext>,
    pub cited_evidence: Vec<AiSourceContext>,
    pub system_prompt: String,
    pub user_prompt: String,
    pub output_instructions: String,
    pub contract: AiContract,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiGeneratorInfo {
    pub provider: String,
    pub model: Option<String>,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPatchResponse {
    pub version: u32,
    pub kind: String,
    pub capability: String,
    pub request_node_id: String,
    pub status: String,
    pub summary: Option<String>,
    pub generator: AiGeneratorInfo,
    pub patch: PatchDocument,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiExpandPreview {
    pub capability: String,
    pub mode: String,
    pub workspace_name: String,
    pub target_node: AiNodeContext,
    pub linked_sources: Vec<AiSourceContext>,
    pub cited_evidence: Vec<AiSourceContext>,
    pub system_prompt: String,
    pub user_prompt: String,
    pub request: AiExpandRequest,
    pub response_template: AiPatchResponse,
    pub draft_patch: PatchDocument,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalRunnerReport {
    pub request_path: String,
    pub response_path: String,
    pub metadata_path: String,
    pub command: String,
    pub exit_code: i32,
    pub metadata: AiRunMetadata,
    pub report: ApplyPatchReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRunMetadata {
    pub run_id: String,
    pub capability: String,
    pub node_id: String,
    pub command: String,
    pub dry_run: bool,
    pub status: String,
    pub started_at: i64,
    pub finished_at: i64,
    pub request_path: String,
    pub response_path: String,
    pub exit_code: Option<i32>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub provider_run_id: Option<String>,
    pub retry_count: u32,
    pub last_error_category: Option<String>,
    pub last_error_message: Option<String>,
    pub last_status_code: Option<i32>,
    pub patch_run_id: Option<String>,
    pub patch_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RunnerSidecarMetadata {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    provider_run_id: Option<String>,
    #[serde(default)]
    retry_count: u32,
    #[serde(default)]
    last_error_category: Option<String>,
    #[serde(default)]
    last_error_message: Option<String>,
    #[serde(default)]
    last_status_code: Option<i32>,
}

impl Workspace {
    pub fn preview_ai_expand(&self, node_id: &str) -> Result<AiExpandPreview> {
        let workspace_name = self.workspace_name()?;
        let detail = self.node_detail(node_id)?;
        let target_node = build_node_context(&detail);
        let linked_sources = detail
            .sources
            .iter()
            .map(|source_detail| AiSourceContext {
                source_id: source_detail.source.id.clone(),
                original_name: source_detail.source.original_name.clone(),
                relation: if source_detail.chunks.is_empty() {
                    "source_link".to_string()
                } else {
                    "source_chunks".to_string()
                },
                chunks: source_detail
                    .chunks
                    .iter()
                    .map(build_chunk_context)
                    .collect(),
            })
            .collect::<Vec<_>>();
        let cited_evidence = detail
            .evidence
            .iter()
            .map(|evidence_detail| AiSourceContext {
                source_id: evidence_detail.source.id.clone(),
                original_name: evidence_detail.source.original_name.clone(),
                relation: "evidence".to_string(),
                chunks: evidence_detail
                    .chunks
                    .iter()
                    .map(build_chunk_context)
                    .collect(),
            })
            .collect::<Vec<_>>();

        let system_prompt = build_system_prompt();
        let user_prompt = build_user_prompt(
            &workspace_name,
            &target_node,
            &linked_sources,
            &cited_evidence,
        );
        let output_instructions = build_output_instructions();
        let draft_patch = build_expand_patch_scaffold(&target_node);
        let request = AiExpandRequest {
            version: AI_CONTRACT_VERSION,
            kind: "nodex_ai_expand_request".to_string(),
            capability: "expand".to_string(),
            workspace_name: workspace_name.clone(),
            target_node: target_node.clone(),
            linked_sources: linked_sources.clone(),
            cited_evidence: cited_evidence.clone(),
            system_prompt: system_prompt.clone(),
            user_prompt: user_prompt.clone(),
            output_instructions: output_instructions.clone(),
            contract: AiContract {
                version: AI_CONTRACT_VERSION,
                patch_version: 1,
                response_kind: "nodex_ai_patch_response".to_string(),
            },
        };
        let response_template = AiPatchResponse {
            version: AI_CONTRACT_VERSION,
            kind: "nodex_ai_patch_response".to_string(),
            capability: "expand".to_string(),
            request_node_id: target_node.id.clone(),
            status: "ok".to_string(),
            summary: draft_patch.summary.clone(),
            generator: AiGeneratorInfo {
                provider: "external_runtime".to_string(),
                model: None,
                run_id: None,
            },
            patch: draft_patch.clone(),
            notes: vec![
                "Replace the scaffold patch with model output before applying.".to_string(),
            ],
        };
        let notes = vec![
            "No API key is required for this preview.".to_string(),
            "No model call was performed; this command only prepares local AI context.".to_string(),
            "The draft patch is a deterministic scaffold meant for review, editing, or future model replacement.".to_string(),
            "Use --emit-request to export a stable request bundle for an external runtime."
                .to_string(),
        ];

        Ok(AiExpandPreview {
            capability: "expand".to_string(),
            mode: "dry_run".to_string(),
            workspace_name,
            target_node,
            linked_sources,
            cited_evidence,
            system_prompt,
            user_prompt,
            request,
            response_template,
            draft_patch,
            notes,
        })
    }

    pub fn apply_ai_patch_response(
        &mut self,
        response: AiPatchResponse,
        dry_run: bool,
    ) -> Result<ApplyPatchReport> {
        validate_response_contract(&response)?;
        self.apply_patch_document(response.patch, "ai_response", dry_run)
    }

    pub fn run_external_ai_expand(
        &mut self,
        node_id: &str,
        command: &str,
        dry_run: bool,
    ) -> Result<ExternalRunnerReport> {
        let preview = self.preview_ai_expand(node_id)?;
        let run_id = Uuid::new_v4().to_string();
        let started_at = timestamp_now();
        let request_path = self.paths.ai_dir.join(format!("{run_id}.request.json"));
        let response_path = self.paths.ai_dir.join(format!("{run_id}.response.json"));
        let metadata_path = self.paths.ai_dir.join(format!("{run_id}.meta.json"));
        write_ai_json_document(&request_path, &preview.request)?;

        let output = run_external_command(
            &self.paths,
            command,
            &request_path,
            &response_path,
            &metadata_path,
            node_id,
        )?;
        let mut sidecar_metadata = load_runner_sidecar_metadata(&metadata_path)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "external runner exited without output".to_string()
            };
            let (inferred_category, inferred_message) = parse_error_prefix(&detail);
            if sidecar_metadata.last_error_category.is_none() {
                sidecar_metadata.last_error_category = inferred_category;
            }
            if sidecar_metadata.last_error_message.is_none() {
                sidecar_metadata.last_error_message = Some(inferred_message);
            }
            let metadata = build_run_metadata(
                &run_id,
                "expand",
                node_id,
                command,
                dry_run,
                "failed",
                started_at,
                timestamp_now(),
                &request_path,
                &response_path,
                output.status.code(),
                &sidecar_metadata,
                None,
            );
            write_ai_json_document(&metadata_path, &metadata)?;
            bail!(
                "external AI runner failed with exit code {}: {}",
                output.status.code().unwrap_or(-1),
                detail
            );
        }

        let response_json = std::fs::read_to_string(&response_path)
            .with_context(|| format!("failed to read {}", response_path.display()))?;
        let response = parse_ai_patch_response(&response_json)
            .with_context(|| format!("failed to parse {}", response_path.display()))?;
        let report = self.apply_ai_patch_response(response.clone(), dry_run)?;
        sidecar_metadata.provider = Some(response.generator.provider.clone());
        sidecar_metadata.model = response.generator.model.clone();
        sidecar_metadata.provider_run_id = response.generator.run_id.clone();
        let metadata = build_run_metadata(
            &run_id,
            "expand",
            node_id,
            command,
            dry_run,
            if dry_run {
                "dry_run_succeeded"
            } else {
                "applied"
            },
            started_at,
            timestamp_now(),
            &request_path,
            &response_path,
            output.status.code(),
            &sidecar_metadata,
            Some(&report),
        );
        write_ai_json_document(&metadata_path, &metadata)?;

        Ok(ExternalRunnerReport {
            request_path: request_path.display().to_string(),
            response_path: response_path.display().to_string(),
            metadata_path: metadata_path.display().to_string(),
            command: command.to_string(),
            exit_code: output.status.code().unwrap_or_default(),
            metadata,
            report,
        })
    }
}

fn build_node_context(detail: &NodeDetail) -> AiNodeContext {
    AiNodeContext {
        id: detail.node.id.clone(),
        title: detail.node.title.clone(),
        kind: detail.node.kind.clone(),
        body: detail.node.body.clone(),
        parent_title: detail.parent.as_ref().map(|node| node.title.clone()),
        child_titles: detail
            .children
            .iter()
            .map(|child| child.title.clone())
            .collect(),
    }
}

fn build_chunk_context(chunk: &SourceChunkRecord) -> AiChunkContext {
    AiChunkContext {
        chunk_id: chunk.id.clone(),
        label: chunk.label.clone(),
        excerpt: excerpt_text(&chunk.text, 240),
        start_line: chunk.start_line,
        end_line: chunk.end_line,
    }
}

fn build_system_prompt() -> String {
    [
        "You are Nodex AI.",
        "Return only a valid Nodex patch document in JSON.",
        "The patch must preserve the existing tree and prefer local, incremental edits.",
        "For expand requests, prefer add_node operations under the target node.",
        "Do not rewrite unrelated branches or replace the whole workspace state.",
        "If you cite evidence, keep source links intact and use the existing patch semantics.",
    ]
    .join("\n")
}

fn build_output_instructions() -> String {
    [
        "Return one JSON document that matches the nodex_ai_patch_response schema.",
        "Set kind=nodex_ai_patch_response and version=1.",
        "Put the proposed Nodex patch in the patch field.",
        "Keep patch.version=1 and only use supported Nodex patch ops.",
        "Do not wrap the response in markdown fences.",
    ]
    .join("\n")
}

fn build_user_prompt(
    workspace_name: &str,
    target_node: &AiNodeContext,
    linked_sources: &[AiSourceContext],
    cited_evidence: &[AiSourceContext],
) -> String {
    let mut sections = vec![
        format!("Workspace: {workspace_name}"),
        format!("Target node id: {}", target_node.id),
        format!("Target node title: {}", target_node.title),
        format!("Target node kind: {}", target_node.kind),
        format!(
            "Parent: {}",
            target_node.parent_title.as_deref().unwrap_or("(none)")
        ),
        format!(
            "Existing children: {}",
            if target_node.child_titles.is_empty() {
                "(none)".to_string()
            } else {
                target_node.child_titles.join(", ")
            }
        ),
        format!("Body: {}", target_node.body.as_deref().unwrap_or("(none)")),
    ];

    if linked_sources.is_empty() {
        sections.push("Linked sources: (none)".to_string());
    } else {
        sections.push(format_source_section("Linked sources", linked_sources));
    }

    if cited_evidence.is_empty() {
        sections.push("Cited evidence: (none)".to_string());
    } else {
        sections.push(format_source_section("Cited evidence", cited_evidence));
    }

    sections.push(
        "Task: expand the target node into 3 to 5 useful child nodes that improve structure without rewriting unrelated parts."
            .to_string(),
    );
    sections.push(
        "Return a version 1 patch document with a concise summary and ordered ops.".to_string(),
    );

    sections.join("\n\n")
}

fn format_source_section(title: &str, sources: &[AiSourceContext]) -> String {
    let mut lines = vec![format!("{title}:")];
    for source in sources {
        lines.push(format!(
            "- {} [{}] relation={}",
            source.original_name, source.source_id, source.relation
        ));
        if source.chunks.is_empty() {
            lines.push("  - chunks: (none)".to_string());
        } else {
            for chunk in &source.chunks {
                let label = chunk.label.as_deref().unwrap_or("(no label)");
                lines.push(format!(
                    "  - chunk {} [{}-{}] {}",
                    chunk.chunk_id, chunk.start_line, chunk.end_line, label
                ));
                lines.push(format!("    {}", chunk.excerpt));
            }
        }
    }
    lines.join("\n")
}

fn build_expand_patch_scaffold(target_node: &AiNodeContext) -> PatchDocument {
    let suggestions = suggested_branch_titles(&target_node.kind);
    let existing_titles = target_node
        .child_titles
        .iter()
        .map(|title| title.to_ascii_lowercase())
        .collect::<Vec<_>>();

    let ops = suggestions
        .into_iter()
        .enumerate()
        .map(|(index, title)| {
            let mut candidate = title.to_string();
            let mut suffix = 2;
            while existing_titles
                .iter()
                .any(|existing| existing == &candidate.to_ascii_lowercase())
            {
                candidate = format!("{title} {suffix}");
                suffix += 1;
            }

            PatchOp::AddNode {
                id: None,
                parent_id: target_node.id.clone(),
                title: candidate,
                kind: Some("topic".to_string()),
                body: Some(format!(
                    "Local dry-run scaffold branch {} for expanding \"{}\".",
                    index + 1,
                    target_node.title
                )),
                position: None,
            }
        })
        .collect();

    PatchDocument {
        version: 1,
        summary: Some(format!(
            "AI dry-run scaffold for expanding node {}",
            target_node.id
        )),
        ops,
    }
}

fn suggested_branch_titles(kind: &str) -> Vec<&'static str> {
    match kind {
        "question" => vec!["Background", "Possible Answers", "Next Questions"],
        "action" => vec!["Subtasks", "Dependencies", "Risks"],
        "evidence" => vec!["Claim", "Support", "Gaps"],
        "source" => vec!["Overview", "Key Sections", "Open Threads"],
        _ => vec!["Background", "Key Points", "Next Steps"],
    }
}

pub fn parse_ai_patch_response(response_json: &str) -> Result<AiPatchResponse> {
    let response: AiPatchResponse =
        serde_json::from_str(response_json).context("failed to parse AI response JSON")?;
    validate_response_contract(&response)?;
    Ok(response)
}

pub fn write_ai_json_document<T: Serialize>(path: &std::path::Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent().filter(|path| !path.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(value)?;
    std::fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn run_external_command(
    paths: &ProjectPaths,
    command: &str,
    request_path: &std::path::Path,
    response_path: &std::path::Path,
    metadata_path: &std::path::Path,
    node_id: &str,
) -> Result<Output> {
    Command::new("zsh")
        .arg("-lc")
        .arg(command)
        .env("NODEX_AI_REQUEST", request_path)
        .env("NODEX_AI_RESPONSE", response_path)
        .env("NODEX_AI_META", metadata_path)
        .env("NODEX_AI_WORKSPACE", &paths.root_dir)
        .env("NODEX_AI_NODE_ID", node_id)
        .output()
        .with_context(|| format!("failed to run external AI command `{command}`"))
}

fn load_runner_sidecar_metadata(path: &std::path::Path) -> Result<RunnerSidecarMetadata> {
    if !path.exists() {
        return Ok(RunnerSidecarMetadata::default());
    }
    let json = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let metadata: RunnerSidecarMetadata = serde_json::from_str(&json)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(metadata)
}

fn parse_error_prefix(detail: &str) -> (Option<String>, String) {
    if let Some(rest) = detail.strip_prefix('[')
        && let Some((category, message)) = rest.split_once(']')
    {
        return (
            Some(category.trim().to_string()),
            message.trim().to_string(),
        );
    }
    (None, detail.to_string())
}

fn build_run_metadata(
    run_id: &str,
    capability: &str,
    node_id: &str,
    command: &str,
    dry_run: bool,
    status: &str,
    started_at: i64,
    finished_at: i64,
    request_path: &std::path::Path,
    response_path: &std::path::Path,
    exit_code: Option<i32>,
    sidecar: &RunnerSidecarMetadata,
    report: Option<&ApplyPatchReport>,
) -> AiRunMetadata {
    AiRunMetadata {
        run_id: run_id.to_string(),
        capability: capability.to_string(),
        node_id: node_id.to_string(),
        command: command.to_string(),
        dry_run,
        status: status.to_string(),
        started_at,
        finished_at,
        request_path: request_path.display().to_string(),
        response_path: response_path.display().to_string(),
        exit_code,
        provider: sidecar.provider.clone(),
        model: sidecar.model.clone(),
        provider_run_id: sidecar.provider_run_id.clone(),
        retry_count: sidecar.retry_count,
        last_error_category: sidecar.last_error_category.clone(),
        last_error_message: sidecar.last_error_message.clone(),
        last_status_code: sidecar.last_status_code,
        patch_run_id: report.and_then(|report| report.run_id.clone()),
        patch_summary: report.and_then(|report| report.summary.clone()),
    }
}

fn timestamp_now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn validate_response_contract(response: &AiPatchResponse) -> Result<()> {
    if response.version != AI_CONTRACT_VERSION {
        bail!(
            "unsupported AI response version {}; expected {}",
            response.version,
            AI_CONTRACT_VERSION
        );
    }
    if response.kind != "nodex_ai_patch_response" {
        bail!(
            "unsupported AI response kind {}; expected nodex_ai_patch_response",
            response.kind
        );
    }
    if response.capability.trim().is_empty() {
        bail!("AI response capability must not be empty");
    }
    if response.request_node_id.trim().is_empty() {
        bail!("AI response request_node_id must not be empty");
    }
    if response.status != "ok" {
        bail!(
            "AI response status {} is not applyable; expected ok",
            response.status
        );
    }
    Ok(())
}

fn excerpt_text(text: &str, limit: usize) -> String {
    let normalized = text.trim();
    if normalized.chars().count() <= limit {
        return normalized.to_string();
    }

    normalized.chars().take(limit).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use tempfile::tempdir;

    use crate::{ai::{AiRunMetadata, parse_ai_patch_response}, store::Workspace};

    #[test]
    fn ai_expand_preview_builds_prompt_and_patch_scaffold() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        workspace.add_node(
            "Problem".to_string(),
            "root".to_string(),
            "question".to_string(),
            Some("Why is this hard?".to_string()),
            None,
        )?;
        let problem_id = workspace
            .list_nodes()?
            .into_iter()
            .find(|node| node.title == "Problem")
            .expect("Problem node should exist")
            .id;

        let preview = workspace.preview_ai_expand(&problem_id)?;

        assert_eq!(preview.capability, "expand");
        assert_eq!(preview.mode, "dry_run");
        assert_eq!(preview.target_node.id, problem_id);
        assert!(preview.user_prompt.contains("Problem"));
        assert_eq!(preview.draft_patch.ops.len(), 3);
        assert_eq!(preview.request.kind, "nodex_ai_expand_request");
        assert_eq!(preview.response_template.kind, "nodex_ai_patch_response");
        assert!(
            preview
                .notes
                .iter()
                .any(|line| line.contains("No API key is required"))
        );
        Ok(())
    }

    #[test]
    fn ai_response_parser_accepts_response_template() -> Result<()> {
        let temp_dir = tempdir()?;
        let workspace = Workspace::init_at(temp_dir.path())?;
        let preview = workspace.preview_ai_expand("root")?;
        let response_json = serde_json::to_string_pretty(&preview.response_template)?;

        let parsed = parse_ai_patch_response(&response_json)?;

        assert_eq!(parsed.kind, "nodex_ai_patch_response");
        assert_eq!(parsed.status, "ok");
        assert_eq!(parsed.patch.version, 1);
        Ok(())
    }

    #[test]
    fn ai_response_template_can_be_dry_run_applied() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let preview = workspace.preview_ai_expand("root")?;

        let report = workspace.apply_ai_patch_response(preview.response_template, true)?;

        assert!(report.run_id.is_none());
        assert_eq!(report.preview.len(), 3);
        Ok(())
    }

    #[test]
    fn external_runner_can_round_trip_request_and_response() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let command = r#"python3 - <<'PY'
import json
import os
from pathlib import Path

request = json.loads(Path(os.environ["NODEX_AI_REQUEST"]).read_text())
response = {
    "version": request["contract"]["version"],
    "kind": request["contract"]["response_kind"],
    "capability": request["capability"],
    "request_node_id": request["target_node"]["id"],
    "status": "ok",
    "summary": "External runner scaffold response",
    "generator": {
        "provider": "test_runner",
        "model": None,
        "run_id": "test-run"
    },
    "patch": {
        "version": request["contract"]["patch_version"],
        "summary": "External runner scaffold response",
        "ops": [
            {
                "type": "add_node",
                "parent_id": request["target_node"]["id"],
                "title": "Runner Branch",
                "kind": "topic",
                "body": "Generated by external runner"
            }
        ]
    },
    "notes": ["ok"]
}
Path(os.environ["NODEX_AI_RESPONSE"]).write_text(json.dumps(response, indent=2))
PY"#;

        let report = workspace.run_external_ai_expand("root", command, true)?;

        assert_eq!(report.exit_code, 0);
        assert!(report.metadata_path.ends_with(".meta.json"));
        assert_eq!(report.metadata.status, "dry_run_succeeded");
        assert_eq!(report.metadata.provider.as_deref(), Some("test_runner"));
        assert!(report.report.run_id.is_none());
        assert_eq!(report.report.preview.len(), 1);
        Ok(())
    }

    #[test]
    fn external_runner_failure_surfaces_stderr_category() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let command = r#"python3 - <<'PY'
import sys
sys.stderr.write("[rate_limit] retry budget exhausted\n")
raise SystemExit(23)
PY"#;

        let error = workspace
            .run_external_ai_expand("root", command, true)
            .expect_err("runner should fail");

        assert!(error.to_string().contains("[rate_limit]"));
        assert!(error.to_string().contains("exit code 23"));
        let metadata_path = std::fs::read_dir(&workspace.paths.ai_dir)?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.ends_with(".meta.json"))
            })
            .expect("expected a .meta.json file to be written");
        let metadata_json = std::fs::read_to_string(metadata_path)?;
        let metadata: AiRunMetadata = serde_json::from_str(&metadata_json)?;
        assert_eq!(metadata.status, "failed");
        assert_eq!(metadata.last_error_category.as_deref(), Some("rate_limit"));
        Ok(())
    }
}
