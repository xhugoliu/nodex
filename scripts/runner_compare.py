#!/usr/bin/env python3

import argparse
import collections
import itertools
import json
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

from source_context_scenario import (
    DEFAULT_CITATION_RATIONALE,
    DEFAULT_FIXTURE_PATH,
    DEFAULT_FIXTURE_SET,
    DEFAULT_TARGET_LABEL,
    fixture_set_cases,
    fixture_set_names,
    prepare_source_root_scenario,
    prepare_source_context_scenario,
)


REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "Cargo.toml"
PRESET_OFFLINE_MODES = ("none", "openai", "all")


def preset_runners() -> dict[str, list[tuple[str, str]]]:
    python = sys.executable
    scripts_dir = REPO_ROOT / "scripts"
    return {
        "langchain-pilot": [
            (
                "openai-minimal",
                shlex.join([python, str(scripts_dir / "openai_runner.py")]),
            ),
            (
                "langchain-openai",
                shlex.join([python, str(scripts_dir / "langchain_openai_runner.py")]),
            ),
            (
                "langchain-anthropic",
                shlex.join([python, str(scripts_dir / "langchain_anthropic_runner.py")]),
            ),
        ]
    }


def build_compare_offline_command(label: str) -> str:
    python = sys.executable
    script_path = REPO_ROOT / "scripts" / "compare_offline_runner.py"
    variant = label
    return shlex.join([python, str(script_path), "--variant", variant])


def should_use_preset_offline_substitute(
    *,
    preset_name: str,
    label: str,
    preset_offline_mode: str,
) -> bool:
    if preset_offline_mode == "none":
        return False
    if preset_name != "langchain-pilot":
        return False
    if preset_offline_mode == "all":
        return True
    return label in {"openai-minimal", "langchain-openai"}


def parse_runner_spec(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError(
            "runner specs must use the form <label>=<command>"
        )
    label, command = value.split("=", 1)
    label = label.strip()
    command = command.strip()
    if not label or not command:
        raise argparse.ArgumentTypeError(
            "runner specs must include both a non-empty label and command"
        )
    return label, command


def build_runner_specs(
    *,
    preset_names: list[str],
    explicit_specs: list[tuple[str, str]],
    preset_offline_mode: str = "none",
) -> list[dict]:
    specs: list[dict] = []
    seen_labels: set[str] = set()

    for preset_name in preset_names:
        preset = preset_runners()[preset_name]
        for label, command in preset:
            offline_substitute = should_use_preset_offline_substitute(
                preset_name=preset_name,
                label=label,
                preset_offline_mode=preset_offline_mode,
            )
            effective_command = (
                build_compare_offline_command(label)
                if offline_substitute
                else command
            )
            if label in seen_labels:
                raise SystemExit(
                    f"[config] duplicate runner label `{label}` from preset `{preset_name}`"
                )
            specs.append(
                {
                    "label": label,
                    "command": effective_command,
                    "source": preset_name,
                    "offline_substitute": offline_substitute,
                }
            )
            seen_labels.add(label)

    for label, command in explicit_specs:
        if label in seen_labels:
            raise SystemExit(f"[config] duplicate runner label `{label}`")
        specs.append(
            {
                "label": label,
                "command": command,
                "source": "explicit",
                "offline_substitute": False,
            }
        )
        seen_labels.add(label)

    return specs


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run multiple Nodex external AI runners against the same temporary workspace "
            "and collect comparable run/show/compare output."
        )
    )
    parser.add_argument(
        "--list-presets",
        action="store_true",
        help="Show available runner presets and exit.",
    )
    parser.add_argument(
        "--preset",
        action="append",
        default=[],
        choices=tuple(sorted(preset_runners().keys())),
        help="Add one built-in runner preset.",
    )
    parser.add_argument(
        "--preset-offline",
        choices=PRESET_OFFLINE_MODES,
        default="none",
        help=(
            "Optionally substitute built-in preset lanes with compare-only local stubs. "
            "`openai` replaces only the OpenAI lanes for `langchain-pilot`; "
            "`all` replaces every lane in the preset. Default: none."
        ),
    )
    parser.add_argument(
        "--runner",
        action="append",
        default=[],
        type=parse_runner_spec,
        help="Add one explicit runner in the form <label>=<command>.",
    )
    parser.add_argument(
        "--node-id",
        default="root",
        help="Node id to target for all runs.",
    )
    parser.add_argument(
        "--scenario",
        choices=("minimal", "source-context", "source-root"),
        default="minimal",
        help="Which workspace setup scenario to run before invoking the runners.",
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
    parser.add_argument(
        "--workspace-dir",
        default=None,
        help="Optional workspace directory to reuse instead of creating a temp directory.",
    )
    parser.add_argument(
        "--keep-workspace",
        action="store_true",
        help="Keep the temporary workspace directory after the comparison finishes.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable comparison output as JSON.",
    )
    args = parser.parse_args()

    if args.list_presets:
        print_preset_list()
        return 0

    if args.preset_offline != "none" and not args.preset:
        parser.error("--preset-offline requires at least one --preset")

    runner_specs = build_runner_specs(
        preset_names=args.preset,
        explicit_specs=args.runner,
        preset_offline_mode=args.preset_offline,
    )
    if len(runner_specs) < 2:
        parser.error("at least two runners are required")

    if args.fixture_set:
        result = run_fixture_set_compare(
            runner_specs=runner_specs,
            fixture_set_name=args.fixture_set,
        )
        result["preset_offline_mode"] = args.preset_offline
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print_fixture_set_report(result)
        return 0 if result["ok"] else 1

    if args.workspace_dir:
        workspace_dir = Path(args.workspace_dir).resolve()
        workspace_dir.mkdir(parents=True, exist_ok=True)
        result = compare_runners(
            workspace_dir=workspace_dir,
            runner_specs=runner_specs,
            node_id=args.node_id,
            scenario=args.scenario,
            fixture_path=Path(args.fixture).resolve() if args.fixture else None,
        )
        result["preset_offline_mode"] = args.preset_offline
    elif args.keep_workspace:
        workspace_dir = Path(tempfile.mkdtemp(prefix="nodex-compare-"))
        result = compare_runners(
            workspace_dir=workspace_dir,
            runner_specs=runner_specs,
            node_id=args.node_id,
            scenario=args.scenario,
            fixture_path=Path(args.fixture).resolve() if args.fixture else None,
        )
        result["workspace_dir"] = str(workspace_dir)
        result["preset_offline_mode"] = args.preset_offline
    else:
        with tempfile.TemporaryDirectory(prefix="nodex-compare-") as tmp_dir:
            workspace_dir = Path(tmp_dir)
            result = compare_runners(
                workspace_dir=workspace_dir,
                runner_specs=runner_specs,
                node_id=args.node_id,
                scenario=args.scenario,
                fixture_path=Path(args.fixture).resolve() if args.fixture else None,
            )
            result["workspace_dir"] = str(workspace_dir)
            result["preset_offline_mode"] = args.preset_offline

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print_text_report(result)

    return 0 if result["ok"] else 1


def print_preset_list() -> None:
    print("Available runner presets:")
    for preset_name, entries in preset_runners().items():
        print(f"- {preset_name}:")
        for label, command in entries:
            print(f"  - {label}: {command}")
    print("Fixture sets:")
    for fixture_set_name in fixture_set_names():
        print(f"- {fixture_set_name}")
    print("Preset offline modes:")
    print("- none: use built-in commands as-is")
    print("- openai: replace only OpenAI lanes in `langchain-pilot` with compare-only stubs")
    print("- all: replace every lane in the preset with compare-only stubs")


def compare_runners(
    *,
    workspace_dir: Path,
    runner_specs: list[dict],
    node_id: str,
    scenario: str,
    fixture_path: Optional[Path],
) -> dict:
    ensure_workspace_initialized(workspace_dir)
    scenario_payload = None
    effective_node_id = node_id
    if scenario == "source-context":
        scenario_payload = prepare_source_context_scenario(
            manifest_path=MANIFEST_PATH,
            workspace_dir=workspace_dir,
            fixture_path=fixture_path,
            target_label=DEFAULT_TARGET_LABEL,
            citation_rationale=DEFAULT_CITATION_RATIONALE,
        )
        effective_node_id = scenario_payload["target_node"]["id"]
    elif scenario == "source-root":
        scenario_payload = prepare_source_root_scenario(
            manifest_path=MANIFEST_PATH,
            workspace_dir=workspace_dir,
            fixture_path=fixture_path,
        )
        effective_node_id = scenario_payload["target_node"]["id"]
    runs = [
        run_one_runner(workspace_dir=workspace_dir, node_id=effective_node_id, spec=spec)
        for spec in runner_specs
    ]
    successful = [item for item in runs if item["status"] == "ok"]
    comparisons = [
        compare_pair(
            workspace_dir=workspace_dir,
            left=left,
            right=right,
        )
        for left, right in itertools.combinations(successful, 2)
    ]
    blocked_comparisons = build_blocked_comparisons(runs)
    ok = len(successful) >= 2 and all(item["status"] == "ok" for item in comparisons)
    result = {
        "ok": ok,
        "workspace_dir": str(workspace_dir),
        "scenario": scenario,
        "node_id": effective_node_id,
        "runner_count": len(runner_specs),
        "successful_runs": len(successful),
        "failed_runs": len(runner_specs) - len(successful),
        "runs": runs,
        "comparisons": comparisons,
        "blocked_comparisons": blocked_comparisons,
        "comparison_readiness": build_comparison_readiness(
            runs=runs,
            comparisons=comparisons,
            blocked_comparisons=blocked_comparisons,
        ),
    }
    if scenario_payload is not None:
        result["scenario_context"] = scenario_payload
    result["runner_metrics"] = aggregate_runner_metrics(runs)
    result["failure_metrics"] = aggregate_failure_metrics(runs)
    result["comparison_metrics"] = aggregate_comparison_metrics(comparisons)
    return result


def run_fixture_set_compare(
    *,
    runner_specs: list[dict],
    fixture_set_name: str,
) -> dict:
    cases = fixture_set_cases(fixture_set_name)
    case_results = []
    with tempfile.TemporaryDirectory(prefix="nodex-compare-set-") as tmp_dir:
        root_dir = Path(tmp_dir)
        for case in cases:
            workspace_dir = root_dir / case["id"]
            workspace_dir.mkdir(parents=True, exist_ok=True)
            ensure_workspace_initialized(workspace_dir)
            scenario_payload = prepare_source_context_scenario(
                manifest_path=MANIFEST_PATH,
                workspace_dir=workspace_dir,
                fixture_path=case["fixture_path"],
                target_label=case["target_label"],
                citation_rationale=case["citation_rationale"],
            )
            effective_node_id = scenario_payload["target_node"]["id"]
            runs = [
                run_one_runner(
                    workspace_dir=workspace_dir,
                    node_id=effective_node_id,
                    spec=spec,
                )
                for spec in runner_specs
            ]
            successful = [item for item in runs if item["status"] == "ok"]
            comparisons = [
                compare_pair(
                    workspace_dir=workspace_dir,
                    left=left,
                    right=right,
                )
                for left, right in itertools.combinations(successful, 2)
            ]
            blocked_comparisons = build_blocked_comparisons(runs)
            case_results.append(
                {
                    "case_id": case["id"],
                    "workspace_dir": str(workspace_dir),
                    "scenario": "source-context",
                    "node_id": effective_node_id,
                    "scenario_context": scenario_payload,
                    "runs": runs,
                    "comparisons": comparisons,
                    "blocked_comparisons": blocked_comparisons,
                    "comparison_readiness": build_comparison_readiness(
                        runs=runs,
                        comparisons=comparisons,
                        blocked_comparisons=blocked_comparisons,
                    ),
                    "runner_metrics": aggregate_runner_metrics(runs),
                    "comparison_metrics": aggregate_comparison_metrics(comparisons),
                }
            )

    aggregate = aggregate_fixture_set_metrics(case_results)
    return {
        "ok": aggregate["failed_cases"] == 0,
        "fixture_set": fixture_set_name,
        "cases": case_results,
        "aggregate": aggregate,
    }


def ensure_workspace_initialized(workspace_dir: Path) -> None:
    db_path = workspace_dir / ".nodex" / "project.db"
    if db_path.exists():
        return
    run_nodex_command(
        ["init"],
        cwd=workspace_dir,
        expect_json=False,
    )


def run_one_runner(*, workspace_dir: Path, node_id: str, spec: dict) -> dict:
    args = [
        "ai",
        "run-external",
        node_id,
        spec["command"],
        "--dry-run",
        "--format",
        "json",
    ]
    try:
        run_payload = run_nodex_command(args, cwd=workspace_dir, expect_json=True)
        metadata = run_payload["metadata"]
        run_id = metadata["run_id"]
        show_payload = run_nodex_command(
            ["ai", "show", run_id, "--format", "json"],
            cwd=workspace_dir,
            expect_json=True,
        )
        return {
            "label": spec["label"],
            "command": spec["command"],
            "source": spec["source"],
            "offline_substitute": spec.get("offline_substitute") is True,
            "status": "ok",
            "run_id": run_id,
            "metadata": metadata,
            "report": run_payload,
            "show": show_payload,
            "quality": build_run_quality_summary(run_payload),
        }
    except CommandFailure as exc:
        failure = classify_run_failure(exc.detail)
        return {
            "label": spec["label"],
            "command": spec["command"],
            "source": spec["source"],
            "offline_substitute": spec.get("offline_substitute") is True,
            "status": "failed",
            "error": exc.detail,
            "failure_kind": failure["kind"],
            "failure_summary": failure["summary"],
            "failure_hint": failure["hint"],
        }


def compare_pair(*, workspace_dir: Path, left: dict, right: dict) -> dict:
    try:
        payload = run_nodex_command(
            ["ai", "compare", left["run_id"], right["run_id"], "--format", "json"],
            cwd=workspace_dir,
            expect_json=True,
        )
        return {
            "left_label": left["label"],
            "right_label": right["label"],
            "left_run_id": left["run_id"],
            "right_run_id": right["run_id"],
            "status": "ok",
            "comparison": payload["comparison"],
            "difference_details": build_comparison_difference_details(payload),
            "structure_details": build_comparison_structure_details(payload),
            "output": payload,
        }
    except CommandFailure as exc:
        return {
            "left_label": left["label"],
            "right_label": right["label"],
            "left_run_id": left["run_id"],
            "right_run_id": right["run_id"],
            "status": "failed",
            "error": exc.detail,
        }


class CommandFailure(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def run_nodex_command(
    args: list[str],
    *,
    cwd: Path,
    expect_json: bool,
):
    command = [
        "cargo",
        "run",
        "--manifest-path",
        str(MANIFEST_PATH),
        "--",
        *args,
    ]
    completed = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or str(
            completed.returncode
        )
        raise CommandFailure(detail)
    if not expect_json:
        return completed.stdout
    stdout = completed.stdout.strip()
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise CommandFailure(f"command did not return valid JSON: {exc}") from exc


def print_text_report(result: dict) -> None:
    print(f"Workspace: {result['workspace_dir']}")
    print(f"Scenario: {result['scenario']}")
    print(f"Node: {result['node_id']}")
    print(
        f"Runs: {result['successful_runs']} succeeded / {result['failed_runs']} failed / {result['runner_count']} total"
    )
    failure_metrics = result.get("failure_metrics") or {}
    if failure_metrics.get("counts"):
        counts = ", ".join(
            f"{kind}={count}" for kind, count in sorted(failure_metrics["counts"].items())
        )
        print(f"Failure kinds: {counts}")
    readiness = result.get("comparison_readiness") or {}
    if readiness:
        print(
            "Compare readiness: "
            f"{readiness.get('status', 'unknown')} "
            f"(comparable_pairs={readiness.get('comparable_pairs', 0)}, "
            f"blocked_pairs={readiness.get('blocked_pairs', 0)})"
        )
    comparison_metrics = result.get("comparison_metrics") or {}
    if comparison_metrics.get("compared_pairs"):
        print(
            "Compare metrics: "
            f"pairs={comparison_metrics.get('compared_pairs', 0)}, "
            f"differing_pairs={comparison_metrics.get('differing_pairs', 0)}"
        )
    scenario_context = result.get("scenario_context")
    if isinstance(scenario_context, dict):
        target_node = scenario_context.get("target_node") or {}
        evidence = scenario_context.get("evidence") or {}
        print(f"Target node title: {target_node.get('title', '(unknown)')}")
        print(f"Evidence chunk: {evidence.get('chunk_label', '(unknown)')}")
    print()
    print("[runs]")
    for item in result["runs"]:
        print(f"- {item['label']}: {item['status']}")
        print(f"  command: {item['command']}")
        if item["status"] != "ok":
            print(f"  error: {item['error']}")
            if item.get("failure_kind"):
                print(f"  blocker: {item['failure_kind']}")
            if item.get("failure_summary"):
                print(f"  summary: {item['failure_summary']}")
            if item.get("failure_hint"):
                print(f"  hint: {item['failure_hint']}")
            continue
        metadata = item["metadata"]
        explanation = item["report"]["explanation"]
        summary = item["report"]["report"]["summary"] or "(no summary)"
        print(f"  run id: {item['run_id']}")
        print(f"  provider: {metadata.get('provider') or '(unknown)'}")
        print(f"  model: {metadata.get('model') or '(unknown)'}")
        print(f"  patch summary: {summary}")
        print(f"  rationale: {explanation['rationale_summary']}")
        print(
            f"  fallback: {item['quality']['used_plain_json_fallback']} "
            f"(notes={item['quality']['normalization_note_count']})"
        )

    if not result["comparisons"]:
        print()
        print("[comparisons]")
        print("Not enough successful runs to compare.")
        blocked = result.get("blocked_comparisons") or []
        if blocked:
            print()
            print("[blocked comparisons]")
            for item in blocked:
                print(f"- {item['left_label']} vs {item['right_label']}: blocked")
                for blocker in item.get("blocked_by") or []:
                    label = blocker.get("label", "(unknown)")
                    kind = blocker.get("kind") or "unknown"
                    print(f"  blocker: {label} -> {kind}")
                    if blocker.get("summary"):
                        print(f"  summary: {blocker['summary']}")
        return

    print()
    print("[comparisons]")
    for item in result["comparisons"]:
        print(f"- {item['left_label']} vs {item['right_label']}: {item['status']}")
        if item["status"] != "ok":
            print(f"  error: {item['error']}")
            continue
        summary = item["comparison"]
        print(f"  same fallback flag: {summary['same_used_plain_json_fallback']}")
        print(f"  same normalization notes: {summary['same_normalization_notes']}")
        print(f"  same rationale: {summary['same_rationale_summary']}")
        print(f"  same patch summary: {summary['same_patch_summary']}")
        print(f"  same patch preview: {summary['same_patch_preview']}")
        print(f"  same response notes: {summary['same_response_notes']}")
        if summary.get("difference_kinds"):
            print(f"  difference kinds: {', '.join(summary['difference_kinds'])}")
        details = item.get("difference_details") or {}
        if details.get("patch_summary"):
            detail = details["patch_summary"]
            print(
                f"  patch summary detail: left={detail.get('left')!r} right={detail.get('right')!r}"
            )
        if details.get("patch_preview"):
            detail = details["patch_preview"]
            print(
                "  patch preview detail: "
                f"left_count={detail.get('left_count', 0)} "
                f"right_count={detail.get('right_count', 0)}"
            )
        if details.get("response_notes"):
            detail = details["response_notes"]
            print(
                "  response note detail: "
                f"left_only={len(detail.get('left_only') or [])} "
                f"right_only={len(detail.get('right_only') or [])}"
            )
    blocked = result.get("blocked_comparisons") or []
    if blocked:
        print()
        print("[blocked comparisons]")
        for item in blocked:
            print(f"- {item['left_label']} vs {item['right_label']}: blocked")
            for blocker in item.get("blocked_by") or []:
                label = blocker.get("label", "(unknown)")
                kind = blocker.get("kind") or "unknown"
                print(f"  blocker: {label} -> {kind}")
                if blocker.get("summary"):
                    print(f"  summary: {blocker['summary']}")


def print_fixture_set_report(result: dict) -> None:
    print(f"Fixture set: {result['fixture_set']}")
    aggregate = result["aggregate"]
    print(
        f"Cases: {aggregate['successful_cases']} succeeded / {aggregate['failed_cases']} failed / {aggregate['total_cases']} total"
    )
    print(
        f"Patch legal rate: {aggregate['patch_legal_rate']:.2f}, direct evidence cases: {aggregate['direct_evidence_cases']}, explainability complete cases: {aggregate['explainability_complete_cases']}, fallback cases: {aggregate['fallback_used_cases']}, normalization-note cases: {aggregate['normalization_note_cases']}"
    )
    print(
        "Blocked comparison cases: "
        f"{aggregate['blocked_comparison_cases']}, "
        f"blocked pairs: {aggregate['blocked_comparison_pairs']}"
    )
    print(
        "Compared pairs: "
        f"{aggregate['compared_pairs']}, "
        f"differing pairs: {aggregate['differing_pairs']}"
    )
    print()
    print("[cases]")
    for case in result["cases"]:
        title = case["scenario_context"]["target_node"]["title"]
        print(f"- {case['case_id']}: {title}")
        for item in case["runs"]:
            print(f"  - {item['label']}: {item['status']}")
            if item["status"] != "ok":
                print(f"    error: {item['error']}")
                continue
            quality = item["quality"]
            print(
                f"    patch_legal={quality['patch_legal']} direct_evidence={quality['direct_evidence_count']} explainability_complete={quality['explainability_complete']} fallback={quality['used_plain_json_fallback']} normalization_notes={quality['normalization_note_count']}"
            )
        readiness = case.get("comparison_readiness") or {}
        if readiness.get("blocked_pairs"):
            print(
                "    blocked_pairs="
                f"{readiness['blocked_pairs']} blocker_kinds={','.join(readiness.get('blocker_kinds') or [])}"
            )
        comparison_metrics = case.get("comparison_metrics") or {}
        if comparison_metrics.get("differing_pairs"):
            print(
                "    differing_pairs="
                f"{comparison_metrics['differing_pairs']} difference_kinds="
                f"{','.join(sorted((comparison_metrics.get('difference_kind_counts') or {}).keys()))}"
            )


def build_run_quality_summary(run_payload: dict) -> dict:
    explanation = run_payload.get("explanation") or {}
    report = run_payload.get("report") or {}
    metadata = run_payload.get("metadata", {}) or {}
    direct_evidence = explanation.get("direct_evidence") or []
    inferred = explanation.get("inferred_suggestions") or []
    rationale = explanation.get("rationale_summary") or ""
    preview = report.get("preview") or []
    normalization_notes = metadata.get("normalization_notes") or []
    return {
        "patch_legal": metadata.get("status") == "dry_run_succeeded",
        "patch_op_count": len(preview) if isinstance(preview, list) else 0,
        "direct_evidence_count": len(direct_evidence) if isinstance(direct_evidence, list) else 0,
        "has_direct_evidence": bool(direct_evidence),
        "inferred_suggestions_count": len(inferred) if isinstance(inferred, list) else 0,
        "used_plain_json_fallback": metadata.get("used_plain_json_fallback") is True,
        "normalization_note_count": (
            len(normalization_notes) if isinstance(normalization_notes, list) else 0
        ),
        "has_normalization_notes": bool(normalization_notes),
        "normalization_notes": (
            normalization_notes if isinstance(normalization_notes, list) else []
        ),
        "rationale_present": isinstance(rationale, str) and bool(rationale.strip()),
        "explainability_complete": (
            isinstance(rationale, str)
            and bool(rationale.strip())
            and isinstance(inferred, list)
            and isinstance(direct_evidence, list)
        ),
    }


def aggregate_runner_metrics(runs: list[dict]) -> dict:
    return {
        item["label"]: item.get("quality")
        for item in runs
        if item.get("status") == "ok"
    }


def aggregate_comparison_metrics(comparisons: list[dict]) -> dict:
    successful = [item for item in comparisons if item.get("status") == "ok"]
    difference_kind_counts: dict[str, int] = {}
    differing_pairs = 0
    for item in successful:
        kinds = item.get("comparison", {}).get("difference_kinds") or []
        if kinds:
            differing_pairs += 1
        for kind in kinds:
            difference_kind_counts[kind] = difference_kind_counts.get(kind, 0) + 1
    return {
        "compared_pairs": len(successful),
        "differing_pairs": differing_pairs,
        "identical_pairs": len(successful) - differing_pairs,
        "difference_kind_counts": difference_kind_counts,
    }


def aggregate_fixture_set_metrics(case_results: list[dict]) -> dict:
    total_cases = len(case_results)
    successful_cases = 0
    direct_evidence_cases = 0
    explainability_complete_cases = 0
    failed_cases = 0
    compare_difference_cases = 0
    fallback_used_cases = 0
    normalization_note_cases = 0
    blocked_comparison_cases = 0
    blocked_comparison_pairs = 0
    blocked_comparison_kinds: dict[str, int] = {}
    compared_pairs = 0
    differing_pairs = 0
    compare_difference_kind_counts: dict[str, int] = {}

    for case in case_results:
        runs = case.get("runs") or []
        if all(item.get("status") == "ok" for item in runs):
            successful_cases += 1
        else:
            failed_cases += 1

        if any(
            item.get("quality", {}).get("has_direct_evidence") is True for item in runs
        ):
            direct_evidence_cases += 1

        if any(
            item.get("quality", {}).get("explainability_complete") is True
            for item in runs
        ):
            explainability_complete_cases += 1

        if any(
            item.get("quality", {}).get("used_plain_json_fallback") is True
            for item in runs
        ):
            fallback_used_cases += 1

        if any(
            item.get("quality", {}).get("has_normalization_notes") is True
            for item in runs
        ):
            normalization_note_cases += 1

        comparisons = case.get("comparisons") or []
        comparison_metrics = case.get("comparison_metrics") or {}
        compared_pairs += comparison_metrics.get("compared_pairs", 0)
        differing_pairs += comparison_metrics.get("differing_pairs", 0)
        for kind, count in (comparison_metrics.get("difference_kind_counts") or {}).items():
            compare_difference_kind_counts[kind] = (
                compare_difference_kind_counts.get(kind, 0) + count
            )
        if any(
            item.get("status") == "ok"
            and (
                not item["comparison"]["same_used_plain_json_fallback"]
                or not item["comparison"]["same_normalization_notes"]
                or not item["comparison"]["same_rationale_summary"]
                or not item["comparison"]["same_patch_preview"]
                or not item["comparison"]["same_response_notes"]
            )
            for item in comparisons
        ):
            compare_difference_cases += 1

        blocked = case.get("blocked_comparisons") or []
        if blocked:
            blocked_comparison_cases += 1
            blocked_comparison_pairs += len(blocked)
            for item in blocked:
                for blocker in item.get("blocked_by") or []:
                    kind = blocker.get("kind") or "unknown"
                    blocked_comparison_kinds[kind] = (
                        blocked_comparison_kinds.get(kind, 0) + 1
                    )

    return {
        "total_cases": total_cases,
        "successful_cases": successful_cases,
        "failed_cases": failed_cases,
        "patch_legal_rate": successful_cases / total_cases if total_cases else 0,
        "direct_evidence_cases": direct_evidence_cases,
        "explainability_complete_cases": explainability_complete_cases,
        "fallback_used_cases": fallback_used_cases,
        "normalization_note_cases": normalization_note_cases,
        "compare_difference_cases": compare_difference_cases,
        "blocked_comparison_cases": blocked_comparison_cases,
        "blocked_comparison_pairs": blocked_comparison_pairs,
        "blocked_comparison_kinds": blocked_comparison_kinds,
        "compared_pairs": compared_pairs,
        "differing_pairs": differing_pairs,
        "compare_difference_kind_counts": compare_difference_kind_counts,
    }


def build_runner_blocker(run: dict) -> dict:
    return {
        "label": run.get("label"),
        "status": run.get("status"),
        "kind": run.get("failure_kind"),
        "summary": run.get("failure_summary"),
        "hint": run.get("failure_hint"),
    }


def build_blocked_comparisons(runs: list[dict]) -> list[dict]:
    blocked = []
    for left, right in itertools.combinations(runs, 2):
        blockers = []
        if left.get("status") != "ok":
            blockers.append(build_runner_blocker(left))
        if right.get("status") != "ok":
            blockers.append(build_runner_blocker(right))
        if not blockers:
            continue
        blocked.append(
            {
                "left_label": left["label"],
                "right_label": right["label"],
                "left_status": left.get("status"),
                "right_status": right.get("status"),
                "status": "blocked",
                "blocked_by": blockers,
                "blocker_kinds": [item.get("kind") or "unknown" for item in blockers],
            }
        )
    return blocked


def normalize_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def build_list_difference_details(left: Any, right: Any) -> dict:
    left_list = normalize_str_list(left)
    right_list = normalize_str_list(right)
    left_set = set(left_list)
    right_set = set(right_list)
    return {
        "left": left_list,
        "right": right_list,
        "shared": [item for item in left_list if item in right_set],
        "left_only": [item for item in left_list if item not in right_set],
        "right_only": [item for item in right_list if item not in left_set],
    }


def build_value_counts(values: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def normalize_patch_ops(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def normalize_optional_str(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def normalize_compact_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        normalized_item = normalize_optional_str(item)
        if normalized_item is not None:
            normalized.append(normalized_item)
    return normalized


def build_overlap_lists(left_values: list[str], right_values: list[str]) -> dict[str, list[str]]:
    right_remaining = collections.Counter(right_values)
    left_remaining = collections.Counter(left_values)
    shared = []
    left_only = []
    right_only = []

    for item in left_values:
        if right_remaining[item] > 0:
            shared.append(item)
            right_remaining[item] -= 1
        else:
            left_only.append(item)

    for item in right_values:
        if left_remaining[item] > 0:
            left_remaining[item] -= 1
        else:
            right_only.append(item)

    return {
        "shared": shared,
        "left_only": left_only,
        "right_only": right_only,
    }


def safe_overlap_ratio(shared_count: int, left_count: int, right_count: int) -> float:
    denominator = max(left_count, right_count)
    if denominator <= 0:
        return 1.0
    return shared_count / denominator


def build_patch_op_position_details(left_ops: list[dict], right_ops: list[dict]) -> dict:
    aligned_positions = min(len(left_ops), len(right_ops))
    title_match_count = 0
    kind_match_count = 0
    body_match_count = 0
    differing_positions = []

    for index in range(aligned_positions):
        left_op = left_ops[index]
        right_op = right_ops[index]
        left_title = normalize_optional_str(left_op.get("title"))
        right_title = normalize_optional_str(right_op.get("title"))
        left_kind = normalize_optional_str(left_op.get("kind"))
        right_kind = normalize_optional_str(right_op.get("kind"))
        left_body = normalize_optional_str(left_op.get("body"))
        right_body = normalize_optional_str(right_op.get("body"))

        title_match = left_title == right_title
        kind_match = left_kind == right_kind
        body_match = left_body == right_body

        if title_match:
            title_match_count += 1
        if kind_match:
            kind_match_count += 1
        if body_match:
            body_match_count += 1

        if title_match and kind_match and body_match:
            continue

        differing_positions.append(
            {
                "position": index,
                "title_match": title_match,
                "left_title": left_title,
                "right_title": right_title,
                "kind_match": kind_match,
                "left_kind": left_kind,
                "right_kind": right_kind,
                "body_match": body_match,
                "left_body": left_body,
                "right_body": right_body,
            }
        )

    return {
        "aligned_positions": aligned_positions,
        "title_match_count": title_match_count,
        "kind_match_count": kind_match_count,
        "body_match_count": body_match_count,
        "differing_positions": differing_positions,
        "left_extra_positions": list(range(aligned_positions, len(left_ops))),
        "right_extra_positions": list(range(aligned_positions, len(right_ops))),
    }


def build_patch_ops_structure(left: Any, right: Any) -> dict:
    left_ops = normalize_patch_ops(left)
    right_ops = normalize_patch_ops(right)
    left_titles = [item["title"] for item in left_ops if isinstance(item.get("title"), str)]
    right_titles = [item["title"] for item in right_ops if isinstance(item.get("title"), str)]
    normalized_left_titles = [
        title
        for item in left_ops
        if (title := normalize_optional_str(item.get("title"))) is not None
    ]
    normalized_right_titles = [
        title
        for item in right_ops
        if (title := normalize_optional_str(item.get("title"))) is not None
    ]
    left_kinds = [item["kind"] for item in left_ops if isinstance(item.get("kind"), str)]
    right_kinds = [
        item["kind"] for item in right_ops if isinstance(item.get("kind"), str)
    ]
    left_types = [item["type"] for item in left_ops if isinstance(item.get("type"), str)]
    right_types = [
        item["type"] for item in right_ops if isinstance(item.get("type"), str)
    ]
    left_bodies = [
        item["body"]
        for item in left_ops
        if isinstance(item.get("body"), str) and item["body"].strip()
    ]
    right_bodies = [
        item["body"]
        for item in right_ops
        if isinstance(item.get("body"), str) and item["body"].strip()
    ]
    normalized_left_bodies = [
        body
        for item in left_ops
        if (body := normalize_optional_str(item.get("body"))) is not None
    ]
    normalized_right_bodies = [
        body
        for item in right_ops
        if (body := normalize_optional_str(item.get("body"))) is not None
    ]
    left_body_count = len(left_bodies)
    right_body_count = len(right_bodies)
    position_details = build_patch_op_position_details(left_ops, right_ops)
    title_mismatch_positions = [
        item["position"]
        for item in position_details["differing_positions"]
        if not item["title_match"]
    ]
    kind_mismatch_positions = [
        item["position"]
        for item in position_details["differing_positions"]
        if not item["kind_match"]
    ]
    body_mismatch_positions = [
        item["position"]
        for item in position_details["differing_positions"]
        if not item["body_match"]
    ]
    title_overlap = build_overlap_lists(normalized_left_titles, normalized_right_titles)
    body_overlap = build_overlap_lists(normalized_left_bodies, normalized_right_bodies)
    shared_title_count = len(title_overlap["shared"])
    shared_body_count = len(body_overlap["shared"])
    return {
        "left_count": len(left_ops),
        "right_count": len(right_ops),
        "same_count": len(left_ops) == len(right_ops),
        "left_title_count": len(left_titles),
        "right_title_count": len(right_titles),
        "shared_title_count": len(set(left_titles) & set(right_titles)),
        "same_title_sequence": left_titles == right_titles,
        "left_kind_counts": build_value_counts(left_kinds),
        "right_kind_counts": build_value_counts(right_kinds),
        "same_kind_counts": build_value_counts(left_kinds)
        == build_value_counts(right_kinds),
        "left_type_counts": build_value_counts(left_types),
        "right_type_counts": build_value_counts(right_types),
        "same_type_counts": build_value_counts(left_types)
        == build_value_counts(right_types),
        "left_body_count": left_body_count,
        "right_body_count": right_body_count,
        "shared_body_count": len(set(left_bodies) & set(right_bodies)),
        "same_body_sequence": left_bodies == right_bodies,
        "shape_aligned": (
            len(left_ops) == len(right_ops)
            and build_value_counts(left_kinds) == build_value_counts(right_kinds)
            and build_value_counts(left_types) == build_value_counts(right_types)
        ),
        "title_overlap_ratio": safe_overlap_ratio(
            shared_title_count,
            len(left_titles),
            len(right_titles),
        ),
        "body_overlap_ratio": safe_overlap_ratio(
            shared_body_count,
            left_body_count,
            right_body_count,
        ),
        "field_mismatch_counts": {
            "title": len(title_mismatch_positions),
            "kind": len(kind_mismatch_positions),
            "body": len(body_mismatch_positions),
            "left_extra": len(position_details["left_extra_positions"]),
            "right_extra": len(position_details["right_extra_positions"]),
        },
        "field_mismatch_positions": {
            "title": title_mismatch_positions,
            "kind": kind_mismatch_positions,
            "body": body_mismatch_positions,
            "left_extra": position_details["left_extra_positions"],
            "right_extra": position_details["right_extra_positions"],
        },
        "position_details": position_details,
    }


def normalize_direct_evidence_refs(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    refs = []
    for item in value:
        if not isinstance(item, dict):
            continue
        source_id = item.get("source_id")
        chunk_id = item.get("chunk_id")
        if isinstance(source_id, str) and source_id and isinstance(chunk_id, str) and chunk_id:
            refs.append(f"{source_id}:{chunk_id}")
    return refs


def build_explanation_structure(left: Any, right: Any) -> dict:
    left_evidence_refs = normalize_direct_evidence_refs(
        (left or {}).get("direct_evidence")
    )
    right_evidence_refs = normalize_direct_evidence_refs(
        (right or {}).get("direct_evidence")
    )
    left_inferred = normalize_str_list((left or {}).get("inferred_suggestions"))
    right_inferred = normalize_str_list((right or {}).get("inferred_suggestions"))
    normalized_left_inferred = normalize_compact_str_list(
        (left or {}).get("inferred_suggestions")
    )
    normalized_right_inferred = normalize_compact_str_list(
        (right or {}).get("inferred_suggestions")
    )
    left_evidence_set = set(left_evidence_refs)
    right_evidence_set = set(right_evidence_refs)
    left_inferred_set = set(left_inferred)
    right_inferred_set = set(right_inferred)
    shared_direct_evidence_refs = [
        item for item in left_evidence_refs if item in right_evidence_set
    ]
    left_only_direct_evidence_refs = [
        item for item in left_evidence_refs if item not in right_evidence_set
    ]
    right_only_direct_evidence_refs = [
        item for item in right_evidence_refs if item not in left_evidence_set
    ]
    shared_inferred_suggestions = [
        item for item in left_inferred if item in right_inferred_set
    ]
    left_only_inferred_suggestions = [
        item for item in left_inferred if item not in right_inferred_set
    ]
    right_only_inferred_suggestions = [
        item for item in right_inferred if item not in left_inferred_set
    ]
    direct_evidence_overlap = build_overlap_lists(left_evidence_refs, right_evidence_refs)
    inferred_overlap = build_overlap_lists(
        normalized_left_inferred,
        normalized_right_inferred,
    )
    return {
        "left_direct_evidence_count": len(left_evidence_refs),
        "right_direct_evidence_count": len(right_evidence_refs),
        "shared_direct_evidence_count": len(shared_direct_evidence_refs),
        "same_direct_evidence_count": len(left_evidence_refs)
        == len(right_evidence_refs),
        "shared_direct_evidence_refs": shared_direct_evidence_refs,
        "left_only_direct_evidence_refs": left_only_direct_evidence_refs,
        "right_only_direct_evidence_refs": right_only_direct_evidence_refs,
        "left_only_direct_evidence_count": len(direct_evidence_overlap["left_only"]),
        "right_only_direct_evidence_count": len(direct_evidence_overlap["right_only"]),
        "direct_evidence_overlap_ratio": safe_overlap_ratio(
            len(direct_evidence_overlap["shared"]),
            len(left_evidence_refs),
            len(right_evidence_refs),
        ),
        "left_inferred_suggestions_count": len(left_inferred),
        "right_inferred_suggestions_count": len(right_inferred),
        "same_inferred_suggestions_count": len(left_inferred) == len(right_inferred),
        "shared_inferred_suggestions": shared_inferred_suggestions,
        "left_only_inferred_suggestions": left_only_inferred_suggestions,
        "right_only_inferred_suggestions": right_only_inferred_suggestions,
        "shared_inferred_suggestions_count": len(inferred_overlap["shared"]),
        "left_only_inferred_suggestions_count": len(inferred_overlap["left_only"]),
        "right_only_inferred_suggestions_count": len(inferred_overlap["right_only"]),
        "inferred_overlap_ratio": safe_overlap_ratio(
            len(inferred_overlap["shared"]),
            len(normalized_left_inferred),
            len(normalized_right_inferred),
        ),
    }


def categorize_note(note: str) -> str:
    if note.startswith("runner_normalized:"):
        return "runner_normalized"
    if note.startswith("offline_compare_stub:") or note.startswith(
        "offline_compare_scenario:"
    ):
        return "offline_compare_marker"
    if "offline compare branch count=" in note:
        return "branch_count"
    return "plain_text"


def build_note_structure(left: Any, right: Any) -> dict:
    left_notes = normalize_str_list(left)
    right_notes = normalize_str_list(right)
    left_category_counts = build_value_counts(
        [categorize_note(note) for note in left_notes]
    )
    right_category_counts = build_value_counts(
        [categorize_note(note) for note in right_notes]
    )
    return {
        "left_count": len(left_notes),
        "right_count": len(right_notes),
        "same_count": len(left_notes) == len(right_notes),
        "left_category_counts": left_category_counts,
        "right_category_counts": right_category_counts,
        "same_category_counts": left_category_counts == right_category_counts,
    }


def build_rationale_structure(left: Any, right: Any) -> dict:
    left_value = left if isinstance(left, str) else ""
    right_value = right if isinstance(right, str) else ""
    return {
        "left_length": len(left_value),
        "right_length": len(right_value),
        "same_length": len(left_value) == len(right_value),
    }


def build_comparison_difference_details(payload: dict) -> dict:
    comparison = payload.get("comparison") or {}
    difference_kinds = comparison.get("difference_kinds") or []
    left = payload.get("left") or {}
    right = payload.get("right") or {}
    left_record = left.get("record") or {}
    right_record = right.get("record") or {}
    left_explanation = left.get("explanation") or {}
    right_explanation = right.get("explanation") or {}
    left_patch = left.get("patch") or {}
    right_patch = right.get("patch") or {}

    details = {}
    if "used_plain_json_fallback" in difference_kinds:
        details["used_plain_json_fallback"] = {
            "left": left_record.get("used_plain_json_fallback") is True,
            "right": right_record.get("used_plain_json_fallback") is True,
        }
    if "normalization_notes" in difference_kinds:
        details["normalization_notes"] = build_list_difference_details(
            left_record.get("normalization_notes"),
            right_record.get("normalization_notes"),
        )
    if "rationale_summary" in difference_kinds:
        left_value = left_explanation.get("rationale_summary")
        right_value = right_explanation.get("rationale_summary")
        details["rationale_summary"] = {
            "left": left_value,
            "right": right_value,
            "left_length": len(left_value) if isinstance(left_value, str) else 0,
            "right_length": len(right_value) if isinstance(right_value, str) else 0,
        }
    if "patch_summary" in difference_kinds:
        details["patch_summary"] = {
            "left": left_patch.get("summary"),
            "right": right_patch.get("summary"),
        }
    if "patch_preview" in difference_kinds:
        patch_preview = build_list_difference_details(
            left.get("patch_preview"),
            right.get("patch_preview"),
        )
        patch_preview["left_count"] = len(patch_preview["left"])
        patch_preview["right_count"] = len(patch_preview["right"])
        details["patch_preview"] = patch_preview
    if "response_notes" in difference_kinds:
        details["response_notes"] = build_list_difference_details(
            left.get("response_notes"),
            right.get("response_notes"),
        )
    return details


def build_comparison_structure_details(payload: dict) -> dict:
    left = payload.get("left") or {}
    right = payload.get("right") or {}
    left_record = left.get("record") or {}
    right_record = right.get("record") or {}
    left_explanation = left.get("explanation") or {}
    right_explanation = right.get("explanation") or {}
    left_patch = left.get("patch") or {}
    right_patch = right.get("patch") or {}

    return {
        "patch_ops": build_patch_ops_structure(
            left_patch.get("ops"),
            right_patch.get("ops"),
        ),
        "explanation": build_explanation_structure(
            left_explanation,
            right_explanation,
        ),
        "response_notes": build_note_structure(
            left.get("response_notes"),
            right.get("response_notes"),
        ),
        "normalization_notes": build_note_structure(
            left_record.get("normalization_notes"),
            right_record.get("normalization_notes"),
        ),
        "rationale_summary": build_rationale_structure(
            left_explanation.get("rationale_summary"),
            right_explanation.get("rationale_summary"),
        ),
    }


def build_comparison_readiness(
    *,
    runs: list[dict],
    comparisons: list[dict],
    blocked_comparisons: list[dict],
) -> dict:
    blocker_counts: dict[str, int] = {}
    blocker_kinds: list[str] = []
    for item in blocked_comparisons:
        for blocker in item.get("blocked_by") or []:
            kind = blocker.get("kind") or "unknown"
            blocker_counts[kind] = blocker_counts.get(kind, 0) + 1
            if kind not in blocker_kinds:
                blocker_kinds.append(kind)

    if comparisons and blocked_comparisons:
        status = "partial"
    elif comparisons:
        status = "ready"
    else:
        status = "blocked"

    return {
        "status": status,
        "compare_ready": bool(comparisons),
        "all_pairs_compared": not blocked_comparisons,
        "runner_count": len(runs),
        "successful_runner_labels": [
            item["label"] for item in runs if item.get("status") == "ok"
        ],
        "failed_runner_labels": [
            item["label"] for item in runs if item.get("status") != "ok"
        ],
        "attempted_pairs": len(comparisons) + len(blocked_comparisons),
        "comparable_pairs": len(comparisons),
        "blocked_pairs": len(blocked_comparisons),
        "blocker_kinds": blocker_kinds,
        "blocker_counts": blocker_counts,
    }


def classify_run_failure(detail: str) -> dict:
    stripped = detail.strip()
    lower = stripped.lower()
    dependency_match = re.search(r"Missing `([^`]+)`", stripped)
    if dependency_match:
        package = dependency_match.group(1)
        return {
            "kind": "missing_dependency",
            "summary": f"Missing Python package: {package}",
            "hint": f"Install it with `python3 -m pip install -U {package}`.",
        }
    if "[preflight]" in stripped and "no configured auth" in lower:
        return {
            "kind": "auth_missing",
            "summary": "No provider credentials are configured.",
            "hint": "Run `python3 scripts/provider_doctor.py --provider <provider>` and set the required auth env var.",
        }
    if "[auth]" in stripped and "invalid api key" in lower:
        return {
            "kind": "auth_invalid",
            "summary": "Provider rejected the configured API key.",
            "hint": "Refresh the provider API key in the environment or `.env.local`, then rerun compare.",
        }
    if "[auth]" in stripped:
        return {
            "kind": "auth_error",
            "summary": "Authentication failed before the runner could complete.",
            "hint": "Check provider credentials and retry.",
        }
    if "[config]" in stripped:
        return {
            "kind": "config_error",
            "summary": "Runner configuration is incomplete or incompatible.",
            "hint": "Review the runner error detail and local provider/runtime setup.",
        }
    if "command did not return valid json" in lower:
        return {
            "kind": "invalid_json",
            "summary": "Runner completed without valid JSON output.",
            "hint": "Inspect the runner stdout/stderr and contract response formatting.",
        }
    return {
        "kind": "runner_error",
        "summary": "Runner failed before compare could collect artifacts.",
        "hint": None,
    }


def aggregate_failure_metrics(runs: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for item in runs:
        if item.get("status") != "failed":
            continue
        kind = item.get("failure_kind") or "unknown"
        counts[kind] = counts.get(kind, 0) + 1
    return {
        "counts": counts,
        "failed_labels": [item["label"] for item in runs if item.get("status") == "failed"],
    }


if __name__ == "__main__":
    raise SystemExit(main())
