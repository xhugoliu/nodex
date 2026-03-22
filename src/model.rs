use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone)]
pub struct PatchRunRecord {
    pub id: String,
    pub summary: Option<String>,
    pub origin: String,
    pub file_name: String,
    pub applied_at: i64,
}

#[derive(Debug, Clone)]
pub struct SnapshotRecord {
    pub id: String,
    pub label: Option<String>,
    pub file_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct ApplyPatchReport {
    pub run_id: Option<String>,
    pub summary: Option<String>,
    pub preview: Vec<String>,
}
