#!/usr/bin/env python3

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from codex_context import load_codex_context
from gemini_context import load_gemini_context
from openai_context import load_openai_context


ProviderLoader = Callable[[Path], dict]


@dataclass(frozen=True)
class ProviderEntry:
    name: str
    diagnostics_loader: ProviderLoader
    runner_script: Optional[str] = None
    default_smoke_args: tuple[str, ...] = ()


def _load_codex(script_path: Path) -> dict:
    return load_codex_context().to_json_payload()


def _load_openai(script_path: Path) -> dict:
    return load_openai_context(script_path=script_path).to_json_payload()


def _load_gemini(script_path: Path) -> dict:
    return load_gemini_context(script_path=script_path).to_json_payload()


PROVIDER_ENTRIES: tuple[ProviderEntry, ...] = (
    ProviderEntry(
        name="codex",
        diagnostics_loader=_load_codex,
        runner_script="codex_runner.py",
        default_smoke_args=(
            "--mode",
            "plain",
            "--reasoning-effort",
            "low",
            "--max-retries",
            "3",
        ),
    ),
    ProviderEntry(
        name="openai",
        diagnostics_loader=_load_openai,
        runner_script="openai_runner.py",
    ),
    ProviderEntry(
        name="gemini",
        diagnostics_loader=_load_gemini,
        runner_script="gemini_runner.py",
    ),
)


def provider_names() -> tuple[str, ...]:
    return tuple(entry.name for entry in PROVIDER_ENTRIES)


def runnable_provider_names() -> tuple[str, ...]:
    return tuple(entry.name for entry in PROVIDER_ENTRIES if entry.runner_script)


def get_provider_entry(provider: str) -> ProviderEntry:
    for entry in PROVIDER_ENTRIES:
        if entry.name == provider:
            return entry
    raise KeyError(f"unsupported provider: {provider}")


def load_provider_payload(provider: str, *, script_path: Path) -> dict:
    entry = get_provider_entry(provider)
    payload = entry.diagnostics_loader(script_path)
    payload["summary"] = build_diagnostics_summary(entry, payload)
    return payload


def build_diagnostics_summary(entry: ProviderEntry, payload: dict) -> dict:
    process_env_key = next(
        (key for key in payload.keys() if key.startswith("process_") and key.endswith("_env")),
        None,
    )
    shell_conflict_key = next(
        (
            key
            for key in payload.keys()
            if key.startswith("shell_") and key.endswith("_candidates")
        ),
        None,
    )
    process_env = payload.get(process_env_key, {}) if process_env_key else {}
    shell_conflicts = payload.get(shell_conflict_key, []) if shell_conflict_key else []
    auth_value = payload.get("api_key") or payload.get("auth_json_key")

    return {
        "provider": entry.name,
        "runnable": entry.runner_script is not None,
        "has_auth": bool(auth_value),
        "has_process_env_conflict": bool(process_env),
        "has_shell_env_conflict": bool(shell_conflicts),
    }
