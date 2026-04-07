use std::collections::HashMap;

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
    CiteSourceChunk {
        node_id: String,
        chunk_id: String,
        #[serde(default)]
        citation_kind: Option<String>,
        #[serde(default)]
        rationale: Option<String>,
    },
    DetachSource {
        node_id: String,
        source_id: String,
    },
    DetachSourceChunk {
        node_id: String,
        chunk_id: String,
    },
    UnciteSourceChunk {
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

    pub fn replayable(&self) -> Self {
        let mut node_id_map = HashMap::new();
        for op in &self.ops {
            if let PatchOp::AddNode { id: Some(id), .. } = op {
                node_id_map
                    .entry(id.clone())
                    .or_insert_with(|| Uuid::new_v4().to_string());
            }
        }

        Self {
            version: self.version,
            summary: self.summary.clone(),
            ops: self
                .ops
                .iter()
                .cloned()
                .map(|op| op.with_remapped_node_ids(&node_id_map))
                .collect(),
        }
    }
}

impl PatchOp {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::AddNode { .. } => "add_node",
            Self::UpdateNode { .. } => "update_node",
            Self::MoveNode { .. } => "move_node",
            Self::DeleteNode { .. } => "delete_node",
            Self::AttachSource { .. } => "attach_source",
            Self::AttachSourceChunk { .. } => "attach_source_chunk",
            Self::CiteSourceChunk { .. } => "cite_source_chunk",
            Self::DetachSource { .. } => "detach_source",
            Self::DetachSourceChunk { .. } => "detach_source_chunk",
            Self::UnciteSourceChunk { .. } => "uncite_source_chunk",
        }
    }

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
            Self::CiteSourceChunk {
                node_id,
                chunk_id,
                citation_kind,
                rationale,
            } => {
                let citation_kind = citation_kind.as_deref().unwrap_or("direct");
                let mut description = format!(
                    "cite source chunk {chunk_id} as {citation_kind} evidence for node {node_id}"
                );
                if let Some(rationale) = rationale.as_deref().filter(|value| !value.is_empty()) {
                    description.push_str(&format!(" rationale=\"{rationale}\""));
                }
                description
            }
            Self::DetachSource { node_id, source_id } => {
                format!("detach source {source_id} from node {node_id}")
            }
            Self::DetachSourceChunk { node_id, chunk_id } => {
                format!("detach source chunk {chunk_id} from node {node_id}")
            }
            Self::UnciteSourceChunk { node_id, chunk_id } => {
                format!("remove cited source chunk {chunk_id} from node {node_id}")
            }
        }
    }

    fn body_is_set(&self) -> bool {
        matches!(self, Self::UpdateNode { body: Some(_), .. })
    }

    fn with_remapped_node_ids(self, node_id_map: &HashMap<String, String>) -> Self {
        let remap = |value: String| node_id_map.get(&value).cloned().unwrap_or(value);

        match self {
            Self::AddNode {
                id,
                parent_id,
                title,
                kind,
                body,
                position,
            } => Self::AddNode {
                id: id.map(remap),
                parent_id: remap(parent_id),
                title,
                kind,
                body,
                position,
            },
            Self::UpdateNode {
                id,
                title,
                body,
                kind,
            } => Self::UpdateNode {
                id: remap(id),
                title,
                body,
                kind,
            },
            Self::MoveNode {
                id,
                parent_id,
                position,
            } => Self::MoveNode {
                id: remap(id),
                parent_id: remap(parent_id),
                position,
            },
            Self::DeleteNode { id } => Self::DeleteNode { id: remap(id) },
            Self::AttachSource { node_id, source_id } => Self::AttachSource {
                node_id: remap(node_id),
                source_id,
            },
            Self::AttachSourceChunk { node_id, chunk_id } => Self::AttachSourceChunk {
                node_id: remap(node_id),
                chunk_id,
            },
            Self::CiteSourceChunk {
                node_id,
                chunk_id,
                citation_kind,
                rationale,
            } => Self::CiteSourceChunk {
                node_id: remap(node_id),
                chunk_id,
                citation_kind,
                rationale,
            },
            Self::DetachSource { node_id, source_id } => Self::DetachSource {
                node_id: remap(node_id),
                source_id,
            },
            Self::DetachSourceChunk { node_id, chunk_id } => Self::DetachSourceChunk {
                node_id: remap(node_id),
                chunk_id,
            },
            Self::UnciteSourceChunk { node_id, chunk_id } => Self::UnciteSourceChunk {
                node_id: remap(node_id),
                chunk_id,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replayable_patch_remaps_added_node_ids_and_internal_references() {
        let patch = PatchDocument {
            version: 1,
            summary: Some("Replay me".to_string()),
            ops: vec![
                PatchOp::AddNode {
                    id: Some("node-a".to_string()),
                    parent_id: "root".to_string(),
                    title: "A".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::AddNode {
                    id: Some("node-b".to_string()),
                    parent_id: "node-a".to_string(),
                    title: "B".to_string(),
                    kind: Some("topic".to_string()),
                    body: None,
                    position: None,
                },
                PatchOp::MoveNode {
                    id: "node-b".to_string(),
                    parent_id: "node-a".to_string(),
                    position: None,
                },
                PatchOp::UpdateNode {
                    id: "node-a".to_string(),
                    title: Some("A2".to_string()),
                    body: None,
                    kind: None,
                },
            ],
        };

        let replay = patch.replayable();

        let new_a = match &replay.ops[0] {
            PatchOp::AddNode { id: Some(id), .. } => id.clone(),
            other => panic!("unexpected op: {other:?}"),
        };
        let new_b = match &replay.ops[1] {
            PatchOp::AddNode {
                id: Some(id),
                parent_id,
                ..
            } => {
                assert_eq!(parent_id, &new_a);
                id.clone()
            }
            other => panic!("unexpected op: {other:?}"),
        };

        assert_ne!(new_a, "node-a");
        assert_ne!(new_b, "node-b");

        match &replay.ops[2] {
            PatchOp::MoveNode { id, parent_id, .. } => {
                assert_eq!(id, &new_b);
                assert_eq!(parent_id, &new_a);
            }
            other => panic!("unexpected op: {other:?}"),
        }

        match &replay.ops[3] {
            PatchOp::UpdateNode { id, .. } => {
                assert_eq!(id, &new_a);
            }
            other => panic!("unexpected op: {other:?}"),
        }
    }
}
