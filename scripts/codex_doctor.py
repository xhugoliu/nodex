#!/usr/bin/env python3

import json
import os
from pathlib import Path

from codex_runner import (
    extract_codex_base_url,
    extract_top_level_assignment,
    get_codex_config_path,
    get_codex_login_status,
    read_codex_config_text,
)


def main() -> int:
    config_path = get_codex_config_path()
    config_text = read_codex_config_text(config_path)
    provider_name = extract_top_level_assignment(config_text, "model_provider")
    model = extract_top_level_assignment(config_text, "model")
    reasoning = extract_top_level_assignment(config_text, "model_reasoning_effort")
    base_url = extract_codex_base_url(config_text, provider_name)
    auth_path = config_path.parent / "auth.json"

    print("Codex doctor")
    print(f"- config_path: {config_path}")
    print(f"- config_exists: {config_path.exists()}")
    print(f"- auth_path: {auth_path}")
    print(f"- auth_exists: {auth_path.exists()}")
    print(f"- model_provider: {provider_name or '(unset)'}")
    print(f"- model: {model or '(unset)'}")
    print(f"- reasoning_effort: {reasoning or '(unset)'}")
    print(f"- base_url: {base_url or '(unset)'}")

    try:
        print(f"- login_status: {get_codex_login_status()}")
    except Exception as exc:  # pragma: no cover - diagnostics only
        print(f"- login_status: ERROR: {exc}")

    auth_key = load_masked_auth_key(auth_path)
    print(f"- auth_json_key: {auth_key or '(unset)'}")

    openai_env = {k: v for k, v in os.environ.items() if k.startswith("OPENAI_")}
    if openai_env:
        print("- process_openai_env:")
        for key, value in sorted(openai_env.items()):
            print(f"  - {key}={mask_value(value)}")
    else:
        print("- process_openai_env: (none)")

    shell_hits = detect_shell_conflicts()
    if shell_hits:
        print("- shell_openai_env_candidates:")
        for hit in shell_hits:
            print(f"  - {hit}")
    else:
        print("- shell_openai_env_candidates: (none)")

    return 0


def load_masked_auth_key(auth_path: Path) -> str:
    if not auth_path.exists():
        return ""
    try:
        payload = json.loads(auth_path.read_text())
    except Exception:
        return "<invalid json>"
    value = payload.get("OPENAI_API_KEY")
    if not isinstance(value, str) or not value:
        return ""
    return mask_value(value)


def mask_value(value: str) -> str:
    if len(value) < 12:
        return "***"
    return f"{value[:6]}...{value[-6:]}"


def detect_shell_conflicts() -> list[str]:
    home = Path.home()
    candidates = [
        home / ".zshrc",
        home / ".zprofile",
        home / ".bashrc",
        home / ".bash_profile",
        home / ".profile",
    ]
    hits = []
    for path in candidates:
        if not path.exists():
            continue
        try:
            lines = path.read_text().splitlines()
        except Exception:
            continue
        for index, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if "OPENAI_" not in stripped:
                continue
            if "=" not in stripped:
                continue
            hits.append(f"{path}:{index}: {redact_line(stripped)}")
    return hits


def redact_line(line: str) -> str:
    if "=" not in line:
        return line
    key, _value = line.split("=", 1)
    return f"{key}=***"


if __name__ == "__main__":
    raise SystemExit(main())
