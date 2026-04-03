#!/usr/bin/env python3

import argparse
import json
import os
import socket
import sys
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
from gemini_context import load_gemini_context
from provider_runtime import compute_backoff_seconds


DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 2.0
DEFAULT_MAX_BACKOFF_SECONDS = 20.0
DEFAULT_TIMEOUT_SECONDS = 120
RETRYABLE_HTTP_CODES = {408, 409, 429, 500, 502, 503, 504}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Minimal Gemini runner for Nodex AI request/response contract."
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
        help="Gemini model name. Defaults to GEMINI_MODEL or gemini-2.5-pro.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Gemini base URL. Defaults to GOOGLE_GEMINI_BASE_URL or the official Gemini endpoint.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help=f"HTTP timeout seconds. Defaults to GEMINI_TIMEOUT_SECONDS or {DEFAULT_TIMEOUT_SECONDS}.",
    )
    args = parser.parse_args()

    request_path = ensure_path(args.request, "request")
    response_path = ensure_path(args.response, "response")
    metadata_path = (
        Path(os.environ["NODEX_AI_META"]) if os.environ.get("NODEX_AI_META") else None
    )
    request_payload = json.loads(request_path.read_text())
    validate_request_contract(request_payload)

    context = load_gemini_context(
        script_path=Path(__file__),
        model_override=args.model,
        base_url_override=args.base_url,
    )
    api_key = context.api_key
    if not api_key:
        raise SystemExit(
            "[auth] GEMINI_API_KEY is missing. Set it in the environment or in .env.local next to the repo."
        )

    model = context.model
    base_url = context.base_url
    timeout = args.timeout or int(
        os.environ.get("GEMINI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    )
    max_retries = int(os.environ.get("GEMINI_MAX_RETRIES", str(DEFAULT_MAX_RETRIES)))
    backoff_seconds = float(
        os.environ.get("GEMINI_BACKOFF_SECONDS", str(DEFAULT_BACKOFF_SECONDS))
    )
    max_backoff_seconds = float(
        os.environ.get(
            "GEMINI_MAX_BACKOFF_SECONDS", str(DEFAULT_MAX_BACKOFF_SECONDS)
        )
    )

    metadata = {
        "provider": "gemini",
        "model": model,
        "provider_run_id": None,
        "retry_count": 0,
        "last_error_category": None,
        "last_error_message": None,
        "last_status_code": None,
    }

    try:
        response_contract = request_payload["contract"]["response_kind"]
        request_version = request_payload["contract"]["version"]
        patch_version = request_payload["contract"]["patch_version"]

        response_data = post_generate_content_request(
            url=build_generate_content_url(base_url, model),
            api_key=api_key,
            payload=build_generate_content_payload(request_payload),
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
                message=f"Gemini output was not valid JSON: {exc}",
                retryable=False,
            ) from exc

        validate_contract_response(
            contract_response=contract_response,
            expected_kind=response_contract,
            expected_version=request_version,
            expected_patch_version=patch_version,
        )

        contract_response["generator"] = {
            "provider": "gemini",
            "model": model,
            "run_id": response_data.get("responseId"),
        }
        metadata["provider_run_id"] = response_data.get("responseId")
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


def build_generate_content_url(base_url: str, model: str) -> str:
    base = base_url.rstrip("/")
    if ":generateContent" in base:
        return base
    if "/models/" in base:
        if base.endswith(model):
            return f"{base}:generateContent"
        return f"{base}/{model}:generateContent"
    if base.endswith("/v1beta") or base.endswith("/v1") or base.endswith("/v1alpha"):
        return f"{base}/models/{model}:generateContent"
    return f"{base}/v1beta/models/{model}:generateContent"


def build_generate_content_payload(request_payload: dict) -> dict:
    return {
        "system_instruction": {
            "parts": [{"text": request_payload["system_prompt"]}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": request_payload["user_prompt"]}],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": build_response_schema(),
        },
    }


def post_generate_content_request(
    *,
    url: str,
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
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "x-goog-api-key": api_key,
                    "Content-Type": "application/json",
                },
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
        )
        sys.stderr.write(
            f"[{failure.category}] attempt {attempt + 1} failed: {failure.message}; "
            f"retrying in {sleep_seconds:.1f}s\n"
        )
        sys.stderr.flush()
        import time

        time.sleep(sleep_seconds)
        attempt += 1


def classify_http_error(exc: urllib.error.HTTPError) -> RunnerFailure:
    body = exc.read().decode("utf-8", errors="replace")
    payload = try_parse_json(body)
    message = extract_error_message(payload) or body or "HTTP error"
    code = exc.code

    if code == 401:
        return RunnerFailure("auth", message, retryable=False, status_code=code)
    if code == 403:
        return RunnerFailure("permission", message, retryable=False, status_code=code)
    if code == 429:
        return RunnerFailure("rate_limit", message, retryable=True, status_code=code)
    if code in {400, 404, 422}:
        return RunnerFailure(
            "invalid_request", message, retryable=False, status_code=code
        )
    if code in RETRYABLE_HTTP_CODES:
        return RunnerFailure(
            "server_error", message, retryable=True, status_code=code
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


def extract_output_text(response_data: dict) -> str:
    candidates = response_data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise RunnerFailure(
            category="parse_error",
            message="Gemini response did not contain candidates",
        )

    candidate = candidates[0]
    finish_reason = candidate.get("finishReason")
    if finish_reason and finish_reason not in {"STOP", "MAX_TOKENS"}:
        raise RunnerFailure(
            category="refusal",
            message=f"Gemini generation stopped with finishReason={finish_reason}",
            retryable=False,
        )

    content = candidate.get("content", {})
    parts = content.get("parts", [])
    texts = [
        part.get("text")
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]
    if texts:
        return "\n".join(texts).strip()

    raise RunnerFailure(
        category="parse_error",
        message="Gemini response did not contain text parts",
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


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.stderr.write("[interrupt] Interrupted.\n")
        raise SystemExit(130)
