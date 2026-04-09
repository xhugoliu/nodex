#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

from provider_registry import load_provider_payload, provider_names


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect local provider config/env diagnostics across Codex, Anthropic-compatible, OpenAI, and Gemini."
    )
    parser.add_argument(
        "--provider",
        choices=("all", *provider_names()),
        default="all",
        help="Which provider diagnostics to show.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print diagnostics as JSON for automation.",
    )
    args = parser.parse_args()

    payload = build_payload(args.provider)

    if args.json:
        print(json.dumps(payload, indent=2))
        return 0

    print("Provider doctor")
    for provider_name, provider_payload in payload.items():
        print(f"\n[{provider_name}]")
        summary = provider_payload.get("summary")
        if isinstance(summary, dict):
            print("- summary:")
            for sub_key, sub_value in summary.items():
                print(f"  - {sub_key}={sub_value}")
        for key, value in provider_payload.items():
            if key == "summary":
                continue
            if isinstance(value, dict):
                if value:
                    print(f"- {key}:")
                    for sub_key, sub_value in value.items():
                        print(f"  - {sub_key}={sub_value}")
                else:
                    print(f"- {key}: (none)")
            elif isinstance(value, list):
                if value:
                    print(f"- {key}:")
                    for item in value:
                        print(f"  - {item}")
                else:
                    print(f"- {key}: (none)")
            else:
                print(f"- {key}: {value if value is not None else '(unset)'}")

    return 0


def build_payload(provider: str) -> dict:
    repo_script = Path(__file__)
    if provider == "all":
        return {
            name: load_provider_payload(name, script_path=repo_script)
            for name in provider_names()
        }
    return {provider: load_provider_payload(provider, script_path=repo_script)}


if __name__ == "__main__":
    raise SystemExit(main())
