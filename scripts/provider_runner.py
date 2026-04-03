#!/usr/bin/env python3

import argparse
import subprocess
import sys
from pathlib import Path

from provider_registry import get_provider_entry, provider_names, runnable_provider_names


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dispatch to a concrete provider runner."
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Show supported providers and which ones currently have runnable entries.",
    )
    parser.add_argument(
        "--provider",
        choices=provider_names(),
        required=False,
        help="Which concrete provider runner to execute.",
    )
    args, passthrough = parser.parse_known_args()

    if args.list:
        print("Supported providers:")
        for provider in provider_names():
            marker = "runnable" if provider in runnable_provider_names() else "diagnostics-only"
            print(f"- {provider}: {marker}")
        return 0

    if not args.provider:
        parser.error("--provider is required unless --list is used")

    entry = get_provider_entry(args.provider)
    script_name = entry.runner_script
    if script_name is None:
        raise SystemExit(
            "[config] provider runner for "
            f"`{args.provider}` is not implemented yet; runnable providers: "
            + ", ".join(runnable_provider_names())
            + f". Try `python3 scripts/provider_doctor.py --provider {args.provider}` first."
        )

    runner_path = Path(__file__).resolve().parent / script_name
    command = [sys.executable, str(runner_path), *passthrough]
    completed = subprocess.run(command, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
