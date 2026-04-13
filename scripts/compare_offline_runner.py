#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path

from ai_contract import (
    ensure_path,
    validate_contract_response,
    validate_request_contract,
    write_runner_metadata,
)
from langchain_runner_common import normalize_contract_response


VARIANT_CONFIG = {
    "openai-minimal": {
        "provider": "openai",
        "model": "offline-openai-minimal",
        "branch_count": 3,
        "used_plain_json_fallback": True,
        "note_prefix": "Responses API",
    },
    "langchain-openai": {
        "provider": "langchain_openai",
        "model": "offline-langchain-openai",
        "branch_count": 4,
        "used_plain_json_fallback": False,
        "note_prefix": "LangChain OpenAI",
    },
    "langchain-anthropic": {
        "provider": "langchain_anthropic_compat",
        "model": "offline-langchain-anthropic",
        "branch_count": 5,
        "used_plain_json_fallback": False,
        "note_prefix": "LangChain Anthropic",
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Deterministic compare-only offline runner used by runner_compare presets."
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
        "--variant",
        choices=tuple(sorted(VARIANT_CONFIG.keys())),
        required=True,
        help="Which preset lane behavior to emulate.",
    )
    args = parser.parse_args()

    request_path = ensure_path(args.request, "request")
    response_path = ensure_path(args.response, "response")
    metadata_path = (
        Path(os.environ["NODEX_AI_META"]) if os.environ.get("NODEX_AI_META") else None
    )

    request_payload = json.loads(request_path.read_text())
    validate_request_contract(request_payload)

    scenario = derive_scenario(request_payload)
    variant_config = VARIANT_CONFIG[args.variant]
    contract_response = build_contract_response(
        request_payload=request_payload,
        variant=args.variant,
        scenario=scenario,
    )
    contract_response = normalize_contract_response(
        contract_response=contract_response,
        request_payload=request_payload,
        provider=variant_config["provider"],
        model=variant_config["model"],
    )
    contract_response["generator"] = {
        "provider": variant_config["provider"],
        "model": variant_config["model"],
        "run_id": f"offline-{args.variant}-{scenario}",
    }

    validate_contract_response(
        contract_response=contract_response,
        expected_kind=request_payload["contract"]["response_kind"],
        expected_version=request_payload["contract"]["version"],
        expected_patch_version=request_payload["contract"]["patch_version"],
    )

    metadata = {
        "provider": variant_config["provider"],
        "model": variant_config["model"],
        "provider_run_id": f"offline-{args.variant}-{scenario}",
        "retry_count": 0,
        "used_plain_json_fallback": variant_config["used_plain_json_fallback"],
        "normalization_notes": [
            note
            for note in contract_response.get("notes", [])
            if isinstance(note, str) and note.startswith("runner_normalized:")
        ],
        "last_error_category": None,
        "last_error_message": None,
        "last_status_code": None,
    }
    write_runner_metadata(metadata_path, metadata)

    response_path.parent.mkdir(parents=True, exist_ok=True)
    response_path.write_text(json.dumps(contract_response, indent=2))
    return 0


def derive_scenario(request_payload: dict) -> str:
    cited_evidence = request_payload.get("cited_evidence") or []
    if cited_evidence:
        return "source-context"
    target_node = request_payload.get("target_node") or {}
    if target_node.get("kind") == "source":
        return "source-root"
    return "minimal"


def build_contract_response(
    *,
    request_payload: dict,
    variant: str,
    scenario: str,
) -> dict:
    target_node = request_payload.get("target_node") or {}
    target_id = target_node.get("id") or "root"
    target_title = target_node.get("title") or target_id
    variant_config = VARIANT_CONFIG[variant]
    note_prefix = variant_config["note_prefix"]
    branch_count = variant_config["branch_count"]

    return {
        "explanation": {
            "rationale_summary": (
                f"{note_prefix} offline compare baseline expands {target_title} "
                f"through the {scenario} request shape."
            ),
            "direct_evidence": build_direct_evidence(request_payload, variant, scenario),
            "inferred_suggestions": [
                f"Review how {variant} reacts to the {scenario} request payload.",
                f"Compare {variant} against the Anthropic default route for {target_title}.",
            ],
        },
        "patch": {
            "ops": build_patch_ops(
                target_id=target_id,
                variant=variant,
                scenario=scenario,
                branch_count=branch_count,
            )
        },
        "notes": [
            f"offline_compare_stub:{variant}",
            f"offline_compare_scenario:{scenario}",
            f"{note_prefix} offline compare branch count={branch_count}",
        ],
    }


def build_direct_evidence(
    request_payload: dict,
    variant: str,
    scenario: str,
) -> list[dict]:
    cited_evidence = request_payload.get("cited_evidence") or []
    if not cited_evidence:
        return []
    first_source = cited_evidence[0] if isinstance(cited_evidence[0], dict) else {}
    chunks = first_source.get("chunks") or []
    first_chunk = chunks[0] if chunks and isinstance(chunks[0], dict) else {}
    source_id = first_source.get("source_id")
    chunk_id = first_chunk.get("chunk_id")
    if not source_id or not chunk_id:
        return []
    return [
        {
            "source_id": source_id,
            "chunk_id": chunk_id,
            "why_it_matters": (
                f"{variant} offline compare baseline keeps the {scenario} cited evidence "
                "in the request-driven draft seam."
            ),
        }
    ]


def build_patch_ops(
    *,
    target_id: str,
    variant: str,
    scenario: str,
    branch_count: int,
) -> list[dict]:
    ops = []
    for index in range(branch_count):
        title = f"{branch_title_prefix(variant)} {scenario} {index + 1}"
        body = (
            f"{branch_body_prefix(variant)} offline compare branch {index + 1} "
            f"for the {scenario} request path"
        )
        item = {
            "parent_id": target_id,
            "title": title,
            "kind": branch_kind(variant, index),
            "body": body,
            "position": index,
        }
        if variant != "openai-minimal":
            item["type"] = "add_node"
        ops.append(item)
    return ops


def branch_title_prefix(variant: str) -> str:
    return {
        "openai-minimal": "Responses Path",
        "langchain-openai": "LangChain OpenAI",
        "langchain-anthropic": "Anthropic Route",
    }[variant]


def branch_body_prefix(variant: str) -> str:
    return {
        "openai-minimal": "Minimal OpenAI",
        "langchain-openai": "LangChain OpenAI",
        "langchain-anthropic": "Anthropic-compatible",
    }[variant]


def branch_kind(variant: str, index: int) -> str:
    if variant == "langchain-openai" and index == 0:
        return "action"
    if variant == "langchain-anthropic" and index == 1:
        return "evidence"
    return "topic"


if __name__ == "__main__":
    raise SystemExit(main())
