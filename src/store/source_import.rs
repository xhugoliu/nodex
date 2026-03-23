use super::patching::{
    PatchValidationContext, apply_patch_ops_tx, insert_patch_run_tx, write_patch_archive,
};
use super::*;

impl Workspace {
    pub fn import_source(&mut self, source_path: &Path) -> Result<SourceImportReport> {
        let prepared = self.prepare_source_import(source_path)?;
        let stored_path = self.paths.sources_dir.join(&prepared.stored_name);
        std::fs::copy(&prepared.source_path, &stored_path).with_context(|| {
            format!(
                "failed to copy source file from {} to {}",
                prepared.source_path.display(),
                stored_path.display()
            )
        })?;

        let archive = match write_patch_archive(&self.paths, &prepared.patch) {
            Ok(archive) => archive,
            Err(err) => {
                let _ = std::fs::remove_file(&stored_path);
                return Err(err);
            }
        };
        let imported_at = timestamp_now();
        let transaction = self.conn.transaction()?;
        let import_result = (|| -> Result<()> {
            transaction.execute(
                "INSERT INTO sources (id, original_path, original_name, stored_name, format, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    prepared.source_id,
                    prepared.source_path.display().to_string(),
                    prepared.original_name,
                    prepared.stored_name,
                    prepared.format,
                    imported_at
                ],
            )?;

            insert_source_chunks_tx(
                &transaction,
                &prepared.source_id,
                &prepared.chunk_ids,
                &prepared.chunks,
            )?;
            apply_patch_ops_tx(&transaction, &prepared.patch.ops)?;
            insert_patch_run_tx(
                &transaction,
                &archive,
                prepared.patch.summary.as_ref(),
                "source_import",
            )?;
            Ok(())
        })();

        match import_result {
            Ok(()) => {
                if let Err(err) = transaction.commit() {
                    let _ = std::fs::remove_file(&stored_path);
                    let _ = std::fs::remove_file(&archive.run_path);
                    return Err(err.into());
                }
                Ok(SourceImportReport {
                    source_id: prepared.source_id,
                    original_name: prepared.original_name,
                    stored_name: prepared.stored_name,
                    root_node_id: prepared.root_node_id,
                    root_title: prepared.root_title,
                    node_count: prepared.node_count,
                    chunk_count: prepared.chunk_count,
                })
            }
            Err(err) => {
                let _ = std::fs::remove_file(&stored_path);
                let _ = std::fs::remove_file(&archive.run_path);
                Err(err)
            }
        }
    }

    pub fn preview_source_import(&self, source_path: &Path) -> Result<SourceImportPreview> {
        let prepared = self.prepare_source_import(source_path)?;
        Ok(SourceImportPreview {
            report: SourceImportReport {
                source_id: prepared.source_id,
                original_name: prepared.original_name,
                stored_name: prepared.stored_name,
                root_node_id: prepared.root_node_id,
                root_title: prepared.root_title,
                node_count: prepared.node_count,
                chunk_count: prepared.chunk_count,
            },
            patch: prepared.patch,
        })
    }

    fn prepare_source_import(&self, source_path: &Path) -> Result<PreparedSourceImport> {
        let source_path = source_path
            .canonicalize()
            .with_context(|| format!("failed to resolve source file {}", source_path.display()))?;
        if !source_path.is_file() {
            bail!("{} is not a file", source_path.display());
        }

        let import_plan = load_source_plan(&source_path)?;
        let original_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .context("source file name is missing or invalid unicode")?
            .to_string();
        let root_parent_id = self.root_id()?;
        let source_id = Uuid::new_v4().to_string();
        let import_patch =
            build_source_import_patch(&root_parent_id, &original_name, &source_id, &import_plan)?;
        let patch = self.prepare_patch_document_with_context(
            import_patch.patch,
            import_patch.validation_context,
        )?;
        let root_title = import_plan.root.title.clone();
        let format = import_plan.format;
        let chunks = import_plan.chunks;
        let chunk_count = import_patch.chunk_ids.len();

        Ok(PreparedSourceImport {
            source_path: source_path.clone(),
            format,
            chunks,
            source_id: source_id.clone(),
            original_name,
            stored_name: build_stored_source_name(&source_id, &source_path),
            root_node_id: import_patch.root_node_id,
            root_title,
            node_count: import_patch.node_count,
            chunk_count,
            patch,
            chunk_ids: import_patch.chunk_ids,
        })
    }
}

struct SourceImportPatch {
    patch: PatchDocument,
    root_node_id: String,
    node_count: usize,
    chunk_ids: Vec<String>,
    validation_context: PatchValidationContext,
}

struct PreparedSourceImport {
    source_path: PathBuf,
    format: String,
    chunks: Vec<SourceChunkDraft>,
    source_id: String,
    original_name: String,
    stored_name: String,
    root_node_id: String,
    root_title: String,
    node_count: usize,
    chunk_count: usize,
    patch: PatchDocument,
    chunk_ids: Vec<String>,
}

fn insert_source_chunks_tx(
    transaction: &Transaction<'_>,
    source_id: &str,
    chunk_ids: &[String],
    chunks: &[SourceChunkDraft],
) -> Result<()> {
    if chunk_ids.len() != chunks.len() {
        bail!(
            "source import generated {} chunk ids for {} chunks",
            chunk_ids.len(),
            chunks.len()
        );
    }
    for (ordinal, chunk) in chunks.iter().enumerate() {
        let chunk_id = chunk_ids
            .get(ordinal)
            .context("chunk id was missing while importing source")?;
        transaction.execute(
            "INSERT INTO source_chunks (id, source_id, ordinal, label, text, start_line, end_line)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                chunk_id,
                source_id,
                ordinal as i64,
                chunk.label,
                chunk.text,
                chunk.start_line as i64,
                chunk.end_line as i64
            ],
        )?;
    }
    Ok(())
}

fn build_source_import_patch(
    root_parent_id: &str,
    original_name: &str,
    source_id: &str,
    import_plan: &crate::source::SourceImportPlan,
) -> Result<SourceImportPatch> {
    let chunk_ids = import_plan
        .chunks
        .iter()
        .map(|_| Uuid::new_v4().to_string())
        .collect::<Vec<_>>();

    fn visit_imported_node(
        node: &ImportedNode,
        parent_id: &str,
        source_id: &str,
        chunk_ids: &[String],
        ops: &mut Vec<PatchOp>,
        node_count: &mut usize,
    ) -> Result<String> {
        let node_id = Uuid::new_v4().to_string();
        ops.push(PatchOp::AddNode {
            id: Some(node_id.clone()),
            parent_id: parent_id.to_string(),
            title: node.title.clone(),
            kind: Some(node.kind.clone()),
            body: node.body.clone(),
            position: None,
        });
        ops.push(PatchOp::AttachSource {
            node_id: node_id.clone(),
            source_id: source_id.to_string(),
        });
        for chunk_index in &node.chunk_indexes {
            let chunk_id = chunk_ids.get(*chunk_index).with_context(|| {
                format!(
                    "chunk index {} was not found while building source import patch",
                    chunk_index
                )
            })?;
            ops.push(PatchOp::AttachSourceChunk {
                node_id: node_id.clone(),
                chunk_id: chunk_id.clone(),
            });
        }
        *node_count += 1;
        for child in &node.children {
            visit_imported_node(child, &node_id, source_id, chunk_ids, ops, node_count)?;
        }
        Ok(node_id)
    }

    let mut ops = Vec::new();
    let mut node_count = 0usize;
    let root_node_id = visit_imported_node(
        &import_plan.root,
        root_parent_id,
        source_id,
        &chunk_ids,
        &mut ops,
        &mut node_count,
    )?;

    let validation_context = PatchValidationContext {
        source_ids: std::iter::once(source_id.to_string()).collect(),
        chunk_source_ids: chunk_ids
            .iter()
            .cloned()
            .map(|chunk_id| (chunk_id, source_id.to_string()))
            .collect(),
    };

    Ok(SourceImportPatch {
        patch: PatchDocument {
            version: 1,
            summary: Some(format!("Import source \"{original_name}\"")),
            ops,
        },
        root_node_id,
        node_count,
        chunk_ids,
        validation_context,
    })
}

fn build_stored_source_name(source_id: &str, source_path: &Path) -> String {
    match source_path.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => {
            format!("{source_id}.{}", extension.to_ascii_lowercase())
        }
        _ => source_id.to_string(),
    }
}
