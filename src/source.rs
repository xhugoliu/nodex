use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone)]
pub struct SourceImportPlan {
    pub format: String,
    pub root: ImportedNode,
    pub chunks: Vec<SourceChunkDraft>,
}

#[derive(Debug, Clone)]
pub struct ImportedNode {
    pub title: String,
    pub body: Option<String>,
    pub kind: String,
    pub chunk_indexes: Vec<usize>,
    pub children: Vec<ImportedNode>,
}

#[derive(Debug, Clone)]
pub struct SourceChunkDraft {
    pub label: Option<String>,
    pub text: String,
    pub start_line: usize,
    pub end_line: usize,
}

pub fn load_source_plan(path: &Path) -> Result<SourceImportPlan> {
    let source_text = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read source file {}", path.display()))?;
    let source_text = source_text.trim_start_matches('\u{feff}').to_string();
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported Source");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "md" | "markdown" => parse_markdown(file_stem, &source_text),
        "txt" | "text" => Ok(parse_text(file_stem, &source_text)),
        _ => bail!(
            "unsupported source format for {}; only .md and .txt are supported right now",
            path.display()
        ),
    }
}

#[derive(Debug, Clone)]
struct ParsedSection {
    title: String,
    body_lines: Vec<(usize, String)>,
    parent: Option<usize>,
}

#[derive(Debug, Clone)]
struct ParagraphDraft {
    text: String,
    start_line: usize,
    end_line: usize,
}

#[derive(Debug, Clone)]
struct BodyChunk {
    text: String,
    start_line: usize,
    end_line: usize,
}

fn parse_markdown(file_stem: &str, text: &str) -> Result<SourceImportPlan> {
    let mut sections = vec![ParsedSection {
        title: file_stem.to_string(),
        body_lines: Vec::new(),
        parent: None,
    }];
    let mut stack = vec![(0usize, 0usize)];
    let mut root_title_from_h1 = false;

    for (line_index, raw_line) in text.lines().enumerate() {
        let line_number = line_index + 1;
        let line = raw_line.trim_end();
        if let Some((level, title)) = parse_heading(line) {
            if !root_title_from_h1
                && level == 1
                && sections.len() == 1
                && normalized_body(&sections[0].body_lines).is_none()
            {
                sections[0].title = title.to_string();
                root_title_from_h1 = true;
                continue;
            }

            let effective_level = if root_title_from_h1 {
                level.saturating_sub(1).max(1)
            } else {
                level
            };

            while stack
                .last()
                .map(|(stack_level, _)| *stack_level >= effective_level)
                .unwrap_or(false)
            {
                stack.pop();
            }

            let parent_index = stack.last().map(|(_, index)| *index).unwrap_or(0);
            let section_index = sections.len();
            sections.push(ParsedSection {
                title: title.to_string(),
                body_lines: Vec::new(),
                parent: Some(parent_index),
            });
            stack.push((effective_level, section_index));
        } else {
            let current_index = stack.last().map(|(_, index)| *index).unwrap_or(0);
            sections[current_index]
                .body_lines
                .push((line_number, line.to_string()));
        }
    }

    if sections.len() == 1 {
        let paragraphs = split_paragraphs(text);
        if paragraphs.len() > 1 {
            let mut chunks = Vec::new();
            let children = paragraphs
                .iter()
                .enumerate()
                .map(|(index, paragraph)| {
                    let chunk_index = push_chunk(
                        &mut chunks,
                        Some(derive_node_title("Section", &paragraph.text, index)),
                        paragraph.text.clone(),
                        paragraph.start_line,
                        paragraph.end_line,
                    );
                    ImportedNode {
                        title: derive_node_title("Section", &paragraph.text, index),
                        body: Some(paragraph.text.clone()),
                        kind: "topic".to_string(),
                        chunk_indexes: vec![chunk_index],
                        children: Vec::new(),
                    }
                })
                .collect();
            return Ok(SourceImportPlan {
                format: "markdown".to_string(),
                root: ImportedNode {
                    title: sections[0].title.clone(),
                    body: None,
                    kind: "source".to_string(),
                    chunk_indexes: Vec::new(),
                    children,
                },
                chunks,
            });
        }
    }

    build_import_tree(sections, "markdown")
}

fn parse_text(file_stem: &str, text: &str) -> SourceImportPlan {
    let paragraphs = split_paragraphs(text);
    if paragraphs.is_empty() {
        return SourceImportPlan {
            format: "text".to_string(),
            root: ImportedNode {
                title: file_stem.to_string(),
                body: None,
                kind: "source".to_string(),
                chunk_indexes: Vec::new(),
                children: Vec::new(),
            },
            chunks: Vec::new(),
        };
    }

    if paragraphs.len() == 1 {
        let paragraph = &paragraphs[0];
        let mut chunks = Vec::new();
        let chunk_index = push_chunk(
            &mut chunks,
            Some(file_stem.to_string()),
            paragraph.text.clone(),
            paragraph.start_line,
            paragraph.end_line,
        );
        return SourceImportPlan {
            format: "text".to_string(),
            root: ImportedNode {
                title: file_stem.to_string(),
                body: Some(paragraph.text.clone()),
                kind: "source".to_string(),
                chunk_indexes: vec![chunk_index],
                children: Vec::new(),
            },
            chunks,
        };
    }

    let mut chunks = Vec::new();
    let children = paragraphs
        .iter()
        .enumerate()
        .map(|(index, paragraph)| {
            let title = derive_node_title("Section", &paragraph.text, index);
            let chunk_index = push_chunk(
                &mut chunks,
                Some(title.clone()),
                paragraph.text.clone(),
                paragraph.start_line,
                paragraph.end_line,
            );
            ImportedNode {
                title,
                body: Some(paragraph.text.clone()),
                kind: "topic".to_string(),
                chunk_indexes: vec![chunk_index],
                children: Vec::new(),
            }
        })
        .collect();

    SourceImportPlan {
        format: "text".to_string(),
        root: ImportedNode {
            title: file_stem.to_string(),
            body: None,
            kind: "source".to_string(),
            chunk_indexes: Vec::new(),
            children,
        },
        chunks,
    }
}

fn parse_heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start();
    let hashes = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if hashes == 0 {
        return None;
    }
    let title = trimmed[hashes..].trim();
    if title.is_empty() {
        return None;
    }
    Some((hashes, title))
}

fn split_paragraphs(text: &str) -> Vec<ParagraphDraft> {
    let mut paragraphs = Vec::new();
    let mut current_lines = Vec::new();
    let mut current_start_line = None;

    for (line_index, raw_line) in text.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            if !current_lines.is_empty() {
                paragraphs.push(ParagraphDraft {
                    text: current_lines.join(" "),
                    start_line: current_start_line.unwrap_or(line_number),
                    end_line: line_number.saturating_sub(1),
                });
                current_lines.clear();
                current_start_line = None;
            }
            continue;
        }

        if current_start_line.is_none() {
            current_start_line = Some(line_number);
        }
        current_lines.push(trimmed.to_string());
    }

    if !current_lines.is_empty() {
        let end_line = text.lines().count().max(current_start_line.unwrap_or(1));
        paragraphs.push(ParagraphDraft {
            text: current_lines.join(" "),
            start_line: current_start_line.unwrap_or(1),
            end_line,
        });
    }

    paragraphs
}

fn normalized_body(body_lines: &[(usize, String)]) -> Option<BodyChunk> {
    let non_empty_lines = body_lines
        .iter()
        .filter_map(|(line_number, line)| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((*line_number, trimmed.to_string()))
            }
        })
        .collect::<Vec<_>>();

    let first = non_empty_lines.first()?;
    let last = non_empty_lines.last()?;
    let text = non_empty_lines
        .iter()
        .map(|(_, line)| line.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    Some(BodyChunk {
        text,
        start_line: first.0,
        end_line: last.0,
    })
}

fn derive_node_title(prefix: &str, text: &str, index: usize) -> String {
    let first_line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if first_line.is_empty() {
        return format!("{prefix} {}", index + 1);
    }

    let candidate = first_line.replace(['`', '*', '#'], "").trim().to_string();
    let mut title = candidate.chars().take(48).collect::<String>();
    if candidate.chars().count() > 48 {
        title.push_str("...");
    }
    if title.is_empty() {
        format!("{prefix} {}", index + 1)
    } else {
        title
    }
}

fn build_import_tree(sections: Vec<ParsedSection>, format: &str) -> Result<SourceImportPlan> {
    let mut children_by_parent: HashMap<usize, Vec<usize>> = HashMap::new();
    for (index, section) in sections.iter().enumerate().skip(1) {
        if let Some(parent_index) = section.parent {
            children_by_parent
                .entry(parent_index)
                .or_default()
                .push(index);
        }
    }

    fn build_node(
        index: usize,
        sections: &[ParsedSection],
        children_by_parent: &HashMap<usize, Vec<usize>>,
        kind: &str,
        chunks: &mut Vec<SourceChunkDraft>,
    ) -> ImportedNode {
        let body = normalized_body(&sections[index].body_lines);
        let chunk_indexes = body
            .as_ref()
            .map(|body| {
                vec![push_chunk(
                    chunks,
                    Some(sections[index].title.clone()),
                    body.text.clone(),
                    body.start_line,
                    body.end_line,
                )]
            })
            .unwrap_or_default();
        let children = children_by_parent
            .get(&index)
            .map(|indices| {
                indices
                    .iter()
                    .map(|child_index| {
                        build_node(*child_index, sections, children_by_parent, "topic", chunks)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        ImportedNode {
            title: sections[index].title.clone(),
            body: body.map(|body| body.text),
            kind: kind.to_string(),
            chunk_indexes,
            children,
        }
    }

    if sections.is_empty() {
        bail!("source parsing produced no sections");
    }

    let mut chunks = Vec::new();
    let root = build_node(0, &sections, &children_by_parent, "source", &mut chunks);
    Ok(SourceImportPlan {
        format: format.to_string(),
        root,
        chunks,
    })
}

fn push_chunk(
    chunks: &mut Vec<SourceChunkDraft>,
    label: Option<String>,
    text: String,
    start_line: usize,
    end_line: usize,
) -> usize {
    let chunk_index = chunks.len();
    chunks.push(SourceChunkDraft {
        label,
        text,
        start_line,
        end_line,
    });
    chunk_index
}
