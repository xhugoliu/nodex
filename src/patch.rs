use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchDocument {
    pub version: u32,
    #[serde(default)]
    pub summary: Option<String>,
    pub ops: Vec<PatchOp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PatchOp {
    AddNode {
        #[serde(default)]
        id: Option<String>,
        parent_id: String,
        title: String,
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        position: Option<i64>,
    },
    UpdateNode {
        id: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        kind: Option<String>,
    },
    MoveNode {
        id: String,
        parent_id: String,
        #[serde(default)]
        position: Option<i64>,
    },
    DeleteNode {
        id: String,
    },
    AttachSource {
        node_id: String,
        source_id: String,
    },
    AttachSourceChunk {
        node_id: String,
        chunk_id: String,
    },
    DetachSource {
        node_id: String,
        source_id: String,
    },
    DetachSourceChunk {
        node_id: String,
        chunk_id: String,
    },
}

impl PatchDocument {
    pub fn resolved(mut self) -> Self {
        for op in &mut self.ops {
            if let PatchOp::AddNode { id, .. } = op
                && id.is_none()
            {
                *id = Some(Uuid::new_v4().to_string());
            }
        }
        self
    }

    pub fn preview_lines(&self) -> Vec<String> {
        self.ops.iter().map(PatchOp::describe).collect()
    }
}

impl PatchOp {
    pub fn describe(&self) -> String {
        match self {
            Self::AddNode {
                id,
                parent_id,
                title,
                kind,
                position,
                ..
            } => {
                let node_id = id.as_deref().unwrap_or("<generated>");
                let node_kind = kind.as_deref().unwrap_or("topic");
                match position {
                    Some(position) => format!(
                        "add node \"{title}\" ({node_kind}) as {node_id} under {parent_id} at position {position}"
                    ),
                    None => {
                        format!("add node \"{title}\" ({node_kind}) as {node_id} under {parent_id}")
                    }
                }
            }
            Self::UpdateNode {
                id, title, kind, ..
            } => {
                let mut changes = Vec::new();
                if let Some(title) = title {
                    changes.push(format!("title=\"{title}\""));
                }
                if let Some(kind) = kind {
                    changes.push(format!("kind={kind}"));
                }
                if self.body_is_set() {
                    changes.push("body=...".to_string());
                }
                let change_summary = if changes.is_empty() {
                    "no field changes".to_string()
                } else {
                    changes.join(", ")
                };
                format!("update node {id}: {change_summary}")
            }
            Self::MoveNode {
                id,
                parent_id,
                position,
            } => match position {
                Some(position) => {
                    format!("move node {id} under {parent_id} at position {position}")
                }
                None => format!("move node {id} under {parent_id}"),
            },
            Self::DeleteNode { id } => format!("delete node {id}"),
            Self::AttachSource { node_id, source_id } => {
                format!("attach source {source_id} to node {node_id}")
            }
            Self::AttachSourceChunk { node_id, chunk_id } => {
                format!("attach source chunk {chunk_id} to node {node_id}")
            }
            Self::DetachSource { node_id, source_id } => {
                format!("detach source {source_id} from node {node_id}")
            }
            Self::DetachSourceChunk { node_id, chunk_id } => {
                format!("detach source chunk {chunk_id} from node {node_id}")
            }
        }
    }

    fn body_is_set(&self) -> bool {
        matches!(self, Self::UpdateNode { body: Some(_), .. })
    }
}
