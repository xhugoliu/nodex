use std::process::{Command, Output};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    model::{AiRunRecord, ApplyPatchReport, NodeDetail, SourceChunkRecord},
    patch::{PatchDocument, PatchOp},
    project::ProjectPaths,
    store::Workspace,
};

const AI_CONTRACT_VERSION: u32 = 2;
const MAX_PREVIEW_CHILDREN: usize = 8;
const MAX_LINKED_SOURCES: usize = 2;
const MAX_LINKED_CHUNKS_PER_SOURCE: usize = 2;
const MAX_EVIDENCE_SOURCES: usize = 2;
const MAX_EVIDENCE_CHUNKS_PER_SOURCE: usize = 3;
const AI_CONTEXT_EXCERPT_LIMIT: usize = 180;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiNodeContext {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub body: Option<String>,
    pub parent_title: Option<String>,
    pub child_count: usize,
    pub child_titles: Vec<String>,
    pub omitted_child_count: usize,
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
    pub total_chunks: usize,
    pub omitted_chunk_count: usize,
    pub chunks: Vec<AiChunkContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiContextSummary {
    pub linked_sources_total: usize,
    pub linked_sources_shown: usize,
    pub linked_chunks_total: usize,
    pub linked_chunks_shown: usize,
    pub linked_chunks_omitted: usize,
    pub evidence_sources_total: usize,
    pub evidence_sources_shown: usize,
    pub evidence_chunks_total: usize,
    pub evidence_chunks_shown: usize,
    pub evidence_chunks_omitted: usize,
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
    #[serde(default)]
    pub explore_by: Option<String>,
    pub workspace_name: String,
    pub target_node: AiNodeContext,
    pub context_summary: AiContextSummary,
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
pub struct AiEvidenceReference {
    pub source_id: String,
    pub source_name: String,
    pub chunk_id: String,
    pub label: Option<String>,
    pub start_line: i64,
    pub end_line: i64,
    pub why_it_matters: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPatchExplanation {
    pub rationale_summary: String,
    #[serde(default)]
    pub direct_evidence: Vec<AiEvidenceReference>,
    #[serde(default)]
    pub inferred_suggestions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPatchResponse {
    pub version: u32,
    pub kind: String,
    pub capability: String,
    pub request_node_id: String,
    pub status: String,
    pub summary: Option<String>,
    pub explanation: AiPatchExplanation,
    pub generator: AiGeneratorInfo,
    pub patch: PatchDocument,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiExpandPreview {
    pub capability: String,
    pub explore_by: Option<String>,
    pub mode: String,
    pub workspace_name: String,
    pub target_node: AiNodeContext,
    pub context_summary: AiContextSummary,
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
    pub explanation: AiPatchExplanation,
    pub notes: Vec<String>,
    pub patch: PatchDocument,
    pub report: ApplyPatchReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiRunShowOutput {
    pub record: AiRunRecord,
    pub metadata_path: Option<String>,
    pub explanation: Option<AiPatchExplanation>,
    pub patch: Option<PatchDocument>,
    pub patch_preview: Vec<String>,
    pub response_notes: Vec<String>,
    pub load_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiRunCompareOutput {
    pub left: AiRunShowOutput,
    pub right: AiRunShowOutput,
    pub comparison: AiRunCompareSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiRunCompareSummary {
    pub same_node_id: bool,
    pub same_capability: bool,
    pub same_provider: bool,
    pub same_model: bool,
    pub same_status: bool,
    pub same_used_plain_json_fallback: bool,
    pub same_normalization_notes: bool,
    pub same_rationale_summary: bool,
    pub same_patch_summary: bool,
    pub same_patch_preview: bool,
    pub same_response_notes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRunMetadata {
    pub run_id: String,
    pub capability: String,
    pub explore_by: Option<String>,
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
    #[serde(default)]
    pub used_plain_json_fallback: bool,
    #[serde(default)]
    pub normalization_notes: Vec<String>,
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
    used_plain_json_fallback: bool,
    #[serde(default)]
    normalization_notes: Vec<String>,
    #[serde(default)]
    last_error_category: Option<String>,
    #[serde(default)]
    last_error_message: Option<String>,
    #[serde(default)]
    last_status_code: Option<i32>,
}

impl Workspace {
    pub fn preview_ai_expand(&self, node_id: &str) -> Result<AiExpandPreview> {
        self.preview_ai_draft(node_id, "expand", None)
    }

    pub fn preview_ai_explore(&self, node_id: &str, explore_by: &str) -> Result<AiExpandPreview> {
        self.preview_ai_draft(node_id, "explore", Some(explore_by))
    }

    fn preview_ai_draft(
        &self,
        node_id: &str,
        capability: &str,
        explore_by: Option<&str>,
    ) -> Result<AiExpandPreview> {
        let explore_by = normalize_explore_by(capability, explore_by)?;
        let workspace_name = self.workspace_name()?;
        let detail = self.node_detail(node_id)?;
        let target_node = build_node_context(&detail);
        let linked_sources_total = detail.sources.len();
        let linked_chunks_total = detail
            .sources
            .iter()
            .map(|source_detail| source_detail.chunks.len())
            .sum::<usize>();
        let linked_sources = build_source_contexts(
            detail.sources.iter().map(|source_detail| {
                (
                    source_detail.source.id.clone(),
                    source_detail.source.original_name.clone(),
                    if source_detail.chunks.is_empty() {
                        "source_link".to_string()
                    } else {
                        "source_chunks".to_string()
                    },
                    source_detail.chunks.clone(),
                )
            }),
            MAX_LINKED_SOURCES,
            MAX_LINKED_CHUNKS_PER_SOURCE,
        );
        let evidence_sources_total = detail.evidence.len();
        let evidence_chunks_total = detail
            .evidence
            .iter()
            .map(|evidence_detail| evidence_detail.chunks.len())
            .sum::<usize>();
        let cited_evidence = build_source_contexts(
            detail.evidence.iter().map(|evidence_detail| {
                (
                    evidence_detail.source.id.clone(),
                    evidence_detail.source.original_name.clone(),
                    "evidence".to_string(),
                    evidence_detail.chunks.clone(),
                )
            }),
            MAX_EVIDENCE_SOURCES,
            MAX_EVIDENCE_CHUNKS_PER_SOURCE,
        );
        let context_summary = build_context_summary(
            linked_sources_total,
            linked_chunks_total,
            &linked_sources,
            evidence_sources_total,
            evidence_chunks_total,
            &cited_evidence,
        );

        let system_prompt = build_system_prompt();
        let user_prompt = build_user_prompt(
            &workspace_name,
            &target_node,
            &context_summary,
            &linked_sources,
            &cited_evidence,
            capability,
            explore_by,
        );
        let output_instructions = build_output_instructions();
        let draft_patch = build_draft_patch_scaffold(&target_node, capability, explore_by);
        let explanation_scaffold =
            build_preview_explanation(&target_node, &cited_evidence, capability, explore_by);
        let request = AiExpandRequest {
            version: AI_CONTRACT_VERSION,
            kind: request_kind_for_capability(capability).to_string(),
            capability: capability.to_string(),
            explore_by: explore_by.map(str::to_string),
            workspace_name: workspace_name.clone(),
            target_node: target_node.clone(),
            context_summary: context_summary.clone(),
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
            capability: capability.to_string(),
            request_node_id: target_node.id.clone(),
            status: "ok".to_string(),
            summary: draft_patch.summary.clone(),
            explanation: explanation_scaffold,
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
        let mut notes = vec![
            "No API key is required for this preview.".to_string(),
            "No model call was performed; this command only prepares local AI context.".to_string(),
            "The draft patch is a deterministic scaffold meant for review, editing, or future model replacement.".to_string(),
            "The response template now includes rationale, direct evidence, and inferred suggestions."
                .to_string(),
            "Use --emit-request to export a stable request bundle for an external runtime."
                .to_string(),
            format!(
                "Context is clipped to at most {MAX_LINKED_SOURCES} linked sources / {MAX_LINKED_CHUNKS_PER_SOURCE} chunks each and {MAX_EVIDENCE_SOURCES} evidence sources / {MAX_EVIDENCE_CHUNKS_PER_SOURCE} chunks each."
            ),
        ];
        if let Some(explore_by) = explore_by {
            notes.push(format!(
                "This draft uses the explore angle `{explore_by}` while preserving the same patch review/apply boundary."
            ));
        }

        Ok(AiExpandPreview {
            capability: capability.to_string(),
            explore_by: explore_by.map(str::to_string),
            mode: "dry_run".to_string(),
            workspace_name,
            target_node,
            context_summary,
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
        self.run_external_ai_draft(node_id, "expand", None, command, dry_run)
    }

    pub fn run_external_ai_explore(
        &mut self,
        node_id: &str,
        explore_by: &str,
        command: &str,
        dry_run: bool,
    ) -> Result<ExternalRunnerReport> {
        self.run_external_ai_draft(node_id, "explore", Some(explore_by), command, dry_run)
    }

    fn run_external_ai_draft(
        &mut self,
        node_id: &str,
        capability: &str,
        explore_by: Option<&str>,
        command: &str,
        dry_run: bool,
    ) -> Result<ExternalRunnerReport> {
        let explore_by = normalize_explore_by(capability, explore_by)?;
        let preview = self.preview_ai_draft(node_id, capability, explore_by)?;
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
                capability,
                explore_by,
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
            self.upsert_ai_run_index(&metadata)?;
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
            capability,
            explore_by,
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
        self.upsert_ai_run_index(&metadata)?;

        Ok(ExternalRunnerReport {
            request_path: request_path.display().to_string(),
            response_path: response_path.display().to_string(),
            metadata_path: metadata_path.display().to_string(),
            command: command.to_string(),
            exit_code: output.status.code().unwrap_or_default(),
            metadata,
            explanation: response.explanation,
            notes: response.notes,
            patch: response.patch,
            report,
        })
    }

    pub fn ai_run_show_output(&self, run_id: &str) -> Result<AiRunShowOutput> {
        let record = self
            .ai_run_record_by_id(run_id)?
            .with_context(|| format!("AI run {run_id} was not found"))?;
        let metadata_path = derive_ai_metadata_path(&record.response_path);
        let mut explanation = None;
        let mut patch = self.ai_run_patch_document(run_id).ok();
        let mut response_notes = Vec::new();
        let mut load_notes = Vec::new();

        match self.ai_run_response(run_id) {
            Ok(response) => {
                explanation = Some(response.explanation);
                if patch.is_none() {
                    patch = Some(response.patch);
                }
                response_notes = response.notes;
            }
            Err(err) => {
                load_notes.push(format!("Response artifact could not be loaded: {}", err));
            }
        }

        let patch_preview = patch
            .as_ref()
            .map(PatchDocument::preview_lines)
            .unwrap_or_default();

        Ok(AiRunShowOutput {
            record,
            metadata_path,
            explanation,
            patch,
            patch_preview,
            response_notes,
            load_notes,
        })
    }

    pub fn ai_run_compare_output(
        &self,
        left_run_id: &str,
        right_run_id: &str,
    ) -> Result<AiRunCompareOutput> {
        let left = self.ai_run_show_output(left_run_id)?;
        let right = self.ai_run_show_output(right_run_id)?;

        let left_rationale = left
            .explanation
            .as_ref()
            .map(|value| value.rationale_summary.as_str());
        let right_rationale = right
            .explanation
            .as_ref()
            .map(|value| value.rationale_summary.as_str());
        let left_patch_summary = left
            .patch
            .as_ref()
            .and_then(|value| value.summary.as_deref());
        let right_patch_summary = right
            .patch
            .as_ref()
            .and_then(|value| value.summary.as_deref());

        Ok(AiRunCompareOutput {
            comparison: AiRunCompareSummary {
                same_node_id: left.record.node_id == right.record.node_id,
                same_capability: left.record.capability == right.record.capability,
                same_provider: left.record.provider == right.record.provider,
                same_model: left.record.model == right.record.model,
                same_status: left.record.status == right.record.status,
                same_used_plain_json_fallback: left.record.used_plain_json_fallback
                    == right.record.used_plain_json_fallback,
                same_normalization_notes: left.record.normalization_notes
                    == right.record.normalization_notes,
                same_rationale_summary: left_rationale == right_rationale,
                same_patch_summary: left_patch_summary == right_patch_summary,
                same_patch_preview: left.patch_preview == right.patch_preview,
                same_response_notes: left.response_notes == right.response_notes,
            },
            left,
            right,
        })
    }
}

fn build_node_context(detail: &NodeDetail) -> AiNodeContext {
    let child_count = detail.children.len();
    let child_titles = detail
        .children
        .iter()
        .take(MAX_PREVIEW_CHILDREN)
        .map(|child| child.title.clone())
        .collect::<Vec<_>>();
    AiNodeContext {
        id: detail.node.id.clone(),
        title: detail.node.title.clone(),
        kind: detail.node.kind.clone(),
        body: detail.node.body.clone(),
        parent_title: detail.parent.as_ref().map(|node| node.title.clone()),
        child_count,
        child_titles,
        omitted_child_count: child_count.saturating_sub(MAX_PREVIEW_CHILDREN),
    }
}

fn build_chunk_context(chunk: &SourceChunkRecord) -> AiChunkContext {
    AiChunkContext {
        chunk_id: chunk.id.clone(),
        label: chunk.label.clone(),
        excerpt: excerpt_text(&chunk.text, AI_CONTEXT_EXCERPT_LIMIT),
        start_line: chunk.start_line,
        end_line: chunk.end_line,
    }
}

fn build_source_contexts<I>(
    items: I,
    max_sources: usize,
    max_chunks_per_source: usize,
) -> Vec<AiSourceContext>
where
    I: IntoIterator<Item = (String, String, String, Vec<SourceChunkRecord>)>,
{
    items
        .into_iter()
        .take(max_sources)
        .map(|(source_id, original_name, relation, chunks)| {
            let total_chunks = chunks.len();
            let trimmed_chunks = chunks
                .iter()
                .take(max_chunks_per_source)
                .map(build_chunk_context)
                .collect::<Vec<_>>();
            AiSourceContext {
                source_id,
                original_name,
                relation,
                total_chunks,
                omitted_chunk_count: total_chunks.saturating_sub(max_chunks_per_source),
                chunks: trimmed_chunks,
            }
        })
        .collect()
}

fn build_context_summary(
    linked_sources_total: usize,
    linked_chunks_total: usize,
    linked_sources: &[AiSourceContext],
    evidence_sources_total: usize,
    evidence_chunks_total: usize,
    cited_evidence: &[AiSourceContext],
) -> AiContextSummary {
    let linked_chunks_shown = linked_sources
        .iter()
        .map(|source| source.chunks.len())
        .sum::<usize>();
    let linked_chunks_omitted = linked_sources
        .iter()
        .map(|source| source.omitted_chunk_count)
        .sum::<usize>()
        + linked_chunks_total.saturating_sub(
            linked_sources
                .iter()
                .map(|source| source.total_chunks)
                .sum::<usize>(),
        );
    let evidence_chunks_shown = cited_evidence
        .iter()
        .map(|source| source.chunks.len())
        .sum::<usize>();
    let evidence_chunks_omitted = cited_evidence
        .iter()
        .map(|source| source.omitted_chunk_count)
        .sum::<usize>()
        + evidence_chunks_total.saturating_sub(
            cited_evidence
                .iter()
                .map(|source| source.total_chunks)
                .sum::<usize>(),
        );

    AiContextSummary {
        linked_sources_total,
        linked_sources_shown: linked_sources.len(),
        linked_chunks_total,
        linked_chunks_shown,
        linked_chunks_omitted,
        evidence_sources_total,
        evidence_sources_shown: cited_evidence.len(),
        evidence_chunks_total,
        evidence_chunks_shown,
        evidence_chunks_omitted,
    }
}

fn build_system_prompt() -> String {
    [
        "You are Nodex AI.",
        "Return only a valid Nodex AI patch response in JSON.",
        "The patch must preserve the existing tree and prefer local, incremental edits.",
        "For expand or explore requests, prefer add_node operations under the target node.",
        "Do not rewrite unrelated branches or replace the whole workspace state.",
        "If you cite evidence, keep source links intact and use the existing patch semantics.",
        "Explain the patch with a short rationale, explicit direct evidence, and separate inferred suggestions.",
        "Prefer branch titles that are specific to the node subject, not generic placeholders.",
        "Avoid generic children like Background, Key Points, or Next Steps unless the node content clearly demands them.",
        "Keep sibling branches distinct, structurally parallel, and immediately useful for further expansion.",
    ]
    .join("\n")
}

fn build_output_instructions() -> String {
    [
        "Return one JSON document that matches the nodex_ai_patch_response schema.",
        "Set kind=nodex_ai_patch_response and version=2.",
        "Put the proposed Nodex patch in the patch field.",
        "Keep patch.version=1 and only use supported Nodex patch ops.",
        "Fill explanation.rationale_summary with a concise reason for the proposed edit plan.",
        "Use explanation.direct_evidence only for chunk-backed support you can point to directly.",
        "Use explanation.inferred_suggestions for useful next-step ideas that are not directly backed by a cited chunk.",
        "Do not wrap the response in markdown fences.",
    ]
    .join("\n")
}

fn build_user_prompt(
    workspace_name: &str,
    target_node: &AiNodeContext,
    context_summary: &AiContextSummary,
    linked_sources: &[AiSourceContext],
    cited_evidence: &[AiSourceContext],
    capability: &str,
    explore_by: Option<&str>,
) -> String {
    let style_hint = drafting_style_hint(target_node, capability, explore_by);
    let mut sections = vec![
        format!("Workspace: {workspace_name}"),
        [
            "Target node:",
            &format!("- id: {}", target_node.id),
            &format!("- title: {}", target_node.title),
            &format!("- kind: {}", target_node.kind),
            &format!(
                "- parent: {}",
                target_node.parent_title.as_deref().unwrap_or("(none)")
            ),
            &format!(
                "- body: {}",
                target_node.body.as_deref().unwrap_or("(none)")
            ),
        ]
        .join("\n"),
        [
            "Existing structure:",
            &format!("- child count: {}", target_node.child_count),
            &format!(
                "- shown children: {}",
                if target_node.child_titles.is_empty() {
                    "(none)".to_string()
                } else {
                    target_node.child_titles.join(", ")
                }
            ),
            &format!("- omitted children: {}", target_node.omitted_child_count),
        ]
        .join("\n"),
        [
            if capability == "explore" {
                "Explore guidance:"
            } else {
                "Expansion guidance:"
            },
            if capability == "explore" {
                "- Propose 3 to 5 child nodes that explore this node through one deliberate angle."
            } else {
                "- Propose 3 to 5 child nodes that deepen this specific node."
            },
            "- Titles should be concrete and tied to the node subject.",
            "- Avoid repeating existing child titles.",
            "- Avoid generic buckets unless the content strongly requires them.",
            &format!(
                "- capability: {}",
                if capability == "explore" {
                    "explore"
                } else {
                    "expand"
                }
            ),
            &format!("- explore angle: {}", explore_by.unwrap_or("(none)")),
            &format!("- Style hint: {style_hint}"),
        ]
        .join("\n"),
        [
            "Context budget:",
            &format!(
                "- linked sources: showing {} of {}",
                context_summary.linked_sources_shown, context_summary.linked_sources_total
            ),
            &format!(
                "- linked chunks: showing {} of {}, omitted {}",
                context_summary.linked_chunks_shown,
                context_summary.linked_chunks_total,
                context_summary.linked_chunks_omitted
            ),
            &format!(
                "- evidence sources: showing {} of {}",
                context_summary.evidence_sources_shown, context_summary.evidence_sources_total
            ),
            &format!(
                "- evidence chunks: showing {} of {}, omitted {}",
                context_summary.evidence_chunks_shown,
                context_summary.evidence_chunks_total,
                context_summary.evidence_chunks_omitted
            ),
        ]
        .join("\n"),
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
        [
            "Output requirements:",
            "- Return a version 1 patch document.",
            "- Prefer add_node ops under the target node.",
            "- Keep the summary concise and human-readable.",
            "- Explain why this draft is reasonable in explanation.rationale_summary.",
            "- Put chunk-backed support into explanation.direct_evidence.",
            "- Put unsupported but useful ideas into explanation.inferred_suggestions.",
            "- The patch should be directly reviewable and applyable.",
        ]
        .join("\n"),
    );

    sections.join("\n\n")
}

fn format_source_section(title: &str, sources: &[AiSourceContext]) -> String {
    let mut lines = vec![format!("{title}:")];
    for source in sources {
        lines.push(format!(
            "- {} [{}] relation={} showing {} of {} chunks",
            source.original_name,
            source.source_id,
            source.relation,
            source.chunks.len(),
            source.total_chunks
        ));
        if source.omitted_chunk_count > 0 {
            lines.push(format!(
                "  - omitted chunks: {}",
                source.omitted_chunk_count
            ));
        }
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

fn build_draft_patch_scaffold(
    target_node: &AiNodeContext,
    capability: &str,
    explore_by: Option<&str>,
) -> PatchDocument {
    let suggestions = suggested_branch_titles(target_node, capability, explore_by);
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
                kind: Some(suggested_child_kind(capability, explore_by).to_string()),
                body: Some(format!(
                    "Local dry-run scaffold branch {} for {} \"{}\".",
                    index + 1,
                    if capability == "explore" {
                        "exploring"
                    } else {
                        "expanding"
                    },
                    target_node.title
                )),
                position: None,
            }
        })
        .collect();

    PatchDocument {
        version: 1,
        summary: Some(format!(
            "AI dry-run scaffold for {} node {}{}",
            capability,
            target_node.id,
            explore_by
                .map(|value| format!(" by {}", value))
                .unwrap_or_default()
        )),
        ops,
    }
}

fn request_kind_for_capability(capability: &str) -> &'static str {
    match capability {
        "expand" => "nodex_ai_expand_request",
        "explore" => "nodex_ai_explore_request",
        _ => "nodex_ai_patch_request",
    }
}

fn normalize_explore_by<'a>(
    capability: &str,
    explore_by: Option<&'a str>,
) -> Result<Option<&'a str>> {
    match capability {
        "expand" => Ok(None),
        "explore" => {
            let value = explore_by
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .with_context(|| "explore drafts require a non-empty `by` angle")?;
            match value {
                "risk" | "question" | "action" | "evidence" => Ok(Some(value)),
                _ => bail!(
                    "unsupported explore angle `{}`; expected one of risk|question|action|evidence",
                    value
                ),
            }
        }
        _ => bail!("unsupported AI capability `{capability}`"),
    }
}

fn build_preview_explanation(
    target_node: &AiNodeContext,
    cited_evidence: &[AiSourceContext],
    capability: &str,
    explore_by: Option<&str>,
) -> AiPatchExplanation {
    let direct_evidence = cited_evidence
        .iter()
        .flat_map(|source| {
            source.chunks.iter().map(|chunk| AiEvidenceReference {
                source_id: source.source_id.clone(),
                source_name: source.original_name.clone(),
                chunk_id: chunk.chunk_id.clone(),
                label: chunk.label.clone(),
                start_line: chunk.start_line,
                end_line: chunk.end_line,
                why_it_matters: format!(
                    "This chunk is already cited on \"{}\" and should be treated as direct support if the final draft depends on it.",
                    target_node.title
                ),
            })
        })
        .take(MAX_EVIDENCE_CHUNKS_PER_SOURCE)
        .collect::<Vec<_>>();

    let inferred_suggestions = if direct_evidence.is_empty() {
        vec![
            "No cited evidence is available in this local dry-run scaffold, so the draft branches are still unverified suggestions.".to_string(),
            "If you use linked context without a cited chunk, describe that reasoning as inference rather than direct evidence.".to_string(),
        ]
    } else {
        vec![
            "Treat uncited branch ideas as inferred suggestions until you attach or cite supporting chunks.".to_string(),
            "If a branch depends on general context beyond the cited chunks above, keep that claim in inferred_suggestions.".to_string(),
        ]
    };

    AiPatchExplanation {
        rationale_summary: format!(
            "Local dry-run scaffold for {} \"{}\"{}. Replace this rationale with model-generated reasoning before applying.",
            if capability == "explore" {
                "exploring"
            } else {
                "expanding"
            },
            target_node.title,
            explore_by
                .map(|value| format!(" by {}", value))
                .unwrap_or_default()
        ),
        direct_evidence,
        inferred_suggestions,
    }
}

fn suggested_branch_titles(
    target_node: &AiNodeContext,
    capability: &str,
    explore_by: Option<&str>,
) -> Vec<&'static str> {
    if capability == "explore" {
        return match explore_by {
            Some("risk") => vec!["Risk Triggers", "Failure Modes", "Mitigations"],
            Some("question") => vec!["Clarifying Questions", "Unknowns", "Tests To Run"],
            Some("action") => vec!["Immediate Actions", "Dependencies", "Execution Order"],
            Some("evidence") => vec!["Direct Support", "Evidence Gaps", "Counterpoints"],
            _ => vec!["Important Angles", "Open Questions", "Next Moves"],
        };
    }

    let title_and_body = format!(
        "{}\n{}",
        target_node.title.to_ascii_lowercase(),
        target_node
            .body
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
    );

    if title_and_body.contains("plan")
        || title_and_body.contains("roadmap")
        || title_and_body.contains("launch")
    {
        return vec!["Goals", "Constraints", "Execution"];
    }
    if title_and_body.contains("risk") || title_and_body.contains("issue") {
        return vec!["Failure Modes", "Impact", "Mitigations"];
    }
    if title_and_body.contains("research")
        || title_and_body.contains("paper")
        || title_and_body.contains("study")
    {
        return vec!["Key Claims", "Evidence", "Open Questions"];
    }

    match target_node.kind.as_str() {
        "question" => vec!["Possible Answers", "Evidence Needed", "Open Questions"],
        "action" => vec!["Immediate Steps", "Dependencies", "Risks"],
        "evidence" => vec!["Claim", "Supporting Evidence", "Counterpoints"],
        "source" => vec!["Main Themes", "Important Evidence", "Open Threads"],
        _ => vec!["Core Tension", "Important Angles", "Decision Points"],
    }
}

fn suggested_child_kind(capability: &str, explore_by: Option<&str>) -> &'static str {
    if capability == "explore" {
        return match explore_by {
            Some("question") => "question",
            Some("action") => "action",
            Some("evidence") => "evidence",
            _ => "topic",
        };
    }
    "topic"
}

fn drafting_style_hint(
    target_node: &AiNodeContext,
    capability: &str,
    explore_by: Option<&str>,
) -> &'static str {
    if capability == "explore" {
        return match explore_by {
            Some("risk") => "Focus on triggers, concrete failure modes, and mitigations.",
            Some("question") => {
                "Focus on unanswered questions, missing context, and the next checks to run."
            }
            Some("action") => "Focus on immediate actions, dependencies, and execution sequence.",
            Some("evidence") => "Focus on direct support, gaps in support, and counterevidence.",
            _ => "Explore the node through one deliberate angle rather than broad expansion.",
        };
    }

    let title_and_body = format!(
        "{}\n{}",
        target_node.title.to_ascii_lowercase(),
        target_node
            .body
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
    );

    if title_and_body.contains("plan")
        || title_and_body.contains("roadmap")
        || title_and_body.contains("launch")
    {
        return "Break the node into goals, constraints, and execution tracks.";
    }
    if title_and_body.contains("risk") || title_and_body.contains("issue") {
        return "Break the node into failure modes, impact, and mitigations.";
    }
    if title_and_body.contains("research")
        || title_and_body.contains("paper")
        || title_and_body.contains("study")
    {
        return "Break the node into claims, evidence, and open questions.";
    }

    match target_node.kind.as_str() {
        "question" => "Prefer hypotheses, evidence needs, and open uncertainties.",
        "action" => "Prefer execution slices, dependencies, and delivery risks.",
        "evidence" => "Prefer claim, support, and counterpoint branches.",
        "source" => "Prefer themes, evidence, and unresolved threads from the source.",
        _ => "Prefer concrete, subject-specific angles that invite further expansion.",
    }
}

pub fn parse_ai_patch_response(response_json: &str) -> Result<AiPatchResponse> {
    let response: AiPatchResponse =
        serde_json::from_str(response_json).context("failed to parse AI response JSON")?;
    validate_response_contract(&response)?;
    Ok(response)
}

pub fn derive_ai_metadata_path(response_path: &str) -> Option<String> {
    response_path
        .strip_suffix(".response.json")
        .map(|value| format!("{value}.meta.json"))
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

#[cfg(test)]
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

#[cfg(windows)]
fn build_external_shell_command(command: &str) -> Command {
    let mut process = Command::new("powershell");
    process
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(format!("& {command}; exit $LASTEXITCODE"));
    process
}

#[cfg(not(windows))]
fn build_external_shell_command(command: &str) -> Command {
    let mut process = Command::new("sh");
    process.arg("-lc").arg(command);
    process
}

fn run_external_command(
    paths: &ProjectPaths,
    command: &str,
    request_path: &std::path::Path,
    response_path: &std::path::Path,
    metadata_path: &std::path::Path,
    node_id: &str,
) -> Result<Output> {
    build_external_shell_command(command)
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
    explore_by: Option<&str>,
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
        explore_by: explore_by.map(str::to_string),
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
        used_plain_json_fallback: sidecar.used_plain_json_fallback,
        normalization_notes: sidecar.normalization_notes.clone(),
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
    if response.explanation.rationale_summary.trim().is_empty() {
        bail!("AI response explanation.rationale_summary must not be empty");
    }
    for (index, item) in response.explanation.direct_evidence.iter().enumerate() {
        if item.source_id.trim().is_empty() {
            bail!(
                "AI response explanation.direct_evidence[{}].source_id must not be empty",
                index
            );
        }
        if item.source_name.trim().is_empty() {
            bail!(
                "AI response explanation.direct_evidence[{}].source_name must not be empty",
                index
            );
        }
        if item.chunk_id.trim().is_empty() {
            bail!(
                "AI response explanation.direct_evidence[{}].chunk_id must not be empty",
                index
            );
        }
        if item.why_it_matters.trim().is_empty() {
            bail!(
                "AI response explanation.direct_evidence[{}].why_it_matters must not be empty",
                index
            );
        }
    }
    for (index, item) in response.explanation.inferred_suggestions.iter().enumerate() {
        if item.trim().is_empty() {
            bail!(
                "AI response explanation.inferred_suggestions[{}] must not be empty",
                index
            );
        }
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

    use crate::{
        ai::{AiRunMetadata, derive_ai_metadata_path, parse_ai_patch_response, shell_quote},
        patch::{PatchDocument, PatchOp},
        store::Workspace,
    };

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
        assert!(preview.user_prompt.contains("Avoid generic"));
        assert!(preview.user_prompt.contains("Style hint"));
        assert!(preview.user_prompt.contains("Context budget"));
        assert_eq!(preview.draft_patch.ops.len(), 3);
        assert_eq!(preview.response_template.version, 2);
        assert!(
            preview
                .response_template
                .explanation
                .rationale_summary
                .contains("Local dry-run scaffold")
        );
        assert!(
            preview
                .response_template
                .explanation
                .inferred_suggestions
                .iter()
                .any(|line| line.contains("inference"))
        );
        assert!(preview.draft_patch.preview_lines().iter().all(|line| {
            !line.contains("Background")
                && !line.contains("Key Points")
                && !line.contains("Next Steps")
        }));
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
    fn ai_expand_preview_clips_evidence_context() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let source_path = temp_dir.path().join("notes.md");
        std::fs::write(
            &source_path,
            "# Launch Plan\n\n## One\nAlpha.\n\n## Two\nBeta.\n\n## Three\nGamma.\n\n## Four\nDelta.\n",
        )?;

        let import_report = workspace.import_source(&source_path)?;
        let source_detail = workspace.source_detail(&import_report.source_id)?;
        let chunk_ids = source_detail
            .chunks
            .iter()
            .map(|chunk| chunk.chunk.id.clone())
            .collect::<Vec<_>>();
        workspace.apply_patch_document(
            PatchDocument {
                version: 1,
                summary: Some("Prepare idea node".to_string()),
                ops: vec![
                    PatchOp::AddNode {
                        id: Some("idea".to_string()),
                        parent_id: "root".to_string(),
                        title: "Launch Plan".to_string(),
                        kind: Some("topic".to_string()),
                        body: Some("Need a sharper execution plan.".to_string()),
                        position: None,
                    },
                    PatchOp::AttachSource {
                        node_id: "idea".to_string(),
                        source_id: import_report.source_id.clone(),
                    },
                    PatchOp::CiteSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_ids[0].clone(),
                        citation_kind: None,
                        rationale: None,
                    },
                    PatchOp::CiteSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_ids[1].clone(),
                        citation_kind: None,
                        rationale: None,
                    },
                    PatchOp::CiteSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_ids[2].clone(),
                        citation_kind: None,
                        rationale: None,
                    },
                    PatchOp::CiteSourceChunk {
                        node_id: "idea".to_string(),
                        chunk_id: chunk_ids[3].clone(),
                        citation_kind: None,
                        rationale: None,
                    },
                ],
            },
            "test",
            false,
        )?;

        let preview = workspace.preview_ai_expand("idea")?;

        assert_eq!(preview.cited_evidence.len(), 1);
        assert_eq!(preview.context_summary.evidence_sources_total, 1);
        assert_eq!(preview.context_summary.evidence_chunks_total, 4);
        assert_eq!(preview.context_summary.evidence_chunks_shown, 3);
        assert_eq!(preview.context_summary.evidence_chunks_omitted, 1);
        assert_eq!(preview.cited_evidence[0].total_chunks, 4);
        assert_eq!(preview.cited_evidence[0].chunks.len(), 3);
        assert_eq!(preview.cited_evidence[0].omitted_chunk_count, 1);
        assert_eq!(
            preview.response_template.explanation.direct_evidence.len(),
            3
        );
        assert!(preview.user_prompt.contains("omitted chunks: 1"));
        Ok(())
    }

    #[test]
    fn ai_explore_preview_uses_requested_angle() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        workspace.add_node(
            "Launch Plan".to_string(),
            "root".to_string(),
            "topic".to_string(),
            Some("Need sharper execution sequencing.".to_string()),
            None,
        )?;
        let node_id = workspace
            .list_nodes()?
            .into_iter()
            .find(|node| node.title == "Launch Plan")
            .expect("Launch Plan node should exist")
            .id;

        let preview = workspace.preview_ai_explore(&node_id, "action")?;
        let preview_lines = preview.draft_patch.preview_lines();

        assert_eq!(preview.capability, "explore");
        assert_eq!(preview.explore_by.as_deref(), Some("action"));
        assert_eq!(preview.request.kind, "nodex_ai_explore_request");
        assert_eq!(preview.request.explore_by.as_deref(), Some("action"));
        assert!(preview.user_prompt.contains("explore angle: action"));
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Immediate Actions\""))
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Dependencies\""))
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Execution Order\""))
        );
        Ok(())
    }

    #[test]
    fn style_hint_prefers_plan_structure_for_launch_nodes() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        workspace.add_node(
            "Launch Plan".to_string(),
            "root".to_string(),
            "topic".to_string(),
            Some("Need a sharper launch roadmap.".to_string()),
            None,
        )?;
        let node_id = workspace
            .list_nodes()?
            .into_iter()
            .find(|node| node.title == "Launch Plan")
            .expect("Launch Plan node should exist")
            .id;

        let preview = workspace.preview_ai_expand(&node_id)?;
        let preview_lines = preview.draft_patch.preview_lines();

        assert!(
            preview
                .user_prompt
                .contains("goals, constraints, and execution")
        );
        assert!(preview_lines.iter().any(|line| line.contains("\"Goals\"")));
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Constraints\""))
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Execution\""))
        );
        Ok(())
    }

    #[test]
    fn style_hint_prefers_risk_structure_for_risk_nodes() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        workspace.add_node(
            "Risk Register".to_string(),
            "root".to_string(),
            "topic".to_string(),
            Some("Top risks for delivery.".to_string()),
            None,
        )?;
        let node_id = workspace
            .list_nodes()?
            .into_iter()
            .find(|node| node.title == "Risk Register")
            .expect("Risk Register node should exist")
            .id;

        let preview = workspace.preview_ai_expand(&node_id)?;
        let preview_lines = preview.draft_patch.preview_lines();

        assert!(
            preview
                .user_prompt
                .contains("failure modes, impact, and mitigations")
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Failure Modes\""))
        );
        assert!(preview_lines.iter().any(|line| line.contains("\"Impact\"")));
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Mitigations\""))
        );
        Ok(())
    }

    #[test]
    fn style_hint_prefers_research_structure_for_research_nodes() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        workspace.add_node(
            "Research Notes".to_string(),
            "root".to_string(),
            "topic".to_string(),
            Some("Summarize claims from the study.".to_string()),
            None,
        )?;
        let node_id = workspace
            .list_nodes()?
            .into_iter()
            .find(|node| node.title == "Research Notes")
            .expect("Research Notes node should exist")
            .id;

        let preview = workspace.preview_ai_expand(&node_id)?;
        let preview_lines = preview.draft_patch.preview_lines();

        assert!(
            preview
                .user_prompt
                .contains("claims, evidence, and open questions")
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Key Claims\""))
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Evidence\""))
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains("\"Open Questions\""))
        );
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
        let command = test_python_command(
            &temp_dir,
            "round_trip_runner.py",
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
    "summary": "External runner scaffold response",
    "explanation": {
        "rationale_summary": "Expand the node with one runner-generated branch.",
        "direct_evidence": [],
        "inferred_suggestions": [
            "The branch is a runner scaffold and should be reviewed before apply."
        ]
    },
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
"#,
        )?;

        let report = workspace.run_external_ai_expand("root", &command, true)?;
        let history = workspace.ai_run_history(Some("root"))?;

        assert_eq!(report.exit_code, 0);
        assert!(report.metadata_path.ends_with(".meta.json"));
        assert_eq!(report.metadata.status, "dry_run_succeeded");
        assert_eq!(report.metadata.provider.as_deref(), Some("test_runner"));
        assert_eq!(
            report.explanation.rationale_summary,
            "Expand the node with one runner-generated branch."
        );
        assert_eq!(report.notes, vec!["ok".to_string()]);
        assert!(report.report.run_id.is_none());
        assert_eq!(report.report.preview.len(), 1);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].status, "dry_run_succeeded");
        assert_eq!(history[0].node_id, "root");
        Ok(())
    }

    #[test]
    fn external_runner_can_round_trip_explore_request_and_response() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let command = test_python_command(
            &temp_dir,
            "explore_runner.py",
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
    "summary": "External runner explore response",
    "explanation": {
        "rationale_summary": "Explore the node through an action-focused angle.",
        "direct_evidence": [],
        "inferred_suggestions": [
            "Use the action angle to draft sequencing branches."
        ]
    },
    "generator": {
        "provider": "test_runner",
        "model": None,
        "run_id": "test-explore-run"
    },
    "patch": {
        "version": request["contract"]["patch_version"],
        "summary": "External runner explore response",
        "ops": [
            {
                "type": "add_node",
                "parent_id": request["target_node"]["id"],
                "title": "Immediate Actions",
                "kind": "action",
                "body": "Generated by external runner"
            }
        ]
    },
    "notes": ["ok"]
}
Path(os.environ["NODEX_AI_RESPONSE"]).write_text(json.dumps(response, indent=2))
"#,
        )?;

        let report = workspace.run_external_ai_explore("root", "action", &command, true)?;

        assert_eq!(report.exit_code, 0);
        assert_eq!(report.metadata.capability, "explore");
        assert_eq!(report.metadata.explore_by.as_deref(), Some("action"));
        assert_eq!(
            report.explanation.rationale_summary,
            "Explore the node through an action-focused angle."
        );
        assert!(report.report.run_id.is_none());
        assert_eq!(report.report.preview.len(), 1);
        Ok(())
    }

    #[test]
    fn ai_run_show_output_loads_explanation_patch_preview_and_notes() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let command = test_python_command(
            &temp_dir,
            "show_output_runner.py",
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
    "summary": "Runner preview branch",
    "explanation": {
        "rationale_summary": "Show output should include this rationale.",
        "direct_evidence": [],
        "inferred_suggestions": [
            "Keep this as a dry-run until the branch is reviewed."
        ]
    },
    "generator": {
        "provider": "test_runner",
        "model": None,
        "run_id": "show-output-run"
    },
    "patch": {
        "version": request["contract"]["patch_version"],
        "summary": "Runner preview branch",
        "ops": [
            {
                "type": "add_node",
                "parent_id": request["target_node"]["id"],
                "title": "Show Output Branch",
                "kind": "topic",
                "body": "Generated for show output test"
            }
        ]
    },
    "notes": ["show-note"]
}
Path(os.environ["NODEX_AI_RESPONSE"]).write_text(json.dumps(response, indent=2))
"#,
        )?;

        let report = workspace.run_external_ai_expand("root", &command, true)?;
        let output = workspace.ai_run_show_output(&report.metadata.run_id)?;

        assert_eq!(output.record.id, report.metadata.run_id);
        assert!(output.load_notes.is_empty());
        assert_eq!(output.response_notes, vec!["show-note".to_string()]);
        assert_eq!(
            output
                .explanation
                .as_ref()
                .map(|value| value.rationale_summary.as_str()),
            Some("Show output should include this rationale.")
        );
        assert_eq!(output.patch_preview.len(), 1);
        assert!(
            output.patch_preview[0].contains("\"Show Output Branch\""),
            "expected preview line to mention the replayable branch"
        );
        assert_eq!(
            output.metadata_path.as_deref(),
            derive_ai_metadata_path(&report.response_path).as_deref()
        );
        Ok(())
    }

    #[test]
    fn ai_run_compare_output_detects_patch_and_note_differences() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let first_command = test_python_command(
            &temp_dir,
            "compare_left_runner.py",
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
    "summary": "Compare Left",
    "explanation": {
        "rationale_summary": "First compare rationale.",
        "direct_evidence": [],
        "inferred_suggestions": []
    },
    "generator": {
        "provider": "test_runner",
        "model": None,
        "run_id": "compare-left"
    },
    "patch": {
        "version": request["contract"]["patch_version"],
        "summary": "Compare Left",
        "ops": [
            {
                "type": "add_node",
                "parent_id": request["target_node"]["id"],
                "title": "Left Branch",
                "kind": "topic",
                "body": "Left branch"
            }
        ]
    },
    "notes": ["left-note"]
}
meta = {
    "used_plain_json_fallback": True,
    "normalization_notes": ["runner_normalized:left"]
}
Path(os.environ["NODEX_AI_META"]).write_text(json.dumps(meta, indent=2))
Path(os.environ["NODEX_AI_RESPONSE"]).write_text(json.dumps(response, indent=2))
"#,
        )?;
        let second_command = test_python_command(
            &temp_dir,
            "compare_right_runner.py",
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
    "summary": "Compare Right",
    "explanation": {
        "rationale_summary": "Second compare rationale.",
        "direct_evidence": [],
        "inferred_suggestions": []
    },
    "generator": {
        "provider": "test_runner",
        "model": None,
        "run_id": "compare-right"
    },
    "patch": {
        "version": request["contract"]["patch_version"],
        "summary": "Compare Right",
        "ops": [
            {
                "type": "add_node",
                "parent_id": request["target_node"]["id"],
                "title": "Right Branch",
                "kind": "topic",
                "body": "Right branch"
            }
        ]
    },
    "notes": ["right-note"]
}
meta = {
    "used_plain_json_fallback": False,
    "normalization_notes": ["runner_normalized:right"]
}
Path(os.environ["NODEX_AI_META"]).write_text(json.dumps(meta, indent=2))
Path(os.environ["NODEX_AI_RESPONSE"]).write_text(json.dumps(response, indent=2))
"#,
        )?;

        let left = workspace.run_external_ai_expand("root", &first_command, true)?;
        let right = workspace.run_external_ai_expand("root", &second_command, true)?;
        let compare =
            workspace.ai_run_compare_output(&left.metadata.run_id, &right.metadata.run_id)?;

        assert!(compare.comparison.same_node_id);
        assert!(compare.comparison.same_capability);
        assert!(!compare.comparison.same_used_plain_json_fallback);
        assert!(!compare.comparison.same_normalization_notes);
        assert!(!compare.comparison.same_rationale_summary);
        assert!(!compare.comparison.same_patch_summary);
        assert!(!compare.comparison.same_patch_preview);
        assert!(!compare.comparison.same_response_notes);
        Ok(())
    }

    #[test]
    fn external_runner_failure_surfaces_stderr_category() -> Result<()> {
        let temp_dir = tempdir()?;
        let mut workspace = Workspace::init_at(temp_dir.path())?;
        let command = test_python_command(
            &temp_dir,
            "failing_runner.py",
            r#"import sys

sys.stderr.write("[rate_limit] retry budget exhausted\n")
raise SystemExit(23)
"#,
        )?;

        let error = workspace
            .run_external_ai_expand("root", &command, true)
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
        let history = workspace.ai_run_history(Some("root"))?;
        assert_eq!(metadata.status, "failed");
        assert_eq!(metadata.last_error_category.as_deref(), Some("rate_limit"));
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].status, "failed");
        assert_eq!(
            history[0].last_error_category.as_deref(),
            Some("rate_limit")
        );
        Ok(())
    }

    #[test]
    fn derives_metadata_path_from_response_path() {
        assert_eq!(
            derive_ai_metadata_path("/tmp/run-1.response.json").as_deref(),
            Some("/tmp/run-1.meta.json")
        );
        assert!(derive_ai_metadata_path("/tmp/run-1.json").is_none());
    }
}
