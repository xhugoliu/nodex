#!/usr/bin/env python3

import argparse
import json
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

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
            result["quality"] = build_run_quality_summary(result["run_external_json"])
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

    metrics = build_fixture_set_metrics(case_results)
    return {
        "ok": metrics["failed_cases"] == 0,
        "fixture_set": fixture_set_name,
        "mode": "apply" if apply else "dry_run",
        "cases": case_results,
        "metrics": metrics,
    }


def build_fixture_set_metrics(case_results: list[dict]) -> dict:
    total_cases = len(case_results)
    successful_cases = sum(
        1
        for item in case_results
        if item.get("run_external_json", {}).get("metadata", {}).get("status")
        == "dry_run_succeeded"
    )
    failed_cases = total_cases - successful_cases
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
        "direct_evidence_cases": direct_evidence_cases,
        "explainability_complete_cases": explainability_complete_cases,
    }


def build_run_quality_summary(run_payload: dict) -> dict:
    explanation = run_payload.get("explanation") or {}
    report = run_payload.get("report") or {}
    direct_evidence = explanation.get("direct_evidence") or []
    inferred = explanation.get("inferred_suggestions") or []
    rationale = explanation.get("rationale_summary") or ""
    preview = report.get("preview") or []
    return {
        "patch_legal": run_payload.get("metadata", {}).get("status") == "dry_run_succeeded",
        "patch_op_count": len(preview) if isinstance(preview, list) else 0,
        "direct_evidence_count": len(direct_evidence) if isinstance(direct_evidence, list) else 0,
        "has_direct_evidence": bool(direct_evidence),
        "inferred_suggestions_count": len(inferred) if isinstance(inferred, list) else 0,
        "rationale_present": isinstance(rationale, str) and bool(rationale.strip()),
        "explainability_complete": (
            isinstance(rationale, str)
            and bool(rationale.strip())
            and isinstance(inferred, list)
            and isinstance(direct_evidence, list)
        ),
    }


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
