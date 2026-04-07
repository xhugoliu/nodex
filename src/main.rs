mod cli;

use std::path::PathBuf;
use std::process::{Command as ProcessCommand, Stdio};

use anyhow::{Context, Result};
use clap::Parser;
use nodex::{
    ai::{
        AiExpandPreview, AiPatchExplanation, AiPatchResponse, ExternalRunnerReport,
        derive_ai_metadata_path, parse_ai_patch_response, write_ai_json_document,
    },
    model::{
        AiRunArtifact, AiRunRecord, AiRunReplayReport, ApplyPatchReport, SourceImportPreview,
        SourceImportReport,
    },
    patch::PatchDocument,
    store::{Workspace, format_timestamp},
};
use serde::Serialize;

use crate::cli::{
    AiCapability, AiCommand, AiProvider, Cli, Command, ExportCommand, ListFormat, NodeCommand,
    OutputFormat, PatchCommand, SnapshotCommand, SourceCommand,
};

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
        Command::Ai { command } => match command {
            AiCommand::Doctor { provider, format } => {
                let output = run_provider_script(
                    provider_script_path("provider_doctor.py")?,
                    build_provider_doctor_args(provider, format),
                )?;
                print_provider_script_output(output, format)?;
            }
            AiCommand::Status { provider, format } => {
                let doctor_output = run_provider_script(
                    provider_script_path("provider_doctor.py")?,
                    build_provider_doctor_args(provider, OutputFormat::Json),
                )?;
                let doctor_json = parse_provider_script_json(&doctor_output)?;
                match format {
                    OutputFormat::Text => print_provider_status_text(&doctor_json),
                    OutputFormat::Json => print_json(&build_provider_status_json(&doctor_json)?)?,
                }
            }
            AiCommand::Providers { format } => {
                let doctor_output = run_provider_script(
                    provider_script_path("provider_doctor.py")?,
                    build_provider_doctor_args(None, OutputFormat::Json),
                )?;
                let doctor_json = parse_provider_script_json(&doctor_output)?;
                match format {
                    OutputFormat::Text => print_provider_status_text(&doctor_json),
                    OutputFormat::Json => print_json(&build_provider_status_json(&doctor_json)?)?,
                }
            }
            AiCommand::Smoke {
                provider,
                node_id,
                apply,
                keep_workspace,
                format,
                extra_args,
            } => {
                let output = run_provider_script(
                    provider_script_path("provider_smoke.py")?,
                    build_provider_smoke_args(
                        provider,
                        &node_id,
                        apply,
                        keep_workspace,
                        format,
                        &extra_args,
                    ),
                )?;
                print_provider_script_output(output, format)?;
            }
            AiCommand::Expand {
                node_id,
                dry_run,
                emit_request,
                emit_response_template,
                format,
            } => {
                let workspace = Workspace::open_from(&cwd)?;
                if !dry_run {
                    anyhow::bail!("real AI execution is not implemented yet; rerun with --dry-run");
                }
                let preview = workspace.preview_ai_expand(&node_id)?;
                write_ai_preview_exports(
                    &cwd,
                    &preview,
                    emit_request,
                    emit_response_template,
                    format,
                )?;
                match format {
                    OutputFormat::Text => print_ai_expand_preview(&preview),
                    OutputFormat::Json => print_json(&preview)?,
                }
            }
            AiCommand::Explore {
                node_id,
                by,
                dry_run,
                emit_request,
                emit_response_template,
                format,
            } => {
                let workspace = Workspace::open_from(&cwd)?;
                if !dry_run {
                    anyhow::bail!("real AI execution is not implemented yet; rerun with --dry-run");
                }
                let preview = workspace.preview_ai_explore(&node_id, by.as_str())?;
                write_ai_preview_exports(
                    &cwd,
                    &preview,
                    emit_request,
                    emit_response_template,
                    format,
                )?;
                match format {
                    OutputFormat::Text => print_ai_expand_preview(&preview),
                    OutputFormat::Json => print_json(&preview)?,
                }
            }
            AiCommand::ApplyResponse {
                path,
                dry_run,
                format,
            } => {
                let mut workspace = Workspace::open_from(&cwd)?;
                let response = read_ai_response(&cwd, &path)?;
                let report = workspace.apply_ai_patch_response(response.clone(), dry_run)?;
                match format {
                    OutputFormat::Text => {
                        println!(
                            "AI response: {} for node {}",
                            response.capability, response.request_node_id
                        );
                        println!("provider: {}", response.generator.provider);
                        if let Some(model) = &response.generator.model {
                            println!("model: {model}");
                        }
                        if dry_run {
                            println!("Dry run succeeded.");
                        }
                        print_ai_patch_explanation(&response.explanation);
                        if !response.notes.is_empty() {
                            println!("[notes]");
                            for note in &response.notes {
                                println!("- {note}");
                            }
                        }
                        print_patch_report(&report);
                    }
                    OutputFormat::Json => print_json(&AiResponseApplyOutput {
                        response,
                        report,
                        dry_run,
                    })?,
                }
            }
            AiCommand::History { node_id, format } => {
                let workspace = Workspace::open_from(&cwd)?;
                let history = workspace.ai_run_history(node_id.as_deref())?;
                match format {
                    OutputFormat::Text => {
                        if history.is_empty() {
                            println!("No AI runs have been indexed yet.");
                        } else {
                            for entry in history {
                                print_ai_run_record(&entry);
                            }
                        }
                    }
                    OutputFormat::Json => print_json(&history)?,
                }
            }
            AiCommand::Show { run_id, format } => {
                let workspace = Workspace::open_from(&cwd)?;
                let output = load_ai_run_show_output(&workspace, &run_id)?;
                match format {
                    OutputFormat::Text => print_ai_run_show_output(&output),
                    OutputFormat::Json => print_json(&output)?,
                }
            }
            AiCommand::Artifact {
                run_id,
                kind,
                format,
            } => {
                let workspace = Workspace::open_from(&cwd)?;
                let artifact = workspace.ai_run_artifact(&run_id, kind.as_str())?;
                match format {
                    OutputFormat::Text => print_ai_run_artifact(&artifact),
                    OutputFormat::Json => print_json(&artifact)?,
                }
            }
            AiCommand::Patch { run_id, format } => {
                let workspace = Workspace::open_from(&cwd)?;
                let patch = workspace.ai_run_patch_document(&run_id)?;
                match format {
                    OutputFormat::Text => print_patch_preview(&patch),
                    OutputFormat::Json => print_json(&patch)?,
                }
            }
            AiCommand::Replay {
                run_id,
                dry_run,
                apply,
                format,
            } => {
                let mut workspace = Workspace::open_from(&cwd)?;
                let effective_dry_run = !apply || dry_run;
                let replay = workspace.replay_ai_run_patch(&run_id, effective_dry_run)?;
                match format {
                    OutputFormat::Text => print_ai_run_replay_report(&replay),
                    OutputFormat::Json => print_json(&replay)?,
                }
            }
            AiCommand::RunExternal {
                node_id,
                command,
                capability,
                by,
                dry_run,
                format,
            } => {
                let mut workspace = Workspace::open_from(&cwd)?;
                let runner_report = match capability {
                    AiCapability::Expand => {
                        if by.is_some() {
                            anyhow::bail!("`--by` is only valid when `--capability explore`");
                        }
                        workspace.run_external_ai_expand(&node_id, &command, dry_run)?
                    }
                    AiCapability::Explore => {
                        let by = by.context(
                            "`--capability explore` requires `--by risk|question|action|evidence`",
                        )?;
                        workspace.run_external_ai_explore(
                            &node_id,
                            by.as_str(),
                            &command,
                            dry_run,
                        )?
                    }
                };
                match format {
                    OutputFormat::Text => print_external_runner_report(&runner_report, dry_run),
                    OutputFormat::Json => print_json(&runner_report)?,
                }
            }
        },
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
                NodeCommand::CiteChunk {
                    id,
                    chunk_id,
                    citation_kind,
                    rationale,
                } => {
                    let report = workspace.cite_source_chunk(
                        id,
                        chunk_id,
                        citation_kind.as_str().to_string(),
                        rationale,
                    )?;
                    print_patch_report(&report);
                }
                NodeCommand::UnciteChunk { id, chunk_id } => {
                    let report = workspace.uncite_source_chunk(id, chunk_id)?;
                    print_patch_report(&report);
                }
                NodeCommand::Show { id, format } => match format {
                    OutputFormat::Text => {
                        let detail = workspace.node_detail(&id)?;
                        println!("Node: {} [{}]", detail.node.title, detail.node.id);
                        println!("kind: {}", detail.node.kind);
                        println!(
                            "parent: {}",
                            detail
                                .parent
                                .map(|node| format!("{} [{}]", node.title, node.id))
                                .unwrap_or_else(|| "(none)".to_string())
                        );
                        if let Some(body) = detail.node.body {
                            println!("body: {}", body);
                        } else {
                            println!("body: (none)");
                        }
                        if detail.children.is_empty() {
                            println!("children: (none)");
                        } else {
                            let children = detail
                                .children
                                .into_iter()
                                .map(|node| format!("{} [{}]", node.title, node.id))
                                .collect::<Vec<_>>()
                                .join(", ");
                            println!("children: {}", children);
                        }
                        if detail.sources.is_empty() {
                            println!("sources: (none)");
                        } else {
                            println!("sources: {}", detail.sources.len());
                            for source_detail in detail.sources {
                                println!(
                                    "- {} [{}]",
                                    source_detail.source.original_name, source_detail.source.id
                                );
                                if source_detail.chunks.is_empty() {
                                    println!("  chunks: (source-level link only)");
                                } else {
                                    for chunk in source_detail.chunks {
                                        let label = chunk.label.as_deref().unwrap_or("(no label)");
                                        println!(
                                            "  - chunk {} [{}-{}] {}",
                                            chunk.ordinal + 1,
                                            chunk.start_line,
                                            chunk.end_line,
                                            label
                                        );
                                        println!("    {}", chunk.text);
                                    }
                                }
                            }
                        }
                        if detail.evidence.is_empty() {
                            println!("evidence: (none)");
                        } else {
                            println!("evidence: {}", detail.evidence.len());
                            for evidence_detail in detail.evidence {
                                println!(
                                    "- {} [{}]",
                                    evidence_detail.source.original_name, evidence_detail.source.id
                                );
                                for citation in evidence_detail.citations {
                                    let chunk = citation.chunk;
                                    let label = chunk.label.as_deref().unwrap_or("(no label)");
                                    println!(
                                        "  - cite chunk {} [{}-{}] {} ({})",
                                        chunk.ordinal + 1,
                                        chunk.start_line,
                                        chunk.end_line,
                                        label,
                                        citation.citation_kind
                                    );
                                    if let Some(rationale) = citation.rationale {
                                        println!("    rationale: {}", rationale);
                                    }
                                    println!("    {}", chunk.text);
                                }
                            }
                        }
                    }
                    OutputFormat::Json => print_json(&workspace.node_detail(&id)?)?,
                },
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
                PatchCommand::History { format } => {
                    let history = workspace.patch_history()?;
                    match format {
                        OutputFormat::Text => {
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
                        OutputFormat::Json => print_json(&history)?,
                    }
                }
            }
        }
        Command::Source { command } => {
            let mut workspace = Workspace::open_from(&cwd)?;
            match command {
                SourceCommand::Import {
                    path,
                    dry_run,
                    emit_patch,
                } => {
                    let source_path = resolve_path(&cwd, &path);
                    if dry_run || emit_patch.is_some() {
                        let preview = workspace.preview_source_import(&source_path)?;
                        if let Some(patch_path) = emit_patch {
                            let patch_path = resolve_path(&cwd, &patch_path);
                            write_patch_document(&patch_path, &preview.patch)?;
                            println!("Wrote import patch preview to {}", patch_path.display());
                        }
                        if dry_run {
                            println!("Dry run succeeded.");
                        }
                        print_source_import_preview(&preview);
                    } else {
                        let report = workspace.import_source(&source_path)?;
                        print_source_import_report(&report);
                    }
                }
                SourceCommand::List { format } => {
                    let sources = workspace.list_sources()?;
                    match format {
                        OutputFormat::Text => {
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
                        OutputFormat::Json => print_json(&sources)?,
                    }
                }
                SourceCommand::Show { source_id, format } => match format {
                    OutputFormat::Text => {
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
                            if chunk_detail.evidence_nodes.is_empty() {
                                println!("  evidence nodes: (none)");
                            } else {
                                println!("  evidence nodes: {}", chunk_detail.evidence_nodes.len());
                                for evidence_link in chunk_detail.evidence_links {
                                    println!(
                                        "    - {} [{}] ({})",
                                        evidence_link.node.title,
                                        evidence_link.node.id,
                                        evidence_link.citation_kind
                                    );
                                    if let Some(rationale) = evidence_link.rationale {
                                        println!("      rationale: {}", rationale);
                                    }
                                }
                            }
                        }
                    }
                    OutputFormat::Json => print_json(&workspace.source_detail(&source_id)?)?,
                },
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
                SnapshotCommand::List { format } => {
                    let snapshots = workspace.list_snapshots()?;
                    match format {
                        OutputFormat::Text => {
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
                        OutputFormat::Json => print_json(&snapshots)?,
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

fn provider_script_path(script_name: &str) -> Result<PathBuf> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join(script_name);
    if !path.exists() {
        anyhow::bail!("provider script {} was not found", path.display());
    }
    Ok(path)
}

fn build_provider_doctor_args(provider: Option<AiProvider>, format: OutputFormat) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(provider) = provider {
        args.extend(["--provider".to_string(), provider.as_str().to_string()]);
    }
    if matches!(format, OutputFormat::Json) {
        args.push("--json".to_string());
    }
    args
}

fn build_provider_smoke_args(
    provider: AiProvider,
    node_id: &str,
    apply: bool,
    keep_workspace: bool,
    format: OutputFormat,
    extra_args: &[String],
) -> Vec<String> {
    let mut args = vec![
        "--provider".to_string(),
        provider.as_str().to_string(),
        "--node-id".to_string(),
        node_id.to_string(),
    ];
    if apply {
        args.push("--apply".to_string());
    }
    if keep_workspace {
        args.push("--keep-workspace".to_string());
    }
    if matches!(format, OutputFormat::Json) {
        args.push("--json".to_string());
    }
    args.extend(extra_args.iter().cloned());
    args
}

fn run_provider_script(script_path: PathBuf, args: Vec<String>) -> Result<std::process::Output> {
    let output = ProcessCommand::new("python3")
        .arg(script_path)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .context("failed to run provider helper script")?;
    if output.status.success() {
        return Ok(output);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!(
            "provider helper script exited with status {}",
            output.status.code().unwrap_or(-1)
        )
    };
    anyhow::bail!("{detail}");
}

fn print_provider_script_output(output: std::process::Output, format: OutputFormat) -> Result<()> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    match format {
        OutputFormat::Text => {
            if !stdout.is_empty() {
                println!("{stdout}");
            }
        }
        OutputFormat::Json => {
            let value: serde_json::Value = serde_json::from_str(&stdout)
                .context("provider helper did not return valid JSON")?;
            print_json(&value)?;
        }
    }
    Ok(())
}

fn parse_provider_script_json(output: &std::process::Output) -> Result<serde_json::Value> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str(&stdout).context("provider helper did not return valid JSON")
}

fn build_provider_status_json(doctor_json: &serde_json::Value) -> Result<serde_json::Value> {
    let root = doctor_json
        .as_object()
        .context("provider doctor JSON must be an object")?;
    let mut summaries = Vec::new();
    for (provider_name, payload) in root {
        let summary = payload
            .get("summary")
            .and_then(|value| value.as_object())
            .with_context(|| format!("provider {provider_name} is missing summary"))?;
        summaries.push(serde_json::json!({
            "provider": provider_name,
            "runnable": summary.get("runnable").and_then(|value| value.as_bool()).unwrap_or(false),
            "has_auth": summary.get("has_auth").and_then(|value| value.as_bool()).unwrap_or(false),
            "has_process_env_conflict": summary
                .get("has_process_env_conflict")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            "has_shell_env_conflict": summary
                .get("has_shell_env_conflict")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        }));
    }
    Ok(serde_json::Value::Array(summaries))
}

fn print_provider_status_text(doctor_json: &serde_json::Value) {
    let Some(root) = doctor_json.as_object() else {
        println!("Provider doctor output was not an object.");
        return;
    };

    for (provider_name, payload) in root {
        let summary = payload.get("summary").and_then(|value| value.as_object());
        let runnable = summary
            .and_then(|summary| summary.get("runnable"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let has_auth = summary
            .and_then(|summary| summary.get("has_auth"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let process_conflict = summary
            .and_then(|summary| summary.get("has_process_env_conflict"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let shell_conflict = summary
            .and_then(|summary| summary.get("has_shell_env_conflict"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);

        let model = payload
            .get("model")
            .and_then(|value| value.as_str())
            .unwrap_or("(unset)");
        let base_url = payload
            .get("base_url")
            .and_then(|value| value.as_str())
            .unwrap_or("(unset)");

        println!(
            "{}  runnable={}  auth={}  process_env_conflict={}  shell_env_conflict={}",
            provider_name, runnable, has_auth, process_conflict, shell_conflict
        );
        println!("  model: {}", model);
        println!("  base_url: {}", base_url);
    }
}

fn read_patch(cwd: &std::path::Path, path: &PathBuf) -> Result<PatchDocument> {
    let absolute_path = resolve_path(cwd, path);
    let patch_json = std::fs::read_to_string(&absolute_path)
        .with_context(|| format!("failed to read {}", absolute_path.display()))?;
    let patch: PatchDocument = serde_json::from_str(&patch_json)
        .with_context(|| format!("failed to parse {}", absolute_path.display()))?;
    Ok(patch)
}

fn read_ai_response(cwd: &std::path::Path, path: &PathBuf) -> Result<AiPatchResponse> {
    let absolute_path = resolve_path(cwd, path);
    let response_json = std::fs::read_to_string(&absolute_path)
        .with_context(|| format!("failed to read {}", absolute_path.display()))?;
    parse_ai_patch_response(&response_json)
        .with_context(|| format!("failed to parse {}", absolute_path.display()))
}

fn write_ai_preview_exports(
    cwd: &std::path::Path,
    preview: &AiExpandPreview,
    emit_request: Option<PathBuf>,
    emit_response_template: Option<PathBuf>,
    format: OutputFormat,
) -> Result<()> {
    if let Some(request_path) = emit_request {
        let request_path = resolve_path(cwd, &request_path);
        write_ai_json_document(&request_path, &preview.request)?;
        if matches!(format, OutputFormat::Text) {
            println!("Wrote AI request to {}", request_path.display());
        }
    }
    if let Some(template_path) = emit_response_template {
        let template_path = resolve_path(cwd, &template_path);
        write_ai_json_document(&template_path, &preview.response_template)?;
        if matches!(format, OutputFormat::Text) {
            println!("Wrote AI response template to {}", template_path.display());
        }
    }
    Ok(())
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

fn print_patch_report(report: &ApplyPatchReport) {
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

fn print_source_import_report(report: &SourceImportReport) {
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

fn print_source_import_preview(preview: &SourceImportPreview) {
    println!(
        "Planned source import {} as {}",
        preview.report.original_name, preview.report.source_id
    );
    println!("planned stored file: {}", preview.report.stored_name);
    println!(
        "planned root node: {} [{}]",
        preview.report.root_title, preview.report.root_node_id
    );
    println!("planned nodes: {}", preview.report.node_count);
    println!("planned chunks: {}", preview.report.chunk_count);
    print_patch_preview(&preview.patch);
}

fn print_ai_expand_preview(preview: &AiExpandPreview) {
    println!(
        "AI dry run: {} for {} [{}]",
        preview.capability, preview.target_node.title, preview.target_node.id
    );
    println!("workspace: {}", preview.workspace_name);
    println!("mode: {}", preview.mode);
    if let Some(explore_by) = &preview.explore_by {
        println!("explore by: {}", explore_by);
    }
    println!("kind: {}", preview.target_node.kind);
    println!(
        "children: {}",
        if preview.target_node.child_titles.is_empty() {
            "(none)".to_string()
        } else {
            preview.target_node.child_titles.join(", ")
        }
    );
    println!("linked sources: {}", preview.linked_sources.len());
    println!("cited evidence sources: {}", preview.cited_evidence.len());
    println!();
    println!("[system prompt]");
    println!("{}", preview.system_prompt);
    println!();
    println!("[user prompt]");
    println!("{}", preview.user_prompt);
    println!();
    println!("[draft patch]");
    print_patch_preview(&preview.draft_patch);
    println!();
    println!("[explanation scaffold]");
    print_ai_patch_explanation(&preview.response_template.explanation);
    println!();
    println!("[notes]");
    for note in &preview.notes {
        println!("- {note}");
    }
}

fn print_ai_patch_explanation(explanation: &AiPatchExplanation) {
    println!("rationale: {}", explanation.rationale_summary);
    if explanation.direct_evidence.is_empty() {
        println!("direct evidence: (none)");
    } else {
        println!("direct evidence: {}", explanation.direct_evidence.len());
        for item in &explanation.direct_evidence {
            let label = item.label.as_deref().unwrap_or("(no label)");
            println!(
                "- {} [{}-{}] {}",
                item.source_name, item.start_line, item.end_line, label
            );
            println!("  chunk: {}", item.chunk_id);
            println!("  why: {}", item.why_it_matters);
        }
    }
    if explanation.inferred_suggestions.is_empty() {
        println!("inferred suggestions: (none)");
    } else {
        println!(
            "inferred suggestions: {}",
            explanation.inferred_suggestions.len()
        );
        for item in &explanation.inferred_suggestions {
            println!("- {item}");
        }
    }
}

fn write_patch_document(path: &std::path::Path, patch: &PatchDocument) -> Result<()> {
    write_ai_json_document(path, patch)
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

#[derive(Debug, Serialize)]
struct AiResponseApplyOutput {
    response: AiPatchResponse,
    report: ApplyPatchReport,
    dry_run: bool,
}

#[derive(Debug, Serialize)]
struct AiRunShowOutput {
    record: AiRunRecord,
    metadata_path: Option<String>,
    explanation: Option<AiPatchExplanation>,
    patch: Option<PatchDocument>,
    response_notes: Vec<String>,
    load_notes: Vec<String>,
}

fn load_ai_run_show_output(workspace: &Workspace, run_id: &str) -> Result<AiRunShowOutput> {
    let record = workspace
        .ai_run_record_by_id(run_id)?
        .with_context(|| format!("AI run {run_id} was not found"))?;
    let metadata_path = derive_ai_metadata_path(&record.response_path);
    let mut explanation = None;
    let mut patch = workspace.ai_run_patch_document(run_id).ok();
    let mut response_notes = Vec::new();
    let mut load_notes = Vec::new();

    match std::fs::read_to_string(&record.response_path) {
        Ok(response_json) => match parse_ai_patch_response(&response_json) {
            Ok(response) => {
                explanation = Some(response.explanation);
                if patch.is_none() {
                    patch = Some(response.patch);
                }
                response_notes = response.notes;
            }
            Err(err) => {
                load_notes.push(format!(
                    "Failed to parse response artifact {}: {}",
                    record.response_path, err
                ));
            }
        },
        Err(err) => {
            load_notes.push(format!(
                "Response artifact is unavailable at {}: {}",
                record.response_path, err
            ));
        }
    }

    Ok(AiRunShowOutput {
        record,
        metadata_path,
        explanation,
        patch,
        response_notes,
        load_notes,
    })
}

fn print_ai_run_record(entry: &AiRunRecord) {
    let explore_by = entry
        .explore_by
        .as_deref()
        .map(|value| format!(" by {value}"))
        .unwrap_or_default();
    println!(
        "{}  {}  {}{}  {}  {}",
        entry.id,
        format_timestamp(entry.started_at),
        entry.capability,
        explore_by,
        entry.status,
        entry.node_id
    );
    println!("  command: {}", entry.command);
    println!(
        "  mode: {}",
        if entry.dry_run { "dry-run" } else { "apply" }
    );
    if let Some(provider) = &entry.provider {
        println!("  provider: {}", provider);
    }
    if let Some(model) = &entry.model {
        println!("  model: {}", model);
    }
    if let Some(provider_run_id) = &entry.provider_run_id {
        println!("  provider run: {}", provider_run_id);
    }
    println!("  retries: {}", entry.retry_count);
    if let Some(exit_code) = entry.exit_code {
        println!("  exit code: {}", exit_code);
    }
    if let Some(category) = &entry.last_error_category {
        println!("  error: {}", category);
    }
    if let Some(message) = &entry.last_error_message {
        println!("  detail: {}", message);
    }
    println!("  request: {}", entry.request_path);
    println!("  response: {}", entry.response_path);
    match derive_ai_metadata_path(&entry.response_path) {
        Some(metadata_path) => println!("  metadata: {}", metadata_path),
        None => println!("  metadata: (unavailable)"),
    }
    if let Some(summary) = &entry.patch_summary {
        println!("  patch summary: {}", summary);
    }
    if let Some(run_id) = &entry.patch_run_id {
        println!("  patch run: {}", run_id);
    }
}

fn print_ai_run_show_output(output: &AiRunShowOutput) {
    print_ai_run_record(&output.record);
    if let Some(explanation) = &output.explanation {
        println!();
        println!("[explanation]");
        print_ai_patch_explanation(explanation);
    }
    if let Some(patch) = &output.patch {
        println!();
        println!("[patch]");
        print_patch_preview(patch);
    }
    if !output.response_notes.is_empty() {
        println!();
        println!("[response notes]");
        for note in &output.response_notes {
            println!("- {note}");
        }
    }
    if !output.load_notes.is_empty() {
        println!();
        println!("[load notes]");
        for note in &output.load_notes {
            println!("- {note}");
        }
    }
}

fn print_ai_run_artifact(artifact: &AiRunArtifact) {
    println!("artifact: {}", artifact.kind);
    println!("path: {}", artifact.path);
    println!();
    println!("{}", artifact.content);
}

fn print_ai_run_replay_report(replay: &AiRunReplayReport) {
    println!("Replayed AI run {}.", replay.source_run.id);
    println!("mode: {}", if replay.dry_run { "dry-run" } else { "apply" });
    println!("patch source: {}", replay.patch_source);
    if let Some(source_patch_run_id) = &replay.source_patch_run_id {
        println!("source patch run: {}", source_patch_run_id);
    }
    println!("source node: {}", replay.source_run.node_id);
    println!("source status: {}", replay.source_run.status);
    print_patch_report(&replay.report);
}

fn print_external_runner_report(report: &ExternalRunnerReport, dry_run: bool) {
    println!("External AI runner completed.");
    println!("command: {}", report.command);
    println!("request: {}", report.request_path);
    println!("response: {}", report.response_path);
    println!("metadata: {}", report.metadata_path);
    println!("exit code: {}", report.exit_code);
    if let Some(provider) = &report.metadata.provider {
        println!("provider: {}", provider);
    }
    if let Some(model) = &report.metadata.model {
        println!("model: {}", model);
    }
    if let Some(run_id) = &report.metadata.provider_run_id {
        println!("provider run id: {}", run_id);
    }
    println!("retry count: {}", report.metadata.retry_count);
    print_ai_patch_explanation(&report.explanation);
    if !report.notes.is_empty() {
        println!("[notes]");
        for note in &report.notes {
            println!("- {note}");
        }
    }
    if dry_run {
        println!("Dry run succeeded.");
    }
    print_patch_report(&report.report);
}
