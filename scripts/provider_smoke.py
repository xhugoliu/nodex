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
    DEFAULT_FIXTURE_PATH,
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


def run_smoke(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    node_id: str,
    scenario: str,
    fixture_path: Optional[Path],
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
    return result


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
