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


DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_TIMEOUT_SECONDS = 120


@dataclass
class OpenAIContext:
    repo_root: Path
    env_file_path: Optional[Path]
    api_key: Optional[str]
    model: str
    base_url: str
    reasoning_effort: Optional[str]
    timeout_seconds: int
    process_openai_env: dict[str, str]
    shell_openai_env_candidates: list[str]

    def to_json_payload(self) -> dict:
        return {
            "repo_root": str(self.repo_root),
            "env_file_path": str(self.env_file_path) if self.env_file_path else None,
            "api_key": mask_value(self.api_key) if self.api_key else None,
            "model": self.model,
            "base_url": self.base_url,
            "reasoning_effort": self.reasoning_effort,
            "timeout_seconds": self.timeout_seconds,
            "process_openai_env": {
                key: mask_value(value) for key, value in self.process_openai_env.items()
            },
            "shell_openai_env_candidates": self.shell_openai_env_candidates,
        }

def load_openai_context(
    *,
    script_path: Path,
    model_override: Optional[str] = None,
    base_url_override: Optional[str] = None,
    timeout_override: Optional[int] = None,
) -> OpenAIContext:
    repo_root = resolve_repo_root(script_path)
    env_file_path, env_defaults = load_env_defaults(
        [repo_root / ".env.local", repo_root / ".env"]
    )
    process_openai_env = collect_prefixed_process_env(("OPENAI_",))
    api_key = env_defaults.get("OPENAI_API_KEY") or process_openai_env.get("OPENAI_API_KEY")
    model = (
        model_override
        or env_defaults.get("OPENAI_MODEL")
        or process_openai_env.get("OPENAI_MODEL")
        or DEFAULT_MODEL
    )
    base_url = (
        base_url_override
        or env_defaults.get("OPENAI_BASE_URL")
        or process_openai_env.get("OPENAI_BASE_URL")
        or DEFAULT_BASE_URL
    )
    timeout_seconds = timeout_override or int(
        env_defaults.get("OPENAI_TIMEOUT_SECONDS")
        or process_openai_env.get("OPENAI_TIMEOUT_SECONDS")
        or str(DEFAULT_TIMEOUT_SECONDS)
    )
    reasoning_effort = env_defaults.get("OPENAI_REASONING_EFFORT") or process_openai_env.get(
        "OPENAI_REASONING_EFFORT"
    )

    return OpenAIContext(
        repo_root=repo_root,
        env_file_path=env_file_path,
        api_key=api_key,
        model=model,
        base_url=base_url,
        reasoning_effort=reasoning_effort,
        timeout_seconds=timeout_seconds,
        process_openai_env=process_openai_env,
        shell_openai_env_candidates=detect_shell_env_conflicts(("OPENAI_",)),
    )
