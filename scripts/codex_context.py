#!/usr/bin/env python3

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ai_contract import RunnerFailure
from provider_runtime import collect_prefixed_process_env, detect_shell_env_conflicts, mask_value


TOP_LEVEL_ASSIGNMENT_PATTERNS = {
    "model_provider": re.compile(
        r'^\s*model_provider\s*=\s*(["\'])([^"\'\r\n]+)\1\s*(?:#.*)?$',
        re.MULTILINE,
    ),
    "model": re.compile(
        r'^\s*model\s*=\s*(["\'])([^"\'\r\n]+)\1\s*(?:#.*)?$',
        re.MULTILINE,
    ),
    "model_reasoning_effort": re.compile(
        r'^\s*model_reasoning_effort\s*=\s*(["\'])([^"\'\r\n]+)\1\s*(?:#.*)?$',
        re.MULTILINE,
    ),
}
SECTION_PATTERN = re.compile(r"^\s*\[([^\]\r\n]+)\]\s*$")
BASE_URL_PATTERN = re.compile(
    r'^\s*base_url\s*=\s*(["\'])([^"\'\r\n]+)\1\s*(?:#.*)?$'
)


@dataclass
class CodexContext:
    config_path: Path
    auth_path: Path
    provider_name: Optional[str]
    base_url: Optional[str]
    model: Optional[str]
    reasoning_effort: Optional[str]
    login_status: str
    process_openai_env: dict[str, str]
    shell_openai_env_candidates: list[str]
    auth_json_key: Optional[str]

    @property
    def ignored_openai_env_keys(self) -> list[str]:
        return sorted(self.process_openai_env.keys())

    def to_json_payload(self) -> dict:
        return {
            "config_path": str(self.config_path),
            "config_exists": self.config_path.exists(),
            "auth_path": str(self.auth_path),
            "auth_exists": self.auth_path.exists(),
            "model_provider": self.provider_name,
            "model": self.model,
            "reasoning_effort": self.reasoning_effort,
            "base_url": self.base_url,
            "login_status": self.login_status,
            "auth_json_key": self.auth_json_key,
            "process_openai_env": {
                key: mask_value(value) for key, value in self.process_openai_env.items()
            },
            "shell_openai_env_candidates": self.shell_openai_env_candidates,
        }


def load_codex_context(
    *,
    model_override: Optional[str] = None,
    reasoning_override: Optional[str] = None,
) -> CodexContext:
    config_path = get_codex_config_path()
    auth_path = config_path.parent / "auth.json"
    config_text = read_codex_config_text(config_path)
    provider_name = extract_top_level_assignment(config_text, "model_provider")
    base_url = extract_codex_base_url(config_text, provider_name)
    model = (
        model_override
        or os.environ.get("CODEX_RUNNER_MODEL")
        or extract_top_level_assignment(config_text, "model")
    )
    reasoning_effort = (
        reasoning_override
        or os.environ.get("CODEX_RUNNER_REASONING_EFFORT")
        or extract_top_level_assignment(config_text, "model_reasoning_effort")
    )

    return CodexContext(
        config_path=config_path,
        auth_path=auth_path,
        provider_name=provider_name,
        base_url=base_url,
        model=model,
        reasoning_effort=reasoning_effort,
        login_status=get_codex_login_status(),
        process_openai_env=collect_prefixed_process_env(("OPENAI_",)),
        shell_openai_env_candidates=detect_shell_env_conflicts(("OPENAI_",)),
        auth_json_key=load_masked_auth_key(auth_path),
    )


def get_codex_config_path() -> Path:
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        return Path(codex_home).expanduser().resolve() / "config.toml"
    return Path.home() / ".codex" / "config.toml"


def read_codex_config_text(config_path: Path) -> str:
    if not config_path.exists():
        return ""
    return config_path.read_text()


def extract_top_level_assignment(config_text: str, key: str) -> Optional[str]:
    pattern = TOP_LEVEL_ASSIGNMENT_PATTERNS[key]
    match = pattern.search(config_text)
    if not match:
        return None
    value = match.group(2).strip()
    return value or None


def extract_codex_base_url(
    config_text: str,
    provider_name: Optional[str],
) -> Optional[str]:
    if not config_text.strip():
        return None

    lines = config_text.splitlines()
    target_section = (
        f"model_providers.{provider_name}" if provider_name is not None else None
    )

    def find_in_range(start: int, end: int) -> Optional[str]:
        for index in range(start, end):
            match = BASE_URL_PATTERN.match(lines[index])
            if match:
                return match.group(2).strip()
        return None

    if target_section is not None:
        section_start = None
        section_end = len(lines)
        for index, line in enumerate(lines):
            section_match = SECTION_PATTERN.match(line)
            if not section_match:
                continue
            section_name = section_match.group(1)
            if section_start is None:
                if section_name == target_section:
                    section_start = index + 1
                continue
            section_end = index
            break

        if section_start is not None:
            match = find_in_range(section_start, section_end)
            if match:
                return match

    top_level_end = len(lines)
    for index, line in enumerate(lines):
        if SECTION_PATTERN.match(line):
            top_level_end = index
            break

    return find_in_range(0, top_level_end)


def get_codex_login_status() -> str:
    completed = subprocess.run(
        ["codex", "login", "status"],
        capture_output=True,
        text=True,
        check=False,
    )
    detail = (completed.stdout or completed.stderr).strip()
    if completed.returncode != 0:
        raise RunnerFailure(
            category="auth",
            message=detail or "failed to read `codex login status`",
        )
    return detail


def load_masked_auth_key(auth_path: Path) -> Optional[str]:
    if not auth_path.exists():
        return None
    try:
        payload = json.loads(auth_path.read_text())
    except Exception:
        return "<invalid json>"
    value = payload.get("OPENAI_API_KEY")
    if not isinstance(value, str) or not value:
        return None
    return mask_value(value)
