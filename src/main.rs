mod cli;
mod model;
mod patch;
mod project;
mod source;
mod store;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;

use crate::cli::{
    Cli, Command, ExportCommand, ListFormat, NodeCommand, PatchCommand, SnapshotCommand,
    SourceCommand,
};
use crate::patch::PatchDocument;
use crate::store::{Workspace, format_timestamp};

fn main() -> Result<()> {
    let cli = Cli::parse();
    let cwd = std::env::current_dir().context("failed to read the current directory")?;

    match cli.command {
        Command::Init => {
            let workspace = Workspace::init_at(&cwd)?;
            println!(
                "Initialized Nodex workspace in {}",
                workspace.paths.data_dir.display()
            );
            println!("Root topic: {}", workspace.workspace_name()?);
            println!("Try: cargo run -- patch apply examples/expand-root.json --dry-run");
        }
        Command::Node { command } => {
            let mut workspace = Workspace::open_from(&cwd)?;
            match command {
                NodeCommand::Add {
                    title,
                    parent,
                    kind,
                    body,
                    position,
                } => {
                    let report = workspace.add_node(title, parent, kind, body, position)?;
                    print_patch_report(&report);
                }
                NodeCommand::Update {
                    id,
                    title,
                    body,
                    kind,
                } => {
                    let report = workspace.update_node(id, title, body, kind)?;
                    print_patch_report(&report);
                }
                NodeCommand::Move {
                    id,
                    parent,
                    position,
                } => {
                    let report = workspace.move_node(id, parent, position)?;
                    print_patch_report(&report);
                }
                NodeCommand::Delete { id } => {
                    let report = workspace.delete_node(id)?;
                    print_patch_report(&report);
                }
                NodeCommand::List { format } => match format {
                    ListFormat::Tree => print!("{}", workspace.tree_string()?),
                    ListFormat::Json => println!("{}", workspace.tree_json()?),
                },
            }
        }
        Command::Patch { command } => {
            let mut workspace = Workspace::open_from(&cwd)?;
            match command {
                PatchCommand::Inspect { path } => {
                    let patch = read_patch(&cwd, &path)?;
                    print_patch_preview(&patch);
                }
                PatchCommand::Apply { path, dry_run } => {
                    let patch = read_patch(&cwd, &path)?;
                    let report = workspace.apply_patch_document(patch, "file", dry_run)?;
                    if dry_run {
                        println!("Dry run succeeded.");
                    }
                    print_patch_report(&report);
                }
                PatchCommand::History => {
                    let history = workspace.patch_history()?;
                    if history.is_empty() {
                        println!("No patches have been applied yet.");
                    } else {
                        for entry in history {
                            let summary =
                                entry.summary.unwrap_or_else(|| "(no summary)".to_string());
                            println!(
                                "{}  {}  {}  {}",
                                entry.id,
                                format_timestamp(entry.applied_at),
                                entry.origin,
                                summary
                            );
                            println!("  file: {}", entry.file_name);
                        }
                    }
                }
            }
        }
        Command::Source { command } => {
            let mut workspace = Workspace::open_from(&cwd)?;
            match command {
                SourceCommand::Import { path } => {
                    let report = workspace.import_source(&resolve_path(&cwd, &path))?;
                    println!(
                        "Imported source {} as {}",
                        report.original_name, report.source_id
                    );
                    println!("stored file: {}", report.stored_name);
                    println!(
                        "generated root node: {} [{}]",
                        report.root_title, report.root_node_id
                    );
                    println!("generated nodes: {}", report.node_count);
                    println!("generated chunks: {}", report.chunk_count);
                }
                SourceCommand::List => {
                    let sources = workspace.list_sources()?;
                    if sources.is_empty() {
                        println!("No sources have been imported yet.");
                    } else {
                        for source in sources {
                            println!(
                                "{}  {}  {}  {}",
                                source.id,
                                format_timestamp(source.imported_at),
                                source.format,
                                source.original_name
                            );
                            println!("  file: {}", source.stored_name);
                        }
                    }
                }
                SourceCommand::Show { source_id } => {
                    let detail = workspace.source_detail(&source_id)?;
                    println!(
                        "Source: {} [{}]",
                        detail.source.original_name, detail.source.id
                    );
                    println!("format: {}", detail.source.format);
                    println!("imported: {}", format_timestamp(detail.source.imported_at));
                    println!("stored file: {}", detail.source.stored_name);
                    println!("original path: {}", detail.source.original_path);
                    println!("chunks: {}", detail.chunks.len());
                    for chunk_detail in detail.chunks {
                        let chunk = chunk_detail.chunk;
                        let label = chunk.label.as_deref().unwrap_or("(no label)");
                        println!(
                            "- chunk {} [{}-{}] {}",
                            chunk.ordinal + 1,
                            chunk.start_line,
                            chunk.end_line,
                            label
                        );
                        println!("  {}", chunk.text);
                        if chunk_detail.linked_nodes.is_empty() {
                            println!("  nodes: (none)");
                        } else {
                            let linked_nodes = chunk_detail
                                .linked_nodes
                                .into_iter()
                                .map(|node| format!("{} [{}]", node.title, node.id))
                                .collect::<Vec<_>>()
                                .join(", ");
                            println!("  nodes: {}", linked_nodes);
                        }
                    }
                }
            }
        }
        Command::Snapshot { command } => {
            let mut workspace = Workspace::open_from(&cwd)?;
            match command {
                SnapshotCommand::Save { label } => {
                    let snapshot = workspace.save_snapshot(label)?;
                    println!(
                        "Saved snapshot {} at {}",
                        snapshot.id,
                        format_timestamp(snapshot.created_at)
                    );
                    println!("file: {}", snapshot.file_name);
                }
                SnapshotCommand::List => {
                    let snapshots = workspace.list_snapshots()?;
                    if snapshots.is_empty() {
                        println!("No snapshots found.");
                    } else {
                        for snapshot in snapshots {
                            let label = snapshot
                                .label
                                .clone()
                                .unwrap_or_else(|| "(no label)".to_string());
                            println!(
                                "{}  {}  {}",
                                snapshot.id,
                                format_timestamp(snapshot.created_at),
                                label
                            );
                            println!("  file: {}", snapshot.file_name);
                        }
                    }
                }
                SnapshotCommand::Restore { snapshot_id } => {
                    workspace.restore_snapshot(&snapshot_id)?;
                    println!("Restored snapshot {snapshot_id}");
                }
            }
        }
        Command::Export { command } => {
            let workspace = Workspace::open_from(&cwd)?;
            match command {
                ExportCommand::Outline { output } => {
                    let path = workspace.write_outline(output.as_deref())?;
                    println!("Wrote outline to {}", path.display());
                }
            }
        }
    }

    Ok(())
}

fn read_patch(cwd: &std::path::Path, path: &PathBuf) -> Result<PatchDocument> {
    let absolute_path = resolve_path(cwd, path);
    let patch_json = std::fs::read_to_string(&absolute_path)
        .with_context(|| format!("failed to read {}", absolute_path.display()))?;
    let patch: PatchDocument = serde_json::from_str(&patch_json)
        .with_context(|| format!("failed to parse {}", absolute_path.display()))?;
    Ok(patch)
}

fn resolve_path(cwd: &std::path::Path, path: &PathBuf) -> PathBuf {
    if path.is_absolute() {
        path.clone()
    } else {
        cwd.join(path)
    }
}

fn print_patch_preview(patch: &PatchDocument) {
    if let Some(summary) = &patch.summary {
        println!("Summary: {summary}");
    }
    println!("Patch version: {}", patch.version);
    for line in patch.preview_lines() {
        println!("- {line}");
    }
}

fn print_patch_report(report: &crate::model::ApplyPatchReport) {
    if let Some(summary) = &report.summary {
        println!("Summary: {summary}");
    }
    for line in &report.preview {
        println!("- {line}");
    }
    if let Some(run_id) = &report.run_id {
        println!("Run id: {run_id}");
    }
}
