#!/usr/bin/env python3

import random
from pathlib import Path
from typing import Optional


def resolve_repo_root(script_path: Path) -> Path:
    return script_path.resolve().parent.parent


def load_env_defaults(candidates: list[Path]) -> Optional[Path]:
    import os

    loaded_path: Optional[Path] = None
    for candidate in candidates:
        if not candidate.exists():
            continue
        for raw_line in candidate.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)
        if loaded_path is None:
            loaded_path = candidate
    return loaded_path


def mask_value(value: str) -> str:
    if len(value) < 12:
        return "***"
    return f"{value[:6]}...{value[-6:]}"


def collect_prefixed_process_env(prefixes: tuple[str, ...]) -> dict[str, str]:
    import os

    return {
        key: value
        for key, value in sorted(os.environ.items())
        if any(key.startswith(prefix) for prefix in prefixes)
    }


def detect_shell_env_conflicts(prefixes: tuple[str, ...]) -> list[str]:
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
            if "=" not in stripped:
                continue
            if not any(prefix in stripped for prefix in prefixes):
                continue
            hits.append(f"{path}:{index}: {redact_assignment_line(stripped)}")
    return hits


def redact_assignment_line(line: str) -> str:
    if "=" not in line:
        return line
    key, _value = line.split("=", 1)
    return f"{key}=***"


def compute_backoff_seconds(*, attempt: int, base_seconds: float, max_seconds: float) -> float:
    exponential = min(base_seconds * (2**attempt), max_seconds)
    jitter = random.uniform(0, min(base_seconds, 1.0))
    return min(exponential + jitter, max_seconds)
