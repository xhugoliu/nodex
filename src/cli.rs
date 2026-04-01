use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "nodex",
    version,
    about = "Patch-first CLI for local AI mind maps"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Initialize a Nodex workspace in the current directory.
    Init,
    /// Prepare AI-assisted patch drafts.
    Ai {
        #[command(subcommand)]
        command: AiCommand,
    },
    /// Work with nodes through convenience commands backed by the patch engine.
    Node {
        #[command(subcommand)]
        command: NodeCommand,
    },
    /// Inspect and apply structured patch documents.
    Patch {
        #[command(subcommand)]
        command: PatchCommand,
    },
    /// Import and inspect source files.
    Source {
        #[command(subcommand)]
        command: SourceCommand,
    },
    /// Save, list, and restore snapshots.
    Snapshot {
        #[command(subcommand)]
        command: SnapshotCommand,
    },
    /// Export the current map as a Markdown outline.
    Export {
        #[command(subcommand)]
        command: ExportCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum NodeCommand {
    /// Add a child node under a parent node.
    Add {
        title: String,
        #[arg(long, default_value = "root")]
        parent: String,
        #[arg(long, default_value = "topic")]
        kind: String,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        position: Option<i64>,
    },
    /// Update a node.
    Update {
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        kind: Option<String>,
    },
    /// Move a node to a different parent.
    Move {
        id: String,
        #[arg(long)]
        parent: String,
        #[arg(long)]
        position: Option<i64>,
    },
    /// Delete a node and its descendants.
    Delete { id: String },
    /// Cite one source chunk as explicit evidence for a node.
    CiteChunk { id: String, chunk_id: String },
    /// Remove one explicit source chunk citation from a node.
    UnciteChunk { id: String, chunk_id: String },
    /// Show one node with parent, children, and linked sources.
    Show {
        id: String,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// List the current map.
    List {
        #[arg(long, value_enum, default_value_t = ListFormat::Tree)]
        format: ListFormat,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum ListFormat {
    Tree,
    Json,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Subcommand)]
pub enum AiCommand {
    /// Prepare a dry-run expand request for one node.
    Expand {
        node_id: String,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        emit_request: Option<PathBuf>,
        #[arg(long)]
        emit_response_template: Option<PathBuf>,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Validate and preview or apply one AI patch response file.
    ApplyResponse {
        path: PathBuf,
        #[arg(long)]
        dry_run: bool,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Export request, call one external command, and read back its response.
    RunExternal {
        node_id: String,
        command: String,
        #[arg(long)]
        dry_run: bool,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
}

#[derive(Debug, Subcommand)]
pub enum PatchCommand {
    /// Show a readable preview of a patch file.
    Inspect { path: PathBuf },
    /// Apply a patch file to the current workspace.
    Apply {
        path: PathBuf,
        #[arg(long)]
        dry_run: bool,
    },
    /// Show applied patch history.
    History {
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
}

#[derive(Debug, Subcommand)]
pub enum SourceCommand {
    /// Import a Markdown or text file into the current workspace.
    Import {
        path: PathBuf,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        emit_patch: Option<PathBuf>,
    },
    /// List imported source files.
    List {
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Show one imported source with chunks and linked nodes.
    Show {
        source_id: String,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
}

#[derive(Debug, Subcommand)]
pub enum SnapshotCommand {
    /// Save the current map as a snapshot.
    Save {
        #[arg(long)]
        label: Option<String>,
    },
    /// List saved snapshots.
    List {
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    /// Restore a snapshot.
    Restore { snapshot_id: String },
}

#[derive(Debug, Subcommand)]
pub enum ExportCommand {
    /// Export the current map as a Markdown outline.
    Outline {
        #[arg(long)]
        output: Option<PathBuf>,
    },
}
