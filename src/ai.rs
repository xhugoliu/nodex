use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::{
    model::{ApplyPatchReport, NodeDetail, SourceChunkRecord},
    patch::{PatchDocument, PatchOp},
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

    use crate::{ai::parse_ai_patch_response, store::Workspace};

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
}
