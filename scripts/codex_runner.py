#!/usr/bin/env python3

import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

from openai_runner import (
    RunnerFailure,
    build_response_schema,
    ensure_path,
    format_failure,
    validate_contract_response,
    validate_request_contract,
    write_runner_metadata,
)


DEFAULT_MAX_RETRIES = 2
DEFAULT_BACKOFF_SECONDS = 2.0
DEFAULT_MAX_BACKOFF_SECONDS = 12.0

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
CODE_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run Nodex AI requests through the local Codex CLI login session."
    )
    parser.add_argument(
        "--request",
        default=os.environ.get("NODEX_AI_REQUEST"),
        help="Path to the Nodex AI request JSON. Defaults to NODEX_AI_REQUEST.",
    )
    parser.add_argument(
        "--response",
        default=os.environ.get("NODEX_AI_RESPONSE"),
        help="Path to write the Nodex AI response JSON. Defaults to NODEX_AI_RESPONSE.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Optional model override passed to `codex exec`.",
    )
    parser.add_argument(
        "--reasoning-effort",
        default=None,
        help="Optional reasoning effort override passed to `codex exec`.",
    )
    parser.add_argument(
        "--mode",
        choices=("auto", "schema", "plain"),
        default=os.environ.get("CODEX_RUNNER_MODE", "auto"),
        help="How to drive `codex exec`: strict schema, plain JSON prompt, or auto fallback.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=int(os.environ.get("CODEX_RUNNER_MAX_RETRIES", str(DEFAULT_MAX_RETRIES))),
        help="Retry count for transient Codex/provider failures.",
    )
    parser.add_argument(
        "--backoff-seconds",
        type=float,
        default=float(
            os.environ.get("CODEX_RUNNER_BACKOFF_SECONDS", str(DEFAULT_BACKOFF_SECONDS))
        ),
        help="Base retry backoff in seconds.",
    )
    parser.add_argument(
        "--max-backoff-seconds",
        type=float,
        default=float(
            os.environ.get(
                "CODEX_RUNNER_MAX_BACKOFF_SECONDS", str(DEFAULT_MAX_BACKOFF_SECONDS)
            )
        ),
        help="Maximum retry backoff in seconds.",
    )
    args = parser.parse_args()

    request_path = ensure_path(args.request, "request")
    response_path = ensure_path(args.response, "response")
    metadata_path = (
        Path(os.environ["NODEX_AI_META"]) if os.environ.get("NODEX_AI_META") else None
    )
    workspace_path = os.environ.get("NODEX_AI_WORKSPACE")

    request_payload = json.loads(request_path.read_text())
    validate_request_contract(request_payload)

    codex_context = load_codex_context(
        model_override=args.model,
        reasoning_override=args.reasoning_effort,
    )
    warn_on_env_conflicts(codex_context.ignored_openai_env_keys)

    metadata = {
        "provider": "codex_cli",
        "model": codex_context.model,
        "provider_run_id": None,
        "retry_count": 0,
        "last_error_category": None,
        "last_error_message": None,
        "last_status_code": None,
    }

    response_contract = request_payload["contract"]["response_kind"]
    request_version = request_payload["contract"]["version"]
    patch_version = request_payload["contract"]["patch_version"]

    attempt = 0
    last_failure: Optional[RunnerFailure] = None

    while attempt <= args.max_retries:
        try:
            contract_response = run_codex_request(
                request_payload=request_payload,
                workspace_path=workspace_path,
                codex_context=codex_context,
                mode=args.mode,
            )
            validate_contract_response(
                contract_response=contract_response,
                expected_kind=response_contract,
                expected_version=request_version,
                expected_patch_version=patch_version,
            )
            metadata["provider_run_id"] = contract_response["generator"]["run_id"]
            write_runner_metadata(metadata_path, metadata)

            response_path.parent.mkdir(parents=True, exist_ok=True)
            response_path.write_text(json.dumps(contract_response, indent=2))
            return 0
        except RunnerFailure as exc:
            last_failure = exc
            if not exc.retryable or attempt >= args.max_retries:
                metadata["last_error_category"] = exc.category
                metadata["last_error_message"] = exc.message
                metadata["last_status_code"] = exc.status_code
                write_runner_metadata(metadata_path, metadata)
                raise SystemExit(format_failure(exc))

            metadata["retry_count"] = attempt + 1
            metadata["last_error_category"] = exc.category
            metadata["last_error_message"] = exc.message
            metadata["last_status_code"] = exc.status_code
            write_runner_metadata(metadata_path, metadata)

            sleep_seconds = compute_backoff_seconds(
                attempt=attempt,
                base_seconds=args.backoff_seconds,
                max_seconds=args.max_backoff_seconds,
            )
            sys.stderr.write(
                f"[{exc.category}] attempt {attempt + 1} failed: {exc.message}; "
                f"retrying in {sleep_seconds:.1f}s\n"
            )
            sys.stderr.flush()
            time.sleep(sleep_seconds)
            attempt += 1

    if last_failure is not None:
        raise SystemExit(format_failure(last_failure))
    raise SystemExit("[runner_error] codex runner exited unexpectedly")


class CodexContext:
    def __init__(
        self,
        *,
        config_path: Path,
        provider_name: Optional[str],
        base_url: Optional[str],
        model: Optional[str],
        reasoning_effort: Optional[str],
        login_status: str,
        ignored_openai_env_keys: list[str],
    ) -> None:
        self.config_path = config_path
        self.provider_name = provider_name
        self.base_url = base_url
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.login_status = login_status
        self.ignored_openai_env_keys = ignored_openai_env_keys


def load_codex_context(
    *,
    model_override: Optional[str],
    reasoning_override: Optional[str],
) -> CodexContext:
    config_path = get_codex_config_path()
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
    login_status = get_codex_login_status()
    ignored_openai_env_keys = sorted(
        key for key in os.environ.keys() if key.startswith("OPENAI_")
    )
    return CodexContext(
        config_path=config_path,
        provider_name=provider_name,
        base_url=base_url,
        model=model,
        reasoning_effort=reasoning_effort,
        login_status=login_status,
        ignored_openai_env_keys=ignored_openai_env_keys,
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


def warn_on_env_conflicts(ignored_keys: list[str]) -> None:
    if not ignored_keys:
        return
    sys.stderr.write(
        "[config] Ignoring parent OPENAI_* environment variables for `codex exec`: "
        + ", ".join(ignored_keys)
        + "\n"
    )
    sys.stderr.flush()


def run_codex_request(
    *,
    request_payload: dict,
    workspace_path: Optional[str],
    codex_context: CodexContext,
    mode: str,
) -> dict:
    if mode not in {"auto", "schema", "plain"}:
        raise RunnerFailure(category="config", message=f"unsupported mode: {mode}")

    attempt_modes = ["schema"] if mode == "schema" else ["plain"] if mode == "plain" else ["schema", "plain"]
    last_failure: Optional[RunnerFailure] = None

    for current_mode in attempt_modes:
        try:
            return run_codex_once(
                request_payload=request_payload,
                workspace_path=workspace_path,
                codex_context=codex_context,
                mode=current_mode,
            )
        except RunnerFailure as exc:
            last_failure = exc
            if current_mode == "schema" and mode == "auto" and should_fallback_to_plain(exc):
                continue
            raise

    if last_failure is not None:
        raise last_failure
    raise RunnerFailure(category="runner_error", message="codex runner failed without detail")


def run_codex_once(
    *,
    request_payload: dict,
    workspace_path: Optional[str],
    codex_context: CodexContext,
    mode: str,
) -> dict:
    with tempfile.TemporaryDirectory(prefix="nodex-codex-runner-") as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        output_path = tmp_dir_path / "response.json"
        schema_path = tmp_dir_path / "schema.json"
        use_schema = mode == "schema"
        if use_schema:
            schema_path.write_text(json.dumps(build_response_schema(), indent=2))

        prompt = build_codex_prompt(
            request_payload=request_payload,
            codex_context=codex_context,
            mode=mode,
        )
        command = build_codex_command(
            schema_path=schema_path if use_schema else None,
            output_path=output_path,
            workspace_path=workspace_path,
            model=codex_context.model,
            reasoning_effort=codex_context.reasoning_effort,
        )
        completed = subprocess.run(
            command,
            input=prompt,
            capture_output=True,
            env=build_codex_env(),
            text=True,
            check=False,
        )

        stdout = completed.stdout.strip()
        stderr = completed.stderr.strip()
        session_id = extract_session_id(stdout)

        if completed.returncode != 0:
            detail = extract_codex_error_detail(stdout=stdout, stderr=stderr)
            raise classify_codex_failure(detail)

        if not output_path.exists():
            raise RunnerFailure(
                category="parse_error",
                message="codex exec completed without writing the output file",
            )

        output_text = output_path.read_text().strip()
        contract_response = (
            json.loads(output_text)
            if use_schema
            else parse_plain_json_response(output_text)
        )
        contract_response["generator"] = {
            "provider": "codex_cli",
            "model": codex_context.model,
            "run_id": session_id,
        }
        return contract_response


def build_codex_prompt(
    *,
    request_payload: dict,
    codex_context: CodexContext,
    mode: str,
) -> str:
    parts = [
        "You are acting as a Nodex external AI runner.",
        "Use the request JSON below as the source of truth.",
        "Do not include markdown fences.",
    ]
    if mode == "schema":
        parts.append("Return exactly one JSON object matching the provided output schema.")
    else:
        parts.extend(
            [
                "Return exactly one valid JSON object matching the requested Nodex AI response contract.",
                "The JSON must include: version, kind, capability, request_node_id, status, summary, explanation, generator, patch, notes.",
                "The patch must be a valid version 1 Nodex patch with at least one operation.",
                "Keep `generator` fields present, but you may leave them as placeholder strings; the caller will overwrite them.",
                json.dumps(build_plain_response_template(request_payload), indent=2),
            ]
        )

    context_lines = [
        f"- codex login status: {codex_context.login_status}",
        f"- config path: {codex_context.config_path}",
        f"- provider: {codex_context.provider_name or '(unknown)'}",
        f"- base_url: {codex_context.base_url or '(unset)'}",
        f"- model: {codex_context.model or '(config default)'}",
        f"- reasoning effort: {codex_context.reasoning_effort or '(config default)'}",
    ]
    parts.extend(
        [
            "Local Codex context:",
            *context_lines,
            json.dumps(request_payload, indent=2, ensure_ascii=False),
        ]
    )
    return "\n\n".join(parts)


def build_plain_response_template(request_payload: dict) -> dict:
    capability = request_payload.get("capability", "expand")
    request_node_id = (
        request_payload.get("target_node", {}).get("id")
        or request_payload.get("request_node_id")
        or "root"
    )
    return {
        "version": request_payload["contract"]["version"],
        "kind": request_payload["contract"]["response_kind"],
        "capability": capability,
        "request_node_id": request_node_id,
        "status": "ok",
        "summary": "Short summary of the proposed patch",
        "explanation": {
            "rationale_summary": "Why this patch is a reasonable next step.",
            "direct_evidence": [],
            "inferred_suggestions": [],
        },
        "generator": {
            "provider": "codex_cli",
            "model": "placeholder",
            "run_id": "placeholder",
        },
        "patch": {
            "version": request_payload["contract"]["patch_version"],
            "summary": "Patch summary",
            "ops": [
                {
                    "type": "add_node",
                    "parent_id": request_node_id,
                    "title": "Concrete child title",
                    "kind": "topic",
                    "body": "Optional supporting detail",
                }
            ],
        },
        "notes": [],
    }


def build_codex_command(
    *,
    schema_path: Optional[Path],
    output_path: Path,
    workspace_path: Optional[str],
    model: Optional[str],
    reasoning_effort: Optional[str],
) -> list[str]:
    command = [
        "codex",
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color",
        "never",
        "--output-last-message",
        str(output_path),
    ]
    if schema_path is not None:
        command.extend(["--output-schema", str(schema_path)])
    if workspace_path:
        command.extend(["-C", workspace_path])
    if model:
        command.extend(["-m", model])
    if reasoning_effort:
        command.extend(["-c", f"model_reasoning_effort={json.dumps(reasoning_effort)}"])
    command.append("-")
    return command


def build_codex_env() -> dict:
    env = os.environ.copy()
    removed = [key for key in env.keys() if key.startswith("OPENAI_")]
    for key in removed:
        env.pop(key, None)
    return env


def extract_session_id(stdout: str) -> Optional[str]:
    match = re.search(r"session id:\s*(\S+)", stdout)
    if not match:
        return None
    return match.group(1)


def extract_codex_error_detail(*, stdout: str, stderr: str) -> str:
    lines = []
    for chunk in (stderr, stdout):
        if not chunk:
            continue
        lines.extend(line.strip() for line in chunk.splitlines() if line.strip())

    for line in reversed(lines):
        if line.startswith("ERROR:"):
            return line.removeprefix("ERROR:").strip()
        if "unexpected status" in line:
            return line

    if lines:
        return lines[-1]
    return "codex exec exited without output"


def classify_codex_failure(detail: str) -> RunnerFailure:
    lowered = detail.lower()
    status_match = re.search(r"unexpected status\s+(\d{3})", detail)
    if status_match:
        status_code = int(status_match.group(1))
        if status_code == 401:
            return RunnerFailure(
                category="auth",
                message=detail,
                status_code=401,
                retryable=False,
            )
        if status_code == 403:
            return RunnerFailure(
                category="permission",
                message=detail,
                status_code=403,
                retryable=False,
            )
        if 500 <= status_code <= 599:
            return RunnerFailure(
                category="server_error",
                message=detail,
                status_code=status_code,
                retryable=True,
            )
        return RunnerFailure(
            category="http_error",
            message=detail,
            status_code=status_code,
            retryable=False,
        )
    if "stream disconnected" in lowered or "bad gateway" in lowered:
        return RunnerFailure(category="server_error", message=detail, retryable=True)
    if "logged out" in lowered or "not logged in" in lowered:
        return RunnerFailure(category="auth", message=detail, retryable=False)
    if "api key" in lowered and "disabled" in lowered:
        return RunnerFailure(category="auth", message=detail, retryable=False)
    if "authentication required" in lowered:
        return RunnerFailure(category="auth", message=detail, retryable=False)
    if "invalid configuration" in lowered:
        return RunnerFailure(category="config", message=detail, retryable=False)
    if "timed out" in lowered:
        return RunnerFailure(category="timeout", message=detail, retryable=True)
    return RunnerFailure(category="runner_error", message=detail, retryable=False)


def should_fallback_to_plain(exc: RunnerFailure) -> bool:
    if exc.category == "parse_error":
        return True
    if exc.category == "server_error":
        return True
    return False


def parse_plain_json_response(output_text: str) -> dict:
    text = output_text.strip()
    match = CODE_FENCE_PATTERN.match(text)
    if match:
        text = match.group(1).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RunnerFailure(
            category="parse_error",
            message=f"codex exec plain mode did not return valid JSON: {exc}",
        ) from exc
    if not isinstance(value, dict):
        raise RunnerFailure(
            category="parse_error",
            message="codex exec plain mode returned non-object JSON",
        )
    return value


def compute_backoff_seconds(*, attempt: int, base_seconds: float, max_seconds: float) -> float:
    exponential = min(base_seconds * (2**attempt), max_seconds)
    jitter = random.uniform(0, min(base_seconds, 1.0))
    return min(exponential + jitter, max_seconds)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.stderr.write("[interrupt] Interrupted.\n")
        raise SystemExit(130)
