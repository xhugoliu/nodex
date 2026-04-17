#!/usr/bin/env python3

import argparse
import json
import shlex
import sys
import tempfile
from pathlib import Path
from typing import Optional

from provider_registry import (
    get_provider_entry,
    load_provider_payload,
    runnable_provider_names,
)
from provider_smoke import run_smoke
from source_context_scenario import (
    DEFAULT_CITATION_RATIONALE,
    DEFAULT_FIXTURE_PATH,
    DEFAULT_TARGET_LABEL,
)

DEFAULT_DESKTOP_FLOW_PROVIDER = "openai"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run a regression smoke for the desktop primary flow "
            "(source-context target -> AI draft -> review -> apply/dry-run -> next focus candidate)."
        )
    )
    parser.add_argument(
        "--provider",
        choices=runnable_provider_names(),
        default=DEFAULT_DESKTOP_FLOW_PROVIDER,
        help="Provider preset to use when --runner-command is not set.",
    )
    parser.add_argument(
        "--runner-command",
        default=None,
        help=(
            "Explicit external runner command. "
            "When provided, provider preflight is skipped."
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the generated patch. Default is dry-run mode.",
    )
    parser.add_argument(
        "--fixture",
        default=None,
        help=(
            "Optional Markdown fixture path for source-context setup. "
            f"Defaults to {DEFAULT_FIXTURE_PATH}."
        ),
    )
    parser.add_argument(
        "--target-label",
        default=DEFAULT_TARGET_LABEL,
        help="Chunk label to target from imported source context.",
    )
    parser.add_argument(
        "--citation-rationale",
        default=DEFAULT_CITATION_RATIONALE,
        help="Rationale text used by node cite-chunk during scenario setup.",
    )
    parser.add_argument(
        "--workspace-dir",
        default=None,
        help="Optional workspace directory to reuse.",
    )
    parser.add_argument(
        "--keep-workspace",
        action="store_true",
        help="Keep the temporary workspace directory after smoke completes.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable output as JSON.",
    )
    args, passthrough = parser.parse_known_args()

    if args.runner_command and passthrough:
        parser.error(
            "extra runner arguments are not supported with --runner-command; "
            "include them directly in the command string"
        )

    repo_root = Path(__file__).resolve().parent.parent
    manifest_path = repo_root / "Cargo.toml"
    scripts_dir = Path(__file__).resolve().parent
    runner_command_text, preflight_summary, command_source = resolve_runner_command(
        provider=args.provider,
        runner_command=args.runner_command,
        passthrough=passthrough,
        scripts_dir=scripts_dir,
    )

    fixture_path = Path(args.fixture).resolve() if args.fixture else None

    if args.workspace_dir:
        workspace_dir = Path(args.workspace_dir).resolve()
        workspace_dir.mkdir(parents=True, exist_ok=True)
        result = run_desktop_flow_smoke(
            manifest_path=manifest_path,
            workspace_dir=workspace_dir,
            runner_command_text=runner_command_text,
            apply=args.apply,
            fixture_path=fixture_path,
            target_label=args.target_label,
            citation_rationale=args.citation_rationale,
            preflight_summary=preflight_summary,
            provider=args.provider if not args.runner_command else None,
            command_source=command_source,
        )
    elif args.keep_workspace:
        workspace_dir = Path(tempfile.mkdtemp(prefix="nodex-desktop-flow-smoke-"))
        result = run_desktop_flow_smoke(
            manifest_path=manifest_path,
            workspace_dir=workspace_dir,
            runner_command_text=runner_command_text,
            apply=args.apply,
            fixture_path=fixture_path,
            target_label=args.target_label,
            citation_rationale=args.citation_rationale,
            preflight_summary=preflight_summary,
            provider=args.provider if not args.runner_command else None,
            command_source=command_source,
        )
    else:
        with tempfile.TemporaryDirectory(prefix="nodex-desktop-flow-smoke-") as tmp_dir:
            workspace_dir = Path(tmp_dir)
            result = run_desktop_flow_smoke(
                manifest_path=manifest_path,
                workspace_dir=workspace_dir,
                runner_command_text=runner_command_text,
                apply=args.apply,
                fixture_path=fixture_path,
                target_label=args.target_label,
                citation_rationale=args.citation_rationale,
                preflight_summary=preflight_summary,
                provider=args.provider if not args.runner_command else None,
                command_source=command_source,
            )

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print_text_report(result)

    return 0 if result["ok"] else 1


def resolve_runner_command(
    *,
    provider: str,
    runner_command: Optional[str],
    passthrough: list[str],
    scripts_dir: Path,
) -> tuple[str, Optional[dict], str]:
    if runner_command:
        return runner_command, None, "override"

    diagnostics = load_provider_payload(provider, script_path=Path(__file__))
    summary = diagnostics.get("summary", {})
    if not summary.get("has_auth"):
        raise SystemExit(
            f"[preflight] provider `{provider}` has no configured auth. "
            f"Run `python3 scripts/provider_doctor.py --provider {provider}` first."
        )

    entry = get_provider_entry(provider)
    if entry.runner_script is None:
        raise SystemExit(f"[config] provider `{provider}` is not runnable")

    runner_path = scripts_dir / entry.runner_script
    runner_command_parts = [
        sys.executable,
        str(runner_path),
        *entry.default_smoke_args,
        *passthrough,
    ]
    return shlex.join(runner_command_parts), summary, "default"


def run_desktop_flow_smoke(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    runner_command_text: str,
    apply: bool,
    fixture_path: Optional[Path],
    target_label: str,
    citation_rationale: str,
    preflight_summary: Optional[dict],
    provider: Optional[str],
    command_source: str,
) -> dict:
    smoke_result = run_smoke(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        node_id="root",
        scenario="source-context",
        fixture_path=fixture_path,
        target_label=target_label,
        citation_rationale=citation_rationale,
        runner_command_text=runner_command_text,
        apply=apply,
        json_mode=True,
    )
    desktop_flow = build_desktop_flow_summary(smoke_result, apply=apply)
    ai_status = build_ai_status(
        runner_command_text=runner_command_text,
        command_source=command_source,
        smoke_result=smoke_result,
        preflight_summary=preflight_summary,
        provider=provider,
    )
    result = {
        "ok": desktop_flow["ok"],
        "mode": "apply" if apply else "dry_run",
        "workspace_dir": str(workspace_dir),
        "runner_command": runner_command_text,
        "ai_status": ai_status,
        "desktop_flow": desktop_flow,
        "smoke": smoke_result,
    }
    if provider:
        result["provider"] = provider
    if preflight_summary is not None:
        result["preflight_summary"] = preflight_summary
    return result


def build_desktop_flow_summary(smoke_result: dict, *, apply: bool) -> dict:
    scenario_context = smoke_result.get("scenario_context") or {}
    imported_root_node = scenario_context.get("imported_root_node") or {}
    target_node = scenario_context.get("target_node") or {}
    evidence = scenario_context.get("evidence") or {}
    run_payload = smoke_result.get("run_external_json") or {}
    quality = smoke_result.get("quality") or {}
    verification = smoke_result.get("verification") or {}
    ai_run_verification = verification.get("ai_run") or {}
    scenario_verification = verification.get("scenario") or {}
    report = run_payload.get("report") or {}
    patch = run_payload.get("patch") or {}
    patch_ops = patch.get("ops") or []
    add_node_ops = [
        op for op in patch_ops if isinstance(op, dict) and op.get("type") == "add_node"
    ]
    created_nodes = report.get("created_nodes") or []
    preview = report.get("preview") or []

    next_focus_candidate = build_next_focus_candidate(
        apply=apply,
        created_nodes=created_nodes,
        add_node_ops=add_node_ops,
    )

    checks = {
        "workspace_initialized": bool(smoke_result.get("steps", {}).get("init")),
        "imported_root_node_available": bool(imported_root_node.get("id"))
        and imported_root_node.get("id") != "root",
        "source_context_target_selected": bool(target_node.get("id"))
        and target_node.get("id") != "root"
        and bool(evidence.get("chunk_id")),
        "target_node_under_imported_root": scenario_verification.get(
            "target_node_under_imported_root"
        )
        is True,
        "source_context_verified": scenario_verification.get(
            "target_evidence_retained"
        )
        is True
        and scenario_verification.get("source_evidence_link_retained") is True,
        "draft_generated": quality.get("status_ok") is True and len(add_node_ops) > 0,
        "review_payload_available": isinstance(preview, list)
        and len(preview) > 0
        and quality.get("rationale_present") is True,
        "run_recorded": ai_run_verification.get("ok") is True,
        "next_focus_candidate_targets_selected_node": next_focus_candidate.get(
            "parent_id"
        )
        == target_node.get("id"),
    }

    if apply:
        checks["patch_applied"] = smoke_result.get("status") == "applied"
        checks["created_node_verified"] = scenario_verification.get(
            "created_nodes_present"
        ) is True and scenario_verification.get("created_nodes_match_patch") is True
        checks["next_focus_candidate_ready"] = bool(next_focus_candidate.get("id"))
    else:
        checks["dry_run_verified"] = smoke_result.get("status") == "dry_run_succeeded"
        checks["next_focus_candidate_ready"] = bool(next_focus_candidate.get("title"))

    return {
        "ok": all(value is True for value in checks.values()),
        "checks": checks,
        "imported_root_node": imported_root_node,
        "target_node": target_node,
        "evidence_chunk_label": evidence.get("chunk_label"),
        "add_node_op_count": len(add_node_ops),
        "predicted_node_count": len(add_node_ops),
        "created_node_count": (
            len(created_nodes)
            if apply and isinstance(created_nodes, list)
            else 0
        ),
        "next_focus_candidate": next_focus_candidate,
    }


def build_ai_status(
    *,
    runner_command_text: str,
    command_source: str,
    smoke_result: dict,
    preflight_summary: Optional[dict],
    provider: Optional[str],
) -> dict:
    run_payload = smoke_result.get("run_external_json") or {}
    metadata = run_payload.get("metadata") or {}
    generator = run_payload.get("generator") or {}
    detected_provider = provider or detected_provider_from_command(runner_command_text)
    uses_provider_defaults = "--use-default-args" in runner_command_text
    status_error = None
    if command_source == "override" and detected_provider is None:
        status_error = (
            "NODEX_DESKTOP_AI_COMMAND does not map to a known provider runner."
        )

    model = extract_command_flag_value(runner_command_text, "--model")
    if not model and isinstance(generator.get("model"), str):
        model = generator["model"]
    if not model and isinstance(metadata.get("model"), str):
        model = metadata["model"]

    reasoning_effort = extract_command_flag_value(
        runner_command_text, "--reasoning-effort"
    )
    if not reasoning_effort and uses_provider_defaults:
        reasoning_effort = provider_default_reasoning_effort(detected_provider)

    has_auth = summary_bool(preflight_summary, "has_auth")
    has_process_env_conflict = summary_bool(
        preflight_summary, "has_process_env_conflict"
    )
    has_shell_env_conflict = summary_bool(preflight_summary, "has_shell_env_conflict")

    return {
        "command": runner_command_text,
        "command_source": command_source,
        "provider": detected_provider,
        "runner": detected_runner_from_command(runner_command_text),
        "model": model,
        "reasoning_effort": reasoning_effort,
        "has_auth": has_auth,
        "has_process_env_conflict": has_process_env_conflict,
        "has_shell_env_conflict": has_shell_env_conflict,
        "uses_provider_defaults": uses_provider_defaults,
        "status_error": status_error,
    }


def summary_bool(summary: Optional[dict], key: str) -> Optional[bool]:
    if not isinstance(summary, dict):
        return None
    value = summary.get(key)
    return value if isinstance(value, bool) else None


def extract_command_flag_value(command: str, flag: str) -> Optional[str]:
    spaced_flag = f"{flag} "
    equals_flag = f"{flag}="
    if equals_flag in command:
        return extract_flag_token(command.split(equals_flag, maxsplit=1)[1])
    if spaced_flag in command:
        return extract_flag_token(command.split(spaced_flag, maxsplit=1)[1])
    return None


def extract_flag_token(value: str) -> Optional[str]:
    trimmed = value.strip()
    if not trimmed:
        return None
    token = trimmed.split(maxsplit=1)[0].strip("'\"")
    return token or None


def provider_default_reasoning_effort(provider: Optional[str]) -> Optional[str]:
    if provider == "codex":
        return "low"
    return None


def detected_provider_from_command(command: str) -> Optional[str]:
    if (
        "--provider codex" in command
        or "--provider=codex" in command
        or "codex_runner.py" in command
    ):
        return "codex"
    if (
        "--provider anthropic" in command
        or "--provider=anthropic" in command
        or "langchain_anthropic_runner.py" in command
    ):
        return "anthropic"
    if (
        "--provider openai" in command
        or "--provider=openai" in command
        or "langchain_openai_runner.py" in command
        or "openai_runner.py" in command
    ):
        return "openai"
    if (
        "--provider gemini" in command
        or "--provider=gemini" in command
        or "gemini_runner.py" in command
    ):
        return "gemini"
    return None


def detected_runner_from_command(command: str) -> str:
    if "provider_runner.py" in command:
        return "provider_runner.py"
    if "langchain_anthropic_runner.py" in command:
        return "langchain_anthropic_runner.py"
    if "langchain_openai_runner.py" in command:
        return "langchain_openai_runner.py"
    if "codex_runner.py" in command:
        return "codex_runner.py"
    if "openai_runner.py" in command:
        return "openai_runner.py"
    if "gemini_runner.py" in command:
        return "gemini_runner.py"
    return "custom"


def build_next_focus_candidate(
    *,
    apply: bool,
    created_nodes: list,
    add_node_ops: list[dict],
) -> dict:
    if apply:
        parent_id = None
        for op in add_node_ops:
            parent_id = op.get("parent_id")
            break
        for node in created_nodes:
            if not isinstance(node, dict):
                continue
            if node.get("id"):
                return {
                    "source": "created_node",
                    "id": node.get("id"),
                    "title": node.get("title"),
                    "parent_id": parent_id,
                }
        return {}

    for op in add_node_ops:
        return {
            "source": "patch_op_preview",
            "title": op.get("title"),
            "kind": op.get("kind"),
            "parent_id": op.get("parent_id"),
        }
    return {}


def print_text_report(result: dict) -> None:
    desktop = result["desktop_flow"]
    checks = desktop["checks"]
    print(f"Workspace: {result['workspace_dir']}")
    print(f"Mode: {result['mode']}")
    if result.get("provider"):
        print(f"Provider: {result['provider']}")
    print(f"Runner: {result['runner_command']}")
    print(f"Target node: {desktop['target_node'].get('title', '(unknown)')}")
    print(f"Evidence chunk: {desktop.get('evidence_chunk_label') or '(unknown)'}")
    print()
    print("[desktop flow checks]")
    for key, value in checks.items():
        status = "ok" if value is True else "failed"
        print(f"- {key}: {status}")
    print()
    candidate = desktop.get("next_focus_candidate") or {}
    if candidate:
        print("[next focus candidate]")
        for key in ("source", "id", "title", "kind", "parent_id"):
            if key in candidate and candidate[key] is not None:
                print(f"- {key}: {candidate[key]}")
        print()
    print(f"overall: {'ok' if result['ok'] else 'failed'}")


if __name__ == "__main__":
    raise SystemExit(main())
