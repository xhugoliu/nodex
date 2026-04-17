#!/usr/bin/env python3

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from ai_contract import (
    RunnerFailure,
    build_response_schema,
    ensure_path,
    format_failure,
    validate_contract_response,
    validate_request_contract,
    write_runner_metadata,
)
from openai_context import load_openai_context
from provider_runtime import compute_backoff_seconds


DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 2.0
DEFAULT_MAX_BACKOFF_SECONDS = 20.0
RETRYABLE_HTTP_CODES = {408, 409, 429, 500, 502, 503, 504}


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
        help=(
            "Responses API URL or OpenAI-compatible base URL. Defaults to "
            "OPENAI_BASE_URL or the official OpenAI /v1 root."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="HTTP timeout seconds. Defaults to OPENAI_TIMEOUT_SECONDS or 120.",
    )
    args = parser.parse_args()

    request_path = ensure_path(args.request, "request")
    response_path = ensure_path(args.response, "response")
    metadata_path = (
        Path(os.environ["NODEX_AI_META"]) if os.environ.get("NODEX_AI_META") else None
    )
    context = load_openai_context(
        script_path=Path(__file__),
        model_override=args.model,
        base_url_override=args.base_url,
        timeout_override=args.timeout,
    )
    api_key = context.api_key
    if not api_key:
        raise SystemExit(
            "[auth] OPENAI_API_KEY is missing. Set it in the environment or in .env.local next to the repo."
        )

    model = context.model
    base_url = normalize_responses_base_url(context.base_url)
    timeout = context.timeout_seconds
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

        reasoning_effort = context.reasoning_effort
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


def normalize_responses_base_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/responses"):
        return trimmed
    return f"{trimmed}/responses"


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
        sleep_seconds = compute_openai_backoff_seconds(
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

def compute_openai_backoff_seconds(
    *,
    attempt: int,
    base_seconds: float,
    max_seconds: float,
    retry_after: Optional[float],
) -> float:
    if retry_after is not None and retry_after > 0:
        return min(retry_after, max_seconds)
    return compute_backoff_seconds(
        attempt=attempt, base_seconds=base_seconds, max_seconds=max_seconds
    )


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
if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.stderr.write("[interrupt] Interrupted.\n")
        raise SystemExit(130)
