#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

from openai_context import load_openai_context


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect local OpenAI runner env/config inputs."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print diagnostics as JSON for automation.",
    )
    args = parser.parse_args()

    context = load_openai_context(script_path=Path(__file__))
    payload = context.to_json_payload()

    if args.json:
        print(json.dumps(payload, indent=2))
        return 0

    print("OpenAI doctor")
    print(f"- repo_root: {payload['repo_root']}")
    print(f"- env_file_path: {payload['env_file_path'] or '(none)'}")
    print(f"- api_key: {payload['api_key'] or '(unset)'}")
    print(f"- model: {payload['model']}")
    print(f"- base_url: {payload['base_url']}")
    print(f"- reasoning_effort: {payload['reasoning_effort'] or '(unset)'}")
    print(f"- timeout_seconds: {payload['timeout_seconds']}")

    if payload["process_openai_env"]:
        print("- process_openai_env:")
        for key, value in payload["process_openai_env"].items():
            print(f"  - {key}={value}")
    else:
        print("- process_openai_env: (none)")

    if payload["shell_openai_env_candidates"]:
        print("- shell_openai_env_candidates:")
        for hit in payload["shell_openai_env_candidates"]:
            print(f"  - {hit}")
    else:
        print("- shell_openai_env_candidates: (none)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
