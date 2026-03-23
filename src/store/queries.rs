use super::*;

impl Workspace {
    pub fn workspace_name(&self) -> Result<String> {
        self.metadata_value("workspace_name")?
            .context("workspace_name metadata is missing")
    }

    pub fn list_nodes(&self) -> Result<Vec<Node>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_id, title, body, kind, position, created_at, updated_at
             FROM nodes
             ORDER BY parent_id IS NOT NULL, parent_id, position, id",
        )?;
        let rows = stmt.query_map([], read_node)?;
        let mut nodes = Vec::new();
        for node in rows {
            nodes.push(node?);
        }
        Ok(nodes)
    }

    pub fn tree(&self) -> Result<TreeNode> {
        let nodes = self.list_nodes()?;
        let root_id = self.root_id()?;
        build_tree(&root_id, nodes)
    }

    pub fn tree_string(&self) -> Result<String> {
        let tree = self.tree()?;
        let mut output = String::new();
        render_tree(&tree, 0, &mut output);
        Ok(output)
    }

    pub fn tree_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(&self.tree()?)?)
    }

    pub fn node_detail(&self, node_id: &str) -> Result<NodeDetail> {
        let node = self
            .node_by_id(node_id)?
            .with_context(|| format!("node {node_id} was not found"))?;
        let parent = match node.parent_id.as_deref() {
            Some(parent_id) => self.node_summary_by_id(parent_id)?,
            None => None,
        };
        let children = self.child_summaries(node_id)?;
        let sources = self.sources_for_node(node_id)?;
        Ok(NodeDetail {
            node,
            parent,
            children,
            sources,
        })
    }

    pub fn list_sources(&self) -> Result<Vec<SourceRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, original_path, original_name, stored_name, format, imported_at
             FROM sources
             ORDER BY imported_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SourceRecord {
                id: row.get(0)?,
                original_path: row.get(1)?,
                original_name: row.get(2)?,
                stored_name: row.get(3)?,
                format: row.get(4)?,
                imported_at: row.get(5)?,
            })
        })?;

        let mut sources = Vec::new();
        for source in rows {
            sources.push(source?);
        }
        Ok(sources)
    }

    pub fn source_detail(&self, source_id: &str) -> Result<SourceDetail> {
        let source = self
            .source_by_id(source_id)?
            .with_context(|| format!("source {source_id} was not found"))?;
        let chunks = self.source_chunks_for_source(source_id)?;
        let mut chunk_details = Vec::with_capacity(chunks.len());
        for chunk in chunks {
            let linked_nodes = self.nodes_for_chunk(&chunk.id)?;
            chunk_details.push(SourceChunkDetail {
                chunk,
                linked_nodes,
            });
        }
        Ok(SourceDetail {
            source,
            chunks: chunk_details,
        })
    }

    pub fn export_outline(&self) -> Result<String> {
        let tree = self.tree()?;
        let mut output = String::new();
        render_outline(&tree, 0, &mut output);
        Ok(output)
    }

    pub fn write_outline(&self, output: Option<&Path>) -> Result<std::path::PathBuf> {
        let outline = self.export_outline()?;
        let target = match output {
            Some(path) => {
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    self.paths.root_dir.join(path)
                }
            }
            None => self
                .paths
                .exports_dir
                .join(format!("outline-{}.md", timestamp_now())),
        };

        if let Some(parent) = target.parent().filter(|path| !path.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        std::fs::write(&target, outline)
            .with_context(|| format!("failed to write {}", target.display()))?;
        Ok(target)
    }

    pub(super) fn all_metadata(&self) -> Result<BTreeMap<String, String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM metadata ORDER BY key")?;
        let rows = stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })?;

        let mut metadata = BTreeMap::new();
        for row in rows {
            let (key, value) = row?;
            metadata.insert(key, value);
        }
        Ok(metadata)
    }

    pub(super) fn list_node_sources(&self) -> Result<Vec<NodeSourceRecord>> {
        let mut stmt = self
            .conn
            .prepare("SELECT node_id, source_id FROM node_sources ORDER BY source_id, node_id")?;
        let rows = stmt.query_map([], |row| {
            Ok(NodeSourceRecord {
                node_id: row.get(0)?,
                source_id: row.get(1)?,
            })
        })?;

        let mut node_sources = Vec::new();
        for node_source in rows {
            node_sources.push(node_source?);
        }
        Ok(node_sources)
    }

    pub(super) fn node_by_id(&self, node_id: &str) -> Result<Option<Node>> {
        self.conn
            .query_row(
                "SELECT id, parent_id, title, body, kind, position, created_at, updated_at
                 FROM nodes
                 WHERE id = ?1",
                [node_id],
                read_node,
            )
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn node_summary_by_id(&self, node_id: &str) -> Result<Option<NodeSummary>> {
        self.conn
            .query_row(
                "SELECT id, title FROM nodes WHERE id = ?1",
                [node_id],
                |row| {
                    Ok(NodeSummary {
                        id: row.get(0)?,
                        title: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn child_summaries(&self, node_id: &str) -> Result<Vec<NodeSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title
             FROM nodes
             WHERE parent_id = ?1
             ORDER BY position, id",
        )?;
        let rows = stmt.query_map([node_id], |row| {
            Ok(NodeSummary {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        })?;

        let mut children = Vec::new();
        for child in rows {
            children.push(child?);
        }
        Ok(children)
    }

    pub(super) fn source_by_id(&self, source_id: &str) -> Result<Option<SourceRecord>> {
        self.conn
            .query_row(
                "SELECT id, original_path, original_name, stored_name, format, imported_at
                 FROM sources
                 WHERE id = ?1",
                [source_id],
                |row| {
                    Ok(SourceRecord {
                        id: row.get(0)?,
                        original_path: row.get(1)?,
                        original_name: row.get(2)?,
                        stored_name: row.get(3)?,
                        format: row.get(4)?,
                        imported_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn list_source_chunks(&self) -> Result<Vec<SourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, ordinal, label, text, start_line, end_line
             FROM source_chunks
             ORDER BY source_id, ordinal, id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SourceChunkRecord {
                id: row.get(0)?,
                source_id: row.get(1)?,
                ordinal: row.get(2)?,
                label: row.get(3)?,
                text: row.get(4)?,
                start_line: row.get(5)?,
                end_line: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn source_chunks_for_source(
        &self,
        source_id: &str,
    ) -> Result<Vec<SourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, ordinal, label, text, start_line, end_line
             FROM source_chunks
             WHERE source_id = ?1
             ORDER BY ordinal, id",
        )?;
        let rows = stmt.query_map([source_id], |row| {
            Ok(SourceChunkRecord {
                id: row.get(0)?,
                source_id: row.get(1)?,
                ordinal: row.get(2)?,
                label: row.get(3)?,
                text: row.get(4)?,
                start_line: row.get(5)?,
                end_line: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn list_node_source_chunks(&self) -> Result<Vec<NodeSourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT node_id, chunk_id FROM node_source_chunks ORDER BY chunk_id, node_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NodeSourceChunkRecord {
                node_id: row.get(0)?,
                chunk_id: row.get(1)?,
            })
        })?;

        let mut chunk_links = Vec::new();
        for chunk_link in rows {
            chunk_links.push(chunk_link?);
        }
        Ok(chunk_links)
    }

    pub(super) fn nodes_for_chunk(&self, chunk_id: &str) -> Result<Vec<NodeSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT nodes.id, nodes.title
             FROM node_source_chunks
             JOIN nodes ON nodes.id = node_source_chunks.node_id
             WHERE node_source_chunks.chunk_id = ?1
             ORDER BY nodes.title, nodes.id",
        )?;
        let rows = stmt.query_map([chunk_id], |row| {
            Ok(NodeSummary {
                id: row.get(0)?,
                title: row.get(1)?,
            })
        })?;

        let mut nodes = Vec::new();
        for node in rows {
            nodes.push(node?);
        }
        Ok(nodes)
    }

    pub(super) fn sources_for_node(&self, node_id: &str) -> Result<Vec<NodeSourceDetail>> {
        let mut stmt = self.conn.prepare(
            "SELECT sources.id, sources.original_path, sources.original_name, sources.stored_name, sources.format, sources.imported_at
             FROM node_sources
             JOIN sources ON sources.id = node_sources.source_id
             WHERE node_sources.node_id = ?1
             ORDER BY sources.imported_at DESC, sources.id",
        )?;
        let rows = stmt.query_map([node_id], |row| {
            Ok(SourceRecord {
                id: row.get(0)?,
                original_path: row.get(1)?,
                original_name: row.get(2)?,
                stored_name: row.get(3)?,
                format: row.get(4)?,
                imported_at: row.get(5)?,
            })
        })?;

        let mut sources = Vec::new();
        for source in rows {
            let source = source?;
            let chunks = self.chunks_for_node_and_source(node_id, &source.id)?;
            sources.push(NodeSourceDetail { source, chunks });
        }
        Ok(sources)
    }

    pub(super) fn chunks_for_node_and_source(
        &self,
        node_id: &str,
        source_id: &str,
    ) -> Result<Vec<SourceChunkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_chunks.id, source_chunks.source_id, source_chunks.ordinal, source_chunks.label, source_chunks.text, source_chunks.start_line, source_chunks.end_line
             FROM node_source_chunks
             JOIN source_chunks ON source_chunks.id = node_source_chunks.chunk_id
             WHERE node_source_chunks.node_id = ?1 AND source_chunks.source_id = ?2
             ORDER BY source_chunks.ordinal, source_chunks.id",
        )?;
        let rows = stmt.query_map(params![node_id, source_id], |row| {
            Ok(SourceChunkRecord {
                id: row.get(0)?,
                source_id: row.get(1)?,
                ordinal: row.get(2)?,
                label: row.get(3)?,
                text: row.get(4)?,
                start_line: row.get(5)?,
                end_line: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for chunk in rows {
            chunks.push(chunk?);
        }
        Ok(chunks)
    }

    pub(super) fn set_metadata(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub(super) fn metadata_value(&self, key: &str) -> Result<Option<String>> {
        let value = self
            .conn
            .query_row("SELECT value FROM metadata WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value)
    }

    pub(super) fn root_id(&self) -> Result<String> {
        self.metadata_value("root_id")?
            .context("root_id metadata is missing")
    }
}

pub(super) fn read_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        kind: row.get(4)?,
        position: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn build_tree(root_id: &str, nodes: Vec<Node>) -> Result<TreeNode> {
    let mut nodes_by_id = HashMap::new();
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();

    for node in nodes {
        if let Some(parent_id) = node.parent_id.clone() {
            children_by_parent
                .entry(parent_id)
                .or_default()
                .push(node.id.clone());
        }
        nodes_by_id.insert(node.id.clone(), node);
    }

    fn build_subtree(
        node_id: &str,
        nodes_by_id: &HashMap<String, Node>,
        children_by_parent: &HashMap<String, Vec<String>>,
    ) -> Result<TreeNode> {
        let node = nodes_by_id
            .get(node_id)
            .with_context(|| format!("node {node_id} was not found while building the tree"))?
            .clone();
        let mut children = Vec::new();
        if let Some(child_ids) = children_by_parent.get(node_id) {
            for child_id in child_ids {
                children.push(build_subtree(child_id, nodes_by_id, children_by_parent)?);
            }
        }
        Ok(TreeNode { node, children })
    }

    build_subtree(root_id, &nodes_by_id, &children_by_parent)
}

fn render_tree(node: &TreeNode, depth: usize, output: &mut String) {
    let indent = "  ".repeat(depth);
    output.push_str(&format!(
        "{indent}- {} [{}]\n",
        node.node.title, node.node.id
    ));
    for child in &node.children {
        render_tree(child, depth + 1, output);
    }
}

fn render_outline(node: &TreeNode, depth: usize, output: &mut String) {
    let indent = "  ".repeat(depth);
    match &node.node.body {
        Some(body) if !body.is_empty() => {
            output.push_str(&format!("{indent}- {}: {}\n", node.node.title, body))
        }
        _ => output.push_str(&format!("{indent}- {}\n", node.node.title)),
    }
    for child in &node.children {
        render_outline(child, depth + 1, output);
    }
}
