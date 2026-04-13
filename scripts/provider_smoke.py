#!/usr/bin/env python3

import argparse
import json
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, Union

from provider_registry import (
    get_provider_entry,
    load_provider_payload,
    provider_names,
    runnable_provider_names,
)
from source_context_scenario import (
    DEFAULT_CITATION_RATIONALE,
    DEFAULT_FIXTURE_PATH,
    DEFAULT_FIXTURE_SET,
    DEFAULT_TARGET_LABEL,
    fixture_set_cases,
    fixture_set_names,
    prepare_source_context_scenario,
    verify_source_context_workspace_state,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run a provider smoke test in a temporary Nodex workspace."
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Show runnable providers and their default smoke arguments.",
    )
    parser.add_argument(
        "--provider",
        choices=runnable_provider_names(),
        required=False,
        help="Which runnable provider to smoke test.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the resulting patch instead of running in dry-run mode.",
    )
    parser.add_argument(
        "--keep-workspace",
        action="store_true",
        help="Keep the temporary workspace directory after the smoke test.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print smoke metadata as JSON after completion.",
    )
    parser.add_argument(
        "--node-id",
        default="root",
        help="Node id to target for the smoke request.",
    )
    parser.add_argument(
        "--scenario",
        choices=("minimal", "source-context"),
        default="minimal",
        help="Which workspace setup scenario to run before the AI draft.",
    )
    parser.add_argument(
        "--fixture",
        default=None,
        help=(
            "Optional Markdown fixture path for --scenario source-context. "
            f"Defaults to {DEFAULT_FIXTURE_PATH}."
        ),
    )
    parser.add_argument(
        "--fixture-set",
        choices=fixture_set_names(),
        default=None,
        help=(
            "Run a fixed set of source-context cases instead of a single scenario. "
            f"The default set is {DEFAULT_FIXTURE_SET}."
        ),
    )
    args, passthrough = parser.parse_known_args()

    if args.list:
        print("Smoke-capable providers:")
        for provider in provider_names():
            entry = get_provider_entry(provider)
            if entry.runner_script is None:
                print(f"- {provider}: diagnostics-only")
                continue
            extras = shlex.join(entry.default_smoke_args) if entry.default_smoke_args else "(none)"
            print(f"- {provider}: runner={entry.runner_script}, default_args={extras}")
        print("Fixture sets:")
        for fixture_set_name in fixture_set_names():
            print(f"- {fixture_set_name}")
        return 0

    if not args.provider:
        parser.error("--provider is required unless --list is used")

    repo_root = Path(__file__).resolve().parent.parent
    diagnostics = load_provider_payload(args.provider, script_path=Path(__file__))
    summary = diagnostics.get("summary", {})
    if not summary.get("has_auth"):
        raise SystemExit(
            f"[preflight] provider `{args.provider}` has no configured auth. "
            f"Run `python3 scripts/provider_doctor.py --provider {args.provider}` first."
        )

    entry = get_provider_entry(args.provider)
    if entry.runner_script is None:
        raise SystemExit(f"[config] provider `{args.provider}` is not runnable")

    manifest_path = repo_root / "Cargo.toml"
    runner_path = Path(__file__).resolve().parent / entry.runner_script
    runner_command = [sys.executable, str(runner_path), *entry.default_smoke_args, *passthrough]
    runner_command_text = shlex.join(runner_command)

    if args.fixture_set:
        return run_fixture_set_mode(
            args=args,
            manifest_path=manifest_path,
            runner_command_text=runner_command_text,
            summary=summary,
        )

    if args.keep_workspace:
        tmp_dir = Path(tempfile.mkdtemp(prefix=f"nodex-smoke-{args.provider}-"))
        result = run_smoke(
            manifest_path=manifest_path,
            workspace_dir=tmp_dir,
            node_id=args.node_id,
            scenario=args.scenario,
            fixture_path=Path(args.fixture).resolve() if args.fixture else None,
            runner_command_text=runner_command_text,
            apply=args.apply,
            json_mode=args.json,
        )
        result["workspace_dir"] = str(tmp_dir)
        result["provider"] = args.provider
        result["runner_command"] = runner_command_text
        result["preflight_summary"] = summary
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"Workspace kept at: {tmp_dir}")
        return 0

    with tempfile.TemporaryDirectory(prefix=f"nodex-smoke-{args.provider}-") as tmp_dir:
        result = run_smoke(
            manifest_path=manifest_path,
            workspace_dir=Path(tmp_dir),
            node_id=args.node_id,
            scenario=args.scenario,
            fixture_path=Path(args.fixture).resolve() if args.fixture else None,
            runner_command_text=runner_command_text,
            apply=args.apply,
            json_mode=args.json,
        )
        result["workspace_dir"] = str(tmp_dir)
        result["provider"] = args.provider
        result["runner_command"] = runner_command_text
        result["preflight_summary"] = summary
        if args.json:
            print(json.dumps(result, indent=2))
        return 0


def run_fixture_set_mode(
    *,
    args,
    manifest_path: Path,
    runner_command_text: str,
    summary: dict,
) -> int:
    fixture_cases = fixture_set_cases(args.fixture_set)

    if args.keep_workspace:
        root_dir = Path(tempfile.mkdtemp(prefix=f"nodex-smoke-{args.provider}-"))
        result = run_fixture_set_smoke(
            manifest_path=manifest_path,
            workspace_root_dir=root_dir,
            fixture_set_name=args.fixture_set,
            fixture_cases=fixture_cases,
            runner_command_text=runner_command_text,
            apply=args.apply,
            json_mode=args.json,
        )
        result["workspace_dir"] = str(root_dir)
        result["provider"] = args.provider
        result["runner_command"] = runner_command_text
        result["preflight_summary"] = summary
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"Workspace kept at: {root_dir}")
        return 0 if result["ok"] else 1

    with tempfile.TemporaryDirectory(prefix=f"nodex-smoke-{args.provider}-") as tmp_dir:
        root_dir = Path(tmp_dir)
        result = run_fixture_set_smoke(
            manifest_path=manifest_path,
            workspace_root_dir=root_dir,
            fixture_set_name=args.fixture_set,
            fixture_cases=fixture_cases,
            runner_command_text=runner_command_text,
            apply=args.apply,
            json_mode=args.json,
        )
        result["workspace_dir"] = str(root_dir)
        result["provider"] = args.provider
        result["runner_command"] = runner_command_text
        result["preflight_summary"] = summary
        if args.json:
            print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1


def run_smoke(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    node_id: str,
    scenario: str,
    fixture_path: Optional[Path],
    target_label: Optional[str] = None,
    citation_rationale: Optional[str] = None,
    runner_command_text: str,
    apply: bool,
    json_mode: bool,
) -> dict:
    init_output = run_command(
        ["cargo", "run", "--manifest-path", str(manifest_path), "--", "init"],
        cwd=workspace_dir,
        capture=json_mode,
    )
    scenario_payload = None
    effective_node_id = node_id
    if scenario == "source-context":
        scenario_payload = prepare_source_context_scenario(
            manifest_path=manifest_path,
            workspace_dir=workspace_dir,
            fixture_path=fixture_path,
            target_label=target_label or DEFAULT_TARGET_LABEL,
            citation_rationale=citation_rationale or DEFAULT_CITATION_RATIONALE,
        )
        effective_node_id = scenario_payload["target_node"]["id"]
    args = [
        "cargo",
        "run",
        "--manifest-path",
        str(manifest_path),
        "--",
        "ai",
        "run-external",
        effective_node_id,
        runner_command_text,
    ]
    if not apply:
        args.append("--dry-run")
    if json_mode:
        args.extend(["--format", "json"])
    run_output = run_command(args, cwd=workspace_dir, capture=json_mode)
    result = {
        "scenario": scenario,
        "mode": "apply" if apply else "dry_run",
        "node_id": effective_node_id,
        "status": expected_status_for_mode(apply),
    }
    if scenario_payload is not None:
        result["scenario_context"] = scenario_payload
    if json_mode:
        result["steps"] = {
            "init": init_output,
            "run_external": run_output,
        }
        try:
            result["run_external_json"] = json.loads(run_output["stdout"])
            result["quality"] = build_run_quality_summary(
                result["run_external_json"], apply=apply
            )
            result["status"] = result["run_external_json"].get("metadata", {}).get(
                "status",
                result["status"],
            )
            result["verification"] = build_smoke_verification(
                manifest_path=manifest_path,
                workspace_dir=workspace_dir,
                node_id=effective_node_id,
                scenario=scenario,
                scenario_payload=scenario_payload,
                run_payload=result["run_external_json"],
                apply=apply,
            )
        except Exception:
            pass
    return result


def run_fixture_set_smoke(
    *,
    manifest_path: Path,
    workspace_root_dir: Path,
    fixture_set_name: str,
    fixture_cases: list[dict],
    runner_command_text: str,
    apply: bool,
    json_mode: bool,
) -> dict:
    case_results = []
    for case in fixture_cases:
        case_dir = workspace_root_dir / case["id"]
        case_dir.mkdir(parents=True, exist_ok=True)
        result = run_smoke(
            manifest_path=manifest_path,
            workspace_dir=case_dir,
            node_id="root",
            scenario="source-context",
            fixture_path=case["fixture_path"],
            target_label=case["target_label"],
            citation_rationale=case["citation_rationale"],
            runner_command_text=runner_command_text,
            apply=apply,
            json_mode=json_mode,
        )
        result["case_id"] = case["id"]
        case_results.append(result)

    metrics = build_fixture_set_metrics(case_results, apply=apply)
    return {
        "ok": metrics["failed_cases"] == 0 and metrics["verification_failed_cases"] == 0,
        "fixture_set": fixture_set_name,
        "mode": "apply" if apply else "dry_run",
        "cases": case_results,
        "metrics": metrics,
    }


def build_fixture_set_metrics(case_results: list[dict], *, apply: bool) -> dict:
    expected_status = expected_status_for_mode(apply)
    total_cases = len(case_results)
    successful_cases = sum(
        1
        for item in case_results
        if case_status_matches(item, expected_status)
    )
    failed_cases = total_cases - successful_cases
    verification_ok_cases = sum(
        1 for item in case_results if item.get("verification", {}).get("ok") is True
    )
    verification_failed_cases = sum(
        1
        for item in case_results
        if "verification" in item and item.get("verification", {}).get("ok") is not True
    )
    direct_evidence_cases = sum(
        1
        for item in case_results
        if item.get("quality", {}).get("has_direct_evidence") is True
    )
    explainability_complete_cases = sum(
        1
        for item in case_results
        if item.get("quality", {}).get("explainability_complete") is True
    )
    return {
        "total_cases": total_cases,
        "successful_cases": successful_cases,
        "failed_cases": failed_cases,
        "patch_legal_rate": successful_cases / total_cases if total_cases else 0,
        "verification_ok_cases": verification_ok_cases,
        "verification_failed_cases": verification_failed_cases,
        "direct_evidence_cases": direct_evidence_cases,
        "explainability_complete_cases": explainability_complete_cases,
    }


def build_run_quality_summary(run_payload: dict, *, apply: bool) -> dict:
    expected_status = expected_status_for_mode(apply)
    metadata = run_payload.get("metadata", {}) or {}
    explanation = run_payload.get("explanation") or {}
    patch = run_payload.get("patch") or {}
    report = run_payload.get("report") or {}
    status = metadata.get("status")
    direct_evidence = explanation.get("direct_evidence") or []
    inferred = explanation.get("inferred_suggestions") or []
    rationale = explanation.get("rationale_summary") or ""
    ops = patch.get("ops") or []
    preview = report.get("preview") or []
    created_nodes = report.get("created_nodes") or []
    add_node_ops = [
        op for op in ops if isinstance(op, dict) and op.get("type") == "add_node"
    ]
    patch_run_id = metadata.get("patch_run_id")
    return {
        "status": status,
        "expected_status": expected_status,
        "status_ok": status == expected_status,
        "patch_legal": status == expected_status,
        "patch_op_count": len(ops) if isinstance(ops, list) else 0,
        "preview_line_count": len(preview) if isinstance(preview, list) else 0,
        "direct_evidence_count": len(direct_evidence) if isinstance(direct_evidence, list) else 0,
        "has_direct_evidence": bool(direct_evidence),
        "inferred_suggestions_count": len(inferred) if isinstance(inferred, list) else 0,
        "patch_run_link_ok": bool(patch_run_id) if apply else patch_run_id is None,
        "created_node_count": len(created_nodes) if isinstance(created_nodes, list) else 0,
        "add_node_op_count": len(add_node_ops),
        "created_nodes_recorded": (
            len(created_nodes) == len(add_node_ops)
            if apply and isinstance(created_nodes, list)
            else len(created_nodes) == 0 if isinstance(created_nodes, list) else False
        ),
        "rationale_present": isinstance(rationale, str) and bool(rationale.strip()),
        "explainability_complete": (
            isinstance(rationale, str)
            and bool(rationale.strip())
            and isinstance(inferred, list)
            and isinstance(direct_evidence, list)
        ),
    }


def build_smoke_verification(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    node_id: str,
    scenario: str,
    scenario_payload: Optional[dict],
    run_payload: dict,
    apply: bool,
) -> dict:
    verification = {}
    metadata = run_payload.get("metadata", {}) or {}
    run_id = metadata.get("run_id")
    if isinstance(run_id, str) and run_id:
        verification["ai_run"] = verify_ai_run_persistence(
            manifest_path=manifest_path,
            workspace_dir=workspace_dir,
            run_id=run_id,
            node_id=node_id,
            apply=apply,
        )
    if scenario == "source-context" and scenario_payload is not None:
        verification["scenario"] = verify_source_context_workspace_state(
            manifest_path=manifest_path,
            workspace_dir=workspace_dir,
            scenario_payload=scenario_payload,
            created_nodes=report_created_nodes(run_payload) if apply else None,
            patch_ops=patch_ops(run_payload) if apply else None,
        )
    verification["ok"] = all(
        item.get("ok") is True
        for key, item in verification.items()
        if isinstance(item, dict) and key != "ok"
    )
    return verification


def verify_ai_run_persistence(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    run_id: str,
    node_id: str,
    apply: bool,
) -> dict:
    history = run_nodex_json_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["ai", "history", "--node-id", node_id, "--format", "json"],
    )
    show_output = run_nodex_json_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["ai", "show", run_id, "--format", "json"],
    )
    expected_status = expected_status_for_mode(apply)
    history_entry = next(
        (
            item
            for item in history
            if isinstance(item, dict) and item.get("id") == run_id
        ),
        None,
    )
    record = show_output.get("record") or {}
    patch_preview = show_output.get("patch_preview") or []
    patch_run_id = record.get("patch_run_id")
    history_entry_found = history_entry is not None
    history_status_ok = history_entry is not None and history_entry.get("status") == expected_status
    history_patch_link_ok = (
        bool(history_entry.get("patch_run_id")) if apply and history_entry is not None else True
    )
    if not apply and history_entry is not None:
        history_patch_link_ok = history_entry.get("patch_run_id") is None
    show_status_ok = record.get("status") == expected_status
    show_patch_link_ok = bool(patch_run_id) if apply else patch_run_id is None
    ok = (
        history_entry_found
        and history_status_ok
        and history_patch_link_ok
        and show_status_ok
        and record.get("node_id") == node_id
        and isinstance(show_output.get("patch"), dict)
        and isinstance(show_output.get("explanation"), dict)
        and isinstance(patch_preview, list)
        and len(patch_preview) > 0
        and show_patch_link_ok
    )
    return {
        "run_id": run_id,
        "history_entry_found": history_entry_found,
        "history_status_ok": history_status_ok,
        "history_patch_link_ok": history_patch_link_ok,
        "show_status_ok": show_status_ok,
        "show_patch_link_ok": show_patch_link_ok,
        "show_patch_preview_count": len(patch_preview) if isinstance(patch_preview, list) else 0,
        "response_notes_count": len(show_output.get("response_notes") or []),
        "ok": ok,
    }


def run_nodex_json_command(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    args: list[str],
) -> Union[dict, list]:
    output = run_command(
        ["cargo", "run", "--manifest-path", str(manifest_path), "--", *args],
        cwd=workspace_dir,
        capture=True,
    )
    try:
        return json.loads(output["stdout"])
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"command {' '.join(args)} did not return valid JSON: {exc}"
        ) from exc


def expected_status_for_mode(apply: bool) -> str:
    return "applied" if apply else "dry_run_succeeded"


def case_status_matches(case_result: dict, expected_status: str) -> bool:
    quality = case_result.get("quality") or {}
    if quality.get("status_ok") is True:
        return True
    if case_result.get("status") == expected_status:
        return True
    metadata = case_result.get("run_external_json", {}).get("metadata", {}) or {}
    return metadata.get("status") == expected_status


def report_created_nodes(run_payload: dict) -> list[dict]:
    report = run_payload.get("report") or {}
    created_nodes = report.get("created_nodes") or []
    return created_nodes if isinstance(created_nodes, list) else []


def patch_ops(run_payload: dict) -> list[dict]:
    patch = run_payload.get("patch") or {}
    ops = patch.get("ops") or []
    return ops if isinstance(ops, list) else []


def run_command(command: list[str], *, cwd: Path, capture: bool) -> Optional[dict]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=capture,
        text=True,
    )
    if completed.returncode != 0:
        if capture:
            detail = completed.stderr.strip() or completed.stdout.strip() or str(
                completed.returncode
            )
            raise SystemExit(detail)
        raise SystemExit(completed.returncode)
    if not capture:
        return None
    return {
        "command": command,
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


if __name__ == "__main__":
    raise SystemExit(main())
