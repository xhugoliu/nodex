#!/usr/bin/env python3

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from provider_runtime import (
    collect_prefixed_process_env,
    detect_shell_env_conflicts,
    load_env_defaults,
    mask_value,
    resolve_repo_root,
)


DEFAULT_BASE_URL = "https://api.anthropic.com"
DEFAULT_MODEL = "claude-3-5-sonnet-latest"
DEFAULT_TIMEOUT_SECONDS = 120


@dataclass
class AnthropicContext:
    repo_root: Path
    env_file_path: Optional[Path]
    api_key: Optional[str]
    model: str
    base_url: str
    timeout_seconds: int
    process_anthropic_env: dict[str, str]
    shell_anthropic_env_candidates: list[str]

    def to_json_payload(self) -> dict:
        return {
            "repo_root": str(self.repo_root),
            "env_file_path": str(self.env_file_path) if self.env_file_path else None,
            "api_key": mask_value(self.api_key) if self.api_key else None,
            "model": self.model,
            "base_url": self.base_url,
            "timeout_seconds": self.timeout_seconds,
            "process_anthropic_env": {
                key: mask_value(value) for key, value in self.process_anthropic_env.items()
            },
            "shell_anthropic_env_candidates": self.shell_anthropic_env_candidates,
        }


def load_anthropic_context(
    *,
    script_path: Path,
    model_override: Optional[str] = None,
    base_url_override: Optional[str] = None,
    timeout_override: Optional[int] = None,
) -> AnthropicContext:
    repo_root = resolve_repo_root(script_path)
    env_file_path, env_defaults = load_env_defaults(
        [repo_root / ".env.local", repo_root / ".env"]
    )
    prefixes = ("ANTHROPIC_", "CLAUDE_CODE_", "API_TIMEOUT_MS")
    process_anthropic_env = collect_prefixed_process_env(prefixes)
    api_key = (
        env_defaults.get("ANTHROPIC_AUTH_TOKEN")
        or env_defaults.get("ANTHROPIC_API_KEY")
        or process_anthropic_env.get("ANTHROPIC_AUTH_TOKEN")
        or process_anthropic_env.get("ANTHROPIC_API_KEY")
    )
    model = (
        model_override
        or env_defaults.get("ANTHROPIC_MODEL")
        or process_anthropic_env.get("ANTHROPIC_MODEL")
        or DEFAULT_MODEL
    )
    base_url = (
        base_url_override
        or env_defaults.get("ANTHROPIC_BASE_URL")
        or process_anthropic_env.get("ANTHROPIC_BASE_URL")
        or DEFAULT_BASE_URL
    )
    timeout_seconds = timeout_override or _load_timeout_seconds(
        env_defaults=env_defaults,
        process_anthropic_env=process_anthropic_env,
    )

    return AnthropicContext(
        repo_root=repo_root,
        env_file_path=env_file_path,
        api_key=api_key,
        model=model,
        base_url=base_url,
        timeout_seconds=timeout_seconds,
        process_anthropic_env=process_anthropic_env,
        shell_anthropic_env_candidates=detect_shell_env_conflicts(
            ("ANTHROPIC_", "CLAUDE_CODE_")
        ),
    )


def _load_timeout_seconds(
    *,
    env_defaults: dict[str, str],
    process_anthropic_env: dict[str, str],
) -> int:
    timeout_seconds = env_defaults.get("ANTHROPIC_TIMEOUT_SECONDS") or process_anthropic_env.get(
        "ANTHROPIC_TIMEOUT_SECONDS"
    )
    if timeout_seconds:
        return int(timeout_seconds)
    timeout_ms = env_defaults.get("API_TIMEOUT_MS") or process_anthropic_env.get(
        "API_TIMEOUT_MS"
    )
    if timeout_ms:
        return max(1, int(timeout_ms) // 1000)
    return DEFAULT_TIMEOUT_SECONDS
