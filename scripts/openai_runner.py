#!/usr/bin/env python3

import argparse
import json
import os
import random
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


DEFAULT_BASE_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 2.0
DEFAULT_MAX_BACKOFF_SECONDS = 20.0
RETRYABLE_HTTP_CODES = {408, 409, 429, 500, 502, 503, 504}


class RunnerFailure(Exception):
    def __init__(
        self,
        category: str,
        message: str,
        retryable: bool = False,
        status_code: Optional[int] = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.message = message
        self.retryable = retryable
        self.status_code = status_code
        self.retry_after = retry_after


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Minimal OpenAI runner for Nodex AI request/response contract."
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
        help="OpenAI model name. Defaults to OPENAI_MODEL or gpt-5.4-mini.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Responses API URL. Defaults to OPENAI_BASE_URL or the official Responses endpoint.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="HTTP timeout seconds. Defaults to OPENAI_TIMEOUT_SECONDS or 120.",
    )
    args = parser.parse_args()

    load_local_env()

    request_path = ensure_path(args.request, "request")
    response_path = ensure_path(args.response, "response")
    metadata_path = (
        Path(os.environ["NODEX_AI_META"]) if os.environ.get("NODEX_AI_META") else None
    )
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit(
            "[auth] OPENAI_API_KEY is missing. Set it in the environment or in .env.local next to the repo."
        )

    model = args.model or os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL
    base_url = args.base_url or os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL
    timeout = args.timeout or int(
        os.environ.get("OPENAI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    )
    max_retries = int(os.environ.get("OPENAI_MAX_RETRIES", str(DEFAULT_MAX_RETRIES)))
    backoff_seconds = float(
        os.environ.get("OPENAI_BACKOFF_SECONDS", str(DEFAULT_BACKOFF_SECONDS))
    )
    max_backoff_seconds = float(
        os.environ.get(
            "OPENAI_MAX_BACKOFF_SECONDS", str(DEFAULT_MAX_BACKOFF_SECONDS)
        )
    )
    metadata = {
        "provider": "openai",
        "model": model,
        "provider_run_id": None,
        "retry_count": 0,
        "last_error_category": None,
        "last_error_message": None,
        "last_status_code": None,
    }

    try:
        request_payload = json.loads(request_path.read_text())
        validate_request_contract(request_payload)
        response_contract = request_payload["contract"]["response_kind"]
        request_version = request_payload["contract"]["version"]
        patch_version = request_payload["contract"]["patch_version"]

        output_schema = build_response_schema()
        api_payload = {
            "model": model,
            "instructions": request_payload["system_prompt"],
            "input": request_payload["user_prompt"],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": response_contract,
                    "strict": True,
                    "schema": output_schema,
                }
            },
        }

        reasoning_effort = os.environ.get("OPENAI_REASONING_EFFORT")
        if reasoning_effort:
            api_payload["reasoning"] = {"effort": reasoning_effort}

        response_data = post_responses_request(
            base_url=base_url,
            api_key=api_key,
            payload=api_payload,
            timeout=timeout,
            max_retries=max_retries,
            backoff_seconds=backoff_seconds,
            max_backoff_seconds=max_backoff_seconds,
            metadata=metadata,
            metadata_path=metadata_path,
        )
        output_text = extract_output_text(response_data)
        try:
            contract_response = json.loads(output_text)
        except json.JSONDecodeError as exc:
            raise RunnerFailure(
                category="parse_error",
                message=f"model output was not valid JSON: {exc}",
                retryable=False,
            ) from exc

        validate_contract_response(
            contract_response=contract_response,
            expected_kind=response_contract,
            expected_version=request_version,
            expected_patch_version=patch_version,
        )

        contract_response["generator"] = {
            "provider": "openai",
            "model": model,
            "run_id": response_data.get("id"),
        }
        metadata["provider_run_id"] = response_data.get("id")
        write_runner_metadata(metadata_path, metadata)

        response_path.parent.mkdir(parents=True, exist_ok=True)
        response_path.write_text(json.dumps(contract_response, indent=2))
        return 0
    except RunnerFailure as exc:
        metadata["last_error_category"] = exc.category
        metadata["last_error_message"] = exc.message
        metadata["last_status_code"] = exc.status_code
        write_runner_metadata(metadata_path, metadata)
        raise SystemExit(format_failure(exc))


def ensure_path(value: Optional[str], label: str) -> Path:
    if not value:
        raise SystemExit(
            f"[config] Missing {label} path. Pass --{label} or set NODEX_AI_{label.upper()}."
        )
    return Path(value)


def load_local_env() -> None:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    for candidate in (repo_root / ".env.local", repo_root / ".env"):
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


def validate_request_contract(request_payload: dict) -> None:
    required = [
        "version",
        "kind",
        "capability",
        "workspace_name",
        "target_node",
        "system_prompt",
        "user_prompt",
        "output_instructions",
        "contract",
    ]
    missing = [key for key in required if key not in request_payload]
    if missing:
        raise RunnerFailure(
            category="invalid_request",
            message=f"request JSON is missing required keys: {', '.join(missing)}",
        )
    request_kind = request_payload["kind"]
    capability = request_payload.get("capability")
    if request_kind not in {"nodex_ai_expand_request", "nodex_ai_explore_request"}:
        raise RunnerFailure(
            category="invalid_request",
            message=(
                f"request kind {request_kind!r} is unsupported; "
                "expected 'nodex_ai_expand_request' or 'nodex_ai_explore_request'"
            ),
        )
    if capability not in {"expand", "explore"}:
        raise RunnerFailure(
            category="invalid_request",
            message=(
                f"request capability {capability!r} is unsupported; "
                "expected 'expand' or 'explore'"
            ),
        )
    if request_kind == "nodex_ai_expand_request" and capability != "expand":
        raise RunnerFailure(
            category="invalid_request",
            message="expand requests must set capability='expand'",
        )
    if request_kind == "nodex_ai_explore_request":
        if capability != "explore":
            raise RunnerFailure(
                category="invalid_request",
                message="explore requests must set capability='explore'",
            )
        explore_by = request_payload.get("explore_by")
        if explore_by not in {"risk", "question", "action", "evidence"}:
            raise RunnerFailure(
                category="invalid_request",
                message=(
                    "explore requests must include explore_by in "
                    "{risk, question, action, evidence}"
                ),
            )


def build_response_schema() -> dict:
    def string_or_null() -> dict:
        return {"type": ["string", "null"]}

    evidence_reference = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "source_id": {"type": "string"},
            "source_name": {"type": "string"},
            "chunk_id": {"type": "string"},
            "label": string_or_null(),
            "start_line": {"type": "integer"},
            "end_line": {"type": "integer"},
            "why_it_matters": {"type": "string"},
        },
        "required": [
            "source_id",
            "source_name",
            "chunk_id",
            "label",
            "start_line",
            "end_line",
            "why_it_matters",
        ],
    }

    def patch_op_schema(op_type: str, required: list[str], optional: dict) -> dict:
        properties = {"type": {"type": "string", "enum": [op_type]}}
        properties.update(optional)
        return {
            "type": "object",
            "additionalProperties": False,
            "properties": properties,
            "required": ["type", *required],
        }

    patch_op = {
        "anyOf": [
            patch_op_schema(
                "add_node",
                ["parent_id", "title"],
                {
                    "id": string_or_null(),
                    "parent_id": {"type": "string"},
                    "title": {"type": "string"},
                    "kind": string_or_null(),
                    "body": string_or_null(),
                    "position": {"type": ["integer", "null"]},
                },
            ),
            patch_op_schema(
                "update_node",
                ["id"],
                {
                    "id": {"type": "string"},
                    "title": string_or_null(),
                    "body": string_or_null(),
                    "kind": string_or_null(),
                },
            ),
            patch_op_schema(
                "move_node",
                ["id", "parent_id"],
                {
                    "id": {"type": "string"},
                    "parent_id": {"type": "string"},
                    "position": {"type": ["integer", "null"]},
                },
            ),
            patch_op_schema(
                "delete_node",
                ["id"],
                {
                    "id": {"type": "string"},
                },
            ),
            patch_op_schema(
                "attach_source",
                ["node_id", "source_id"],
                {
                    "node_id": {"type": "string"},
                    "source_id": {"type": "string"},
                },
            ),
            patch_op_schema(
                "attach_source_chunk",
                ["node_id", "chunk_id"],
                {
                    "node_id": {"type": "string"},
                    "chunk_id": {"type": "string"},
                },
            ),
            patch_op_schema(
                "cite_source_chunk",
                ["node_id", "chunk_id"],
                {
                    "node_id": {"type": "string"},
                    "chunk_id": {"type": "string"},
                    "citation_kind": string_or_null(),
                    "rationale": string_or_null(),
                },
            ),
            patch_op_schema(
                "detach_source",
                ["node_id", "source_id"],
                {
                    "node_id": {"type": "string"},
                    "source_id": {"type": "string"},
                },
            ),
            patch_op_schema(
                "detach_source_chunk",
                ["node_id", "chunk_id"],
                {
                    "node_id": {"type": "string"},
                    "chunk_id": {"type": "string"},
                },
            ),
            patch_op_schema(
                "uncite_source_chunk",
                ["node_id", "chunk_id"],
                {
                    "node_id": {"type": "string"},
                    "chunk_id": {"type": "string"},
                },
            ),
        ]
    }

    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "version": {"type": "integer", "enum": [2]},
            "kind": {"type": "string", "enum": ["nodex_ai_patch_response"]},
            "capability": {"type": "string", "enum": ["expand", "explore"]},
            "request_node_id": {"type": "string"},
            "status": {"type": "string", "enum": ["ok"]},
            "summary": string_or_null(),
            "explanation": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "rationale_summary": {"type": "string"},
                    "direct_evidence": {
                        "type": "array",
                        "items": evidence_reference,
                    },
                    "inferred_suggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "rationale_summary",
                    "direct_evidence",
                    "inferred_suggestions",
                ],
            },
            "generator": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "provider": {"type": "string"},
                    "model": string_or_null(),
                    "run_id": string_or_null(),
                },
                "required": ["provider", "model", "run_id"],
            },
            "patch": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "version": {"type": "integer", "enum": [1]},
                    "summary": string_or_null(),
                    "ops": {
                        "type": "array",
                        "minItems": 1,
                        "items": patch_op,
                    },
                },
                "required": ["version", "summary", "ops"],
            },
            "notes": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": [
            "version",
            "kind",
            "capability",
            "request_node_id",
            "status",
            "summary",
            "explanation",
            "generator",
            "patch",
            "notes",
        ],
    }


def post_responses_request(
    *,
    base_url: str,
    api_key: str,
    payload: dict,
    timeout: int,
    max_retries: int,
    backoff_seconds: float,
    max_backoff_seconds: float,
    metadata: dict,
    metadata_path: Optional[Path],
) -> dict:
    attempt = 0
    while True:
        try:
            request = urllib.request.Request(
                base_url,
                data=json.dumps(payload).encode("utf-8"),
                headers=build_headers(api_key),
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            failure = classify_http_error(exc)
        except urllib.error.URLError as exc:
            failure = classify_url_error(exc)
        except socket.timeout as exc:
            failure = RunnerFailure(
                category="timeout",
                message=f"request timed out: {exc}",
                retryable=True,
            )

        if not failure.retryable or attempt >= max_retries:
            raise failure

        metadata["retry_count"] = attempt + 1
        metadata["last_error_category"] = failure.category
        metadata["last_error_message"] = failure.message
        metadata["last_status_code"] = failure.status_code
        write_runner_metadata(metadata_path, metadata)
        sleep_seconds = compute_backoff_seconds(
            attempt=attempt,
            base_seconds=backoff_seconds,
            max_seconds=max_backoff_seconds,
            retry_after=failure.retry_after,
        )
        sys.stderr.write(
            f"[{failure.category}] attempt {attempt + 1} failed: {failure.message}; "
            f"retrying in {sleep_seconds:.1f}s\n"
        )
        sys.stderr.flush()
        time.sleep(sleep_seconds)
        attempt += 1


def classify_http_error(exc: urllib.error.HTTPError) -> RunnerFailure:
    body = exc.read().decode("utf-8", errors="replace")
    payload = try_parse_json(body)
    message = extract_error_message(payload) or body or "HTTP error"
    code = exc.code
    retry_after = parse_retry_after(exc.headers.get("Retry-After"))

    if code == 401:
        return RunnerFailure("auth", message, retryable=False, status_code=code)
    if code == 403:
        return RunnerFailure("permission", message, retryable=False, status_code=code)
    if code == 429:
        error_code = extract_error_code(payload)
        if error_code in {"insufficient_quota", "billing_hard_limit_reached"}:
            return RunnerFailure(
                "quota",
                message,
                retryable=False,
                status_code=code,
                retry_after=retry_after,
            )
        return RunnerFailure(
            "rate_limit",
            message,
            retryable=True,
            status_code=code,
            retry_after=retry_after,
        )
    if code in {400, 404, 422}:
        return RunnerFailure(
            "invalid_request", message, retryable=False, status_code=code
        )
    if code in RETRYABLE_HTTP_CODES:
        return RunnerFailure(
            "server_error",
            message,
            retryable=True,
            status_code=code,
            retry_after=retry_after,
        )
    return RunnerFailure("http_error", message, retryable=False, status_code=code)


def classify_url_error(exc: urllib.error.URLError) -> RunnerFailure:
    reason = exc.reason
    if isinstance(reason, socket.timeout):
        return RunnerFailure(
            category="timeout",
            message=f"request timed out: {reason}",
            retryable=True,
        )
    return RunnerFailure(
        category="network",
        message=f"network error: {reason}",
        retryable=True,
    )


def compute_backoff_seconds(
    *,
    attempt: int,
    base_seconds: float,
    max_seconds: float,
    retry_after: Optional[float],
) -> float:
    if retry_after is not None and retry_after > 0:
        return min(retry_after, max_seconds)
    exponential = min(base_seconds * (2**attempt), max_seconds)
    jitter = random.uniform(0, min(base_seconds, 1.0))
    return min(exponential + jitter, max_seconds)


def parse_retry_after(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def build_headers(api_key: str) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    organization = os.environ.get("OPENAI_ORGANIZATION")
    if organization:
        headers["OpenAI-Organization"] = organization
    project = os.environ.get("OPENAI_PROJECT")
    if project:
        headers["OpenAI-Project"] = project
    return headers


def write_runner_metadata(metadata_path: Optional[Path], metadata: dict) -> None:
    if metadata_path is None:
        return
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2))


def extract_output_text(response_data: dict) -> str:
    if isinstance(response_data.get("output_text"), str) and response_data["output_text"].strip():
        return response_data["output_text"]

    collected = []
    for item in response_data.get("output", []):
        item_type = item.get("type")
        if item_type in {"refusal", "output_refusal"}:
            raise RunnerFailure(
                category="refusal",
                message=f"model refused the request: {item.get('refusal', 'unknown refusal')}",
            )
        for content in item.get("content", []):
            content_type = content.get("type")
            if content_type in {"output_text", "text"} and isinstance(
                content.get("text"), str
            ):
                collected.append(content["text"])
            elif content_type == "refusal":
                raise RunnerFailure(
                    category="refusal",
                    message=f"model refused the request: {content.get('refusal', 'unknown refusal')}",
                )

    if collected:
        return "\n".join(collected).strip()

    if response_data.get("status") == "incomplete":
        raise RunnerFailure(
            category="incomplete",
            message="OpenAI response was incomplete and did not produce text output",
            retryable=True,
        )

    raise RunnerFailure(
        category="parse_error",
        message="OpenAI response did not contain output_text or parseable text content",
    )


def validate_contract_response(
    *,
    contract_response: dict,
    expected_kind: str,
    expected_version: int,
    expected_patch_version: int,
) -> None:
    required_top = [
        "version",
        "kind",
        "capability",
        "request_node_id",
        "status",
        "summary",
        "explanation",
        "generator",
        "patch",
        "notes",
    ]
    missing_top = [key for key in required_top if key not in contract_response]
    if missing_top:
        raise RunnerFailure(
            category="schema_error",
            message=f"response JSON is missing required keys: {', '.join(missing_top)}",
        )

    if contract_response.get("kind") != expected_kind:
        raise RunnerFailure(
            category="schema_error",
            message=(
                f"runner returned kind {contract_response.get('kind')!r}, "
                f"expected {expected_kind!r}"
            ),
        )
    if contract_response.get("version") != expected_version:
        raise RunnerFailure(
            category="schema_error",
            message=(
                f"runner returned version {contract_response.get('version')!r}, "
                f"expected {expected_version!r}"
            ),
        )
    if contract_response.get("status") != "ok":
        raise RunnerFailure(
            category="schema_error",
            message=f"runner returned non-ok status {contract_response.get('status')!r}",
        )

    explanation = contract_response.get("explanation")
    if not isinstance(explanation, dict):
        raise RunnerFailure(
            category="schema_error",
            message="response explanation must be an object",
        )
    rationale_summary = explanation.get("rationale_summary")
    if not isinstance(rationale_summary, str) or not rationale_summary.strip():
        raise RunnerFailure(
            category="schema_error",
            message="response explanation.rationale_summary must be a non-empty string",
        )
    direct_evidence = explanation.get("direct_evidence")
    if not isinstance(direct_evidence, list):
        raise RunnerFailure(
            category="schema_error",
            message="response explanation.direct_evidence must be an array",
        )
    for index, item in enumerate(direct_evidence, start=1):
        if not isinstance(item, dict):
            raise RunnerFailure(
                category="schema_error",
                message=f"direct evidence item {index} must be an object",
            )
        required_evidence_fields = [
            "source_id",
            "source_name",
            "chunk_id",
            "label",
            "start_line",
            "end_line",
            "why_it_matters",
        ]
        missing_fields = [
            field for field in required_evidence_fields if field not in item
        ]
        if missing_fields:
            raise RunnerFailure(
                category="schema_error",
                message=(
                    f"direct evidence item {index} is missing fields: "
                    f"{', '.join(missing_fields)}"
                ),
            )
    inferred_suggestions = explanation.get("inferred_suggestions")
    if not isinstance(inferred_suggestions, list):
        raise RunnerFailure(
            category="schema_error",
            message="response explanation.inferred_suggestions must be an array",
        )
    for index, item in enumerate(inferred_suggestions, start=1):
        if not isinstance(item, str) or not item.strip():
            raise RunnerFailure(
                category="schema_error",
                message=(
                    f"response explanation.inferred_suggestions[{index}] "
                    "must be a non-empty string"
                ),
            )

    patch = contract_response.get("patch")
    if not isinstance(patch, dict):
        raise RunnerFailure(
            category="schema_error",
            message="response patch must be an object",
        )
    if patch.get("version") != expected_patch_version:
        raise RunnerFailure(
            category="schema_error",
            message=(
                f"runner returned patch.version {patch.get('version')!r}, "
                f"expected {expected_patch_version!r}"
            ),
        )
    ops = patch.get("ops")
    if not isinstance(ops, list) or not ops:
        raise RunnerFailure(
            category="schema_error",
            message="response patch.ops must be a non-empty array",
        )

    allowed_op_types = {
        "add_node",
        "update_node",
        "move_node",
        "delete_node",
        "attach_source",
        "attach_source_chunk",
        "cite_source_chunk",
        "detach_source",
        "detach_source_chunk",
        "uncite_source_chunk",
    }
    for index, op in enumerate(ops, start=1):
        if not isinstance(op, dict):
            raise RunnerFailure(
                category="schema_error",
                message=f"patch op {index} must be an object",
            )
        op_type = op.get("type")
        if op_type not in allowed_op_types:
            raise RunnerFailure(
                category="schema_error",
                message=f"patch op {index} uses unsupported type {op_type!r}",
            )


def try_parse_json(text: str) -> Optional[dict]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def extract_error_message(payload: Optional[dict]) -> Optional[str]:
    if not payload:
        return None
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return None


def extract_error_code(payload: Optional[dict]) -> Optional[str]:
    if not payload:
        return None
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        if isinstance(code, str) and code.strip():
            return code.strip()
    return None


def format_failure(exc: RunnerFailure) -> str:
    prefix = f"[{exc.category}]"
    if exc.status_code is not None:
        return f"{prefix} HTTP {exc.status_code}: {exc.message}"
    return f"{prefix} {exc.message}"


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.stderr.write("[interrupt] Interrupted.\n")
        raise SystemExit(130)
