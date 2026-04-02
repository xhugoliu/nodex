use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::patch::PatchDocument;

fn default_citation_kind() -> String {
    "direct".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Node {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub kind: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TreeNode {
    pub node: Node,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotState {
    pub metadata: BTreeMap<String, String>,
    pub nodes: Vec<Node>,
    pub sources: Vec<SourceRecord>,
    pub node_sources: Vec<NodeSourceRecord>,
    pub source_chunks: Vec<SourceChunkRecord>,
    pub node_source_chunks: Vec<NodeSourceChunkRecord>,
    #[serde(default)]
    pub node_evidence_chunks: Vec<NodeEvidenceChunkRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PatchRunRecord {
    pub id: String,
    pub summary: Option<String>,
    pub origin: String,
    pub file_name: String,
    pub applied_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotRecord {
    pub id: String,
    pub label: Option<String>,
    pub file_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyPatchReport {
    pub run_id: Option<String>,
    pub summary: Option<String>,
    pub preview: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceRecord {
    pub id: String,
    pub original_path: String,
    pub original_name: String,
    pub stored_name: String,
    pub format: String,
    pub imported_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeSourceRecord {
    pub node_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceChunkRecord {
    pub id: String,
    pub source_id: String,
    pub ordinal: i64,
    pub label: Option<String>,
    pub text: String,
    pub start_line: i64,
    pub end_line: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeSourceChunkRecord {
    pub node_id: String,
    pub chunk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeEvidenceChunkRecord {
    pub node_id: String,
    pub chunk_id: String,
    #[serde(default = "default_citation_kind")]
    pub citation_kind: String,
    #[serde(default)]
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceImportReport {
    pub source_id: String,
    pub original_name: String,
    pub stored_name: String,
    pub root_node_id: String,
    pub root_title: String,
    pub node_count: usize,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceImportPreview {
    pub report: SourceImportReport,
    pub patch: PatchDocument,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeSummary {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeSourceDetail {
    pub source: SourceRecord,
    pub chunks: Vec<SourceChunkRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceCitationDetail {
    pub chunk: SourceChunkRecord,
    pub citation_kind: String,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeEvidenceDetail {
    pub source: SourceRecord,
    pub chunks: Vec<SourceChunkRecord>,
    pub citations: Vec<EvidenceCitationDetail>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceNodeSummary {
    pub node: NodeSummary,
    pub citation_kind: String,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeDetail {
    pub node: Node,
    pub parent: Option<NodeSummary>,
    pub children: Vec<NodeSummary>,
    pub sources: Vec<NodeSourceDetail>,
    pub evidence: Vec<NodeEvidenceDetail>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceChunkDetail {
    pub chunk: SourceChunkRecord,
    pub linked_nodes: Vec<NodeSummary>,
    pub evidence_nodes: Vec<NodeSummary>,
    pub evidence_links: Vec<EvidenceNodeSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceDetail {
    pub source: SourceRecord,
    pub chunks: Vec<SourceChunkDetail>,
}
