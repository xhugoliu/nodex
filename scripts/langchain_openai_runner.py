#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path
from typing import Any, Optional

from ai_contract import (
    RunnerFailure,
    build_response_schema,
    ensure_path,
    format_failure,
    validate_contract_response,
    validate_request_contract,
    write_runner_metadata,
)
from langchain_runner_common import (
    invoke_plain_json_fallback,
    normalize_contract_response,
    normalize_langchain_output,
)
from openai_context import load_openai_context


DEFAULT_MAX_RETRIES = 2


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Experimental LangChain + OpenAI runner for the Nodex AI request/response contract."
        )
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
        help="OpenAI base URL. Defaults to OPENAI_BASE_URL or the official endpoint.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="HTTP timeout seconds. Defaults to OPENAI_TIMEOUT_SECONDS or 120.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=int(os.environ.get("OPENAI_MAX_RETRIES", str(DEFAULT_MAX_RETRIES))),
        help="LangChain/OpenAI retry count.",
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

    metadata = {
        "provider": "langchain_openai",
        "model": context.model,
        "provider_run_id": None,
        "retry_count": 0,
        "used_plain_json_fallback": False,
        "normalization_notes": [],
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

        contract_response = invoke_langchain_openai(
            request_payload=request_payload,
            api_key=api_key,
            model=context.model,
            base_url=context.base_url,
            timeout=context.timeout_seconds,
            max_retries=args.max_retries,
            metadata=metadata,
        )
        contract_response = normalize_contract_response(
            contract_response=contract_response,
            request_payload=request_payload,
            provider="langchain_openai",
            model=context.model,
        )
        metadata["normalization_notes"] = [
            note
            for note in contract_response.get("notes", [])
            if isinstance(note, str) and note.startswith("runner_normalized:")
        ]
        validate_contract_response(
            contract_response=contract_response,
            expected_kind=response_contract,
            expected_version=request_version,
            expected_patch_version=patch_version,
        )

        contract_response["generator"] = {
            "provider": "langchain_openai",
            "model": context.model,
            "run_id": None,
        }
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


def invoke_langchain_openai(
    *,
    request_payload: dict[str, Any],
    api_key: str,
    model: str,
    base_url: str,
    timeout: int,
    max_retries: int,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    chat_openai_class = load_langchain_openai_class()

    try:
        llm = build_chat_openai_client(
            chat_openai_class=chat_openai_class,
            api_key=api_key,
            model=model,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )
        messages = [
            (
                "system",
                "\n\n".join(
                    [
                        request_payload["system_prompt"],
                        request_payload["output_instructions"],
                    ]
                ),
            ),
            ("human", request_payload["user_prompt"]),
        ]
        structured_llm = build_structured_llm(llm)
        try:
            output = structured_llm.invoke(messages)
            return normalize_langchain_output(
                output,
                runner_label="LangChain OpenAI runner",
            )
        except RunnerFailure as exc:
            if "unsupported structured output type" not in exc.message:
                raise
            metadata["used_plain_json_fallback"] = True
            return invoke_plain_json_fallback(
                llm,
                messages,
                invalid_json_message=(
                    "OpenAI-compatible model did not return valid JSON: {error}"
                ),
                no_text_message=(
                    "OpenAI-compatible model returned no textual content that could be "
                    "parsed as JSON"
                ),
            )
    except RunnerFailure:
        raise
    except Exception as exc:
        raise RunnerFailure(
            category="runner_error",
            message=f"LangChain runner failed: {exc}",
            retryable=False,
        ) from exc


def build_chat_openai_client(
    *,
    chat_openai_class,
    api_key: str,
    model: str,
    base_url: str,
    timeout: int,
    max_retries: int,
):
    attempts = [
        {
            "api_key": api_key,
            "model": model,
            "base_url": base_url,
            "timeout": timeout,
            "max_retries": max_retries,
        },
        {
            "openai_api_key": api_key,
            "model": model,
            "openai_api_base": base_url,
            "timeout": timeout,
            "max_retries": max_retries,
        },
    ]
    last_error: Optional[TypeError] = None
    for kwargs in attempts:
        try:
            return chat_openai_class(**kwargs)
        except TypeError as exc:
            last_error = exc
    raise RunnerFailure(
        category="config",
        message=(
            "installed `langchain-openai` does not accept the expected ChatOpenAI kwargs: "
            f"{last_error}"
        ),
        retryable=False,
    )


def build_structured_llm(llm):
    schema = build_response_schema()
    try:
        return llm.with_structured_output(schema, method="json_schema")
    except TypeError:
        return llm.with_structured_output(schema)


def load_langchain_openai_class():
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        raise SystemExit(
            "[config] Missing `langchain-openai`. Install it with "
            "`python3 -m pip install -U langchain-openai` before using this pilot runner."
        ) from exc
    return ChatOpenAI


if __name__ == "__main__":
    raise SystemExit(main())
