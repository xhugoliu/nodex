#!/usr/bin/env python3

import argparse
import itertools
import json
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

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
) -> list[dict]:
    specs: list[dict] = []
    seen_labels: set[str] = set()

    for preset_name in preset_names:
        preset = preset_runners()[preset_name]
        for label, command in preset:
            if label in seen_labels:
                raise SystemExit(
                    f"[config] duplicate runner label `{label}` from preset `{preset_name}`"
                )
            specs.append({"label": label, "command": command, "source": preset_name})
            seen_labels.add(label)

    for label, command in explicit_specs:
        if label in seen_labels:
            raise SystemExit(f"[config] duplicate runner label `{label}`")
        specs.append({"label": label, "command": command, "source": "explicit"})
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

    runner_specs = build_runner_specs(
        preset_names=args.preset,
        explicit_specs=args.runner,
    )
    if len(runner_specs) < 2:
        parser.error("at least two runners are required")

    if args.fixture_set:
        result = run_fixture_set_compare(
            runner_specs=runner_specs,
            fixture_set_name=args.fixture_set,
        )
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
    }
    if scenario_payload is not None:
        result["scenario_context"] = scenario_payload
    result["runner_metrics"] = aggregate_runner_metrics(runs)
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
            case_results.append(
                {
                    "case_id": case["id"],
                    "workspace_dir": str(workspace_dir),
                    "scenario": "source-context",
                    "node_id": effective_node_id,
                    "scenario_context": scenario_payload,
                    "runs": runs,
                    "comparisons": comparisons,
                    "runner_metrics": aggregate_runner_metrics(runs),
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
            "status": "ok",
            "run_id": run_id,
            "metadata": metadata,
            "report": run_payload,
            "show": show_payload,
            "quality": build_run_quality_summary(run_payload),
        }
    except CommandFailure as exc:
        return {
            "label": spec["label"],
            "command": spec["command"],
            "source": spec["source"],
            "status": "failed",
            "error": exc.detail,
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
        return

    print()
    print("[comparisons]")
    for item in result["comparisons"]:
        print(f"- {item['left_label']} vs {item['right_label']}: {item['status']}")
        if item["status"] != "ok":
            print(f"  error: {item['error']}")
            continue
        summary = item["comparison"]
        print(f"  same rationale: {summary['same_rationale_summary']}")
        print(f"  same patch summary: {summary['same_patch_summary']}")
        print(f"  same patch preview: {summary['same_patch_preview']}")
        print(f"  same response notes: {summary['same_response_notes']}")


def print_fixture_set_report(result: dict) -> None:
    print(f"Fixture set: {result['fixture_set']}")
    aggregate = result["aggregate"]
    print(
        f"Cases: {aggregate['successful_cases']} succeeded / {aggregate['failed_cases']} failed / {aggregate['total_cases']} total"
    )
    print(
        f"Patch legal rate: {aggregate['patch_legal_rate']:.2f}, direct evidence cases: {aggregate['direct_evidence_cases']}, explainability complete cases: {aggregate['explainability_complete_cases']}, fallback cases: {aggregate['fallback_used_cases']}, normalization-note cases: {aggregate['normalization_note_cases']}"
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


def aggregate_fixture_set_metrics(case_results: list[dict]) -> dict:
    total_cases = len(case_results)
    successful_cases = 0
    direct_evidence_cases = 0
    explainability_complete_cases = 0
    failed_cases = 0
    compare_difference_cases = 0
    fallback_used_cases = 0
    normalization_note_cases = 0

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
        if any(
            item.get("status") == "ok"
            and (
                not item["comparison"]["same_rationale_summary"]
                or not item["comparison"]["same_patch_preview"]
                or not item["comparison"]["same_response_notes"]
            )
            for item in comparisons
        ):
            compare_difference_cases += 1

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
    }


if __name__ == "__main__":
    raise SystemExit(main())
