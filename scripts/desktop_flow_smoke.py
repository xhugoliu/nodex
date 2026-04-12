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
        default="anthropic",
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
    runner_command_text, preflight_summary = resolve_runner_command(
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
) -> tuple[str, Optional[dict]]:
    if runner_command:
        return runner_command, None

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
    return shlex.join(runner_command_parts), summary


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
    result = {
        "ok": desktop_flow["ok"],
        "mode": "apply" if apply else "dry_run",
        "workspace_dir": str(workspace_dir),
        "runner_command": runner_command_text,
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
        "source_context_target_selected": bool(target_node.get("id"))
        and target_node.get("id") != "root"
        and bool(evidence.get("chunk_id")),
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
        "target_node": target_node,
        "evidence_chunk_label": evidence.get("chunk_label"),
        "add_node_op_count": len(add_node_ops),
        "created_node_count": len(created_nodes)
        if isinstance(created_nodes, list)
        else 0,
        "next_focus_candidate": next_focus_candidate,
    }


def build_next_focus_candidate(
    *,
    apply: bool,
    created_nodes: list,
    add_node_ops: list[dict],
) -> dict:
    if apply:
        for node in created_nodes:
            if not isinstance(node, dict):
                continue
            if node.get("id"):
                return {
                    "source": "created_node",
                    "id": node.get("id"),
                    "title": node.get("title"),
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
