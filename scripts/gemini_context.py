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


DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
DEFAULT_MODEL = "gemini-2.5-pro"


@dataclass
class GeminiContext:
    repo_root: Path
    env_file_path: Optional[Path]
    api_key: Optional[str]
    model: str
    base_url: str
    process_gemini_env: dict[str, str]
    shell_gemini_env_candidates: list[str]

    def to_json_payload(self) -> dict:
        return {
            "repo_root": str(self.repo_root),
            "env_file_path": str(self.env_file_path) if self.env_file_path else None,
            "api_key": mask_value(self.api_key) if self.api_key else None,
            "model": self.model,
            "base_url": self.base_url,
            "process_gemini_env": {
                key: mask_value(value) for key, value in self.process_gemini_env.items()
            },
            "shell_gemini_env_candidates": self.shell_gemini_env_candidates,
        }

def load_gemini_context(
    *,
    script_path: Path,
    model_override: Optional[str] = None,
    base_url_override: Optional[str] = None,
) -> GeminiContext:
    repo_root = resolve_repo_root(script_path)
    env_file_path, env_defaults = load_env_defaults(
        [repo_root / ".env.local", repo_root / ".env"]
    )
    prefixes = ("GEMINI_", "GOOGLE_GEMINI_")
    process_gemini_env = collect_prefixed_process_env(prefixes)
    api_key = env_defaults.get("GEMINI_API_KEY") or process_gemini_env.get("GEMINI_API_KEY")
    model = (
        model_override
        or env_defaults.get("GEMINI_MODEL")
        or process_gemini_env.get("GEMINI_MODEL")
        or DEFAULT_MODEL
    )
    base_url = (
        base_url_override
        or env_defaults.get("GOOGLE_GEMINI_BASE_URL")
        or process_gemini_env.get("GOOGLE_GEMINI_BASE_URL")
        or DEFAULT_BASE_URL
    )

    return GeminiContext(
        repo_root=repo_root,
        env_file_path=env_file_path,
        api_key=api_key,
        model=model,
        base_url=base_url,
        process_gemini_env=process_gemini_env,
        shell_gemini_env_candidates=detect_shell_env_conflicts(prefixes),
    )
