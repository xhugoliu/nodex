#!/usr/bin/env python3

import json
from pathlib import Path
from typing import Optional


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


def ensure_path(value: Optional[str], label: str) -> Path:
    if not value:
        raise SystemExit(
            f"[config] Missing {label} path. Pass --{label} or set NODEX_AI_{label.upper()}."
        )
    return Path(value)


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


def write_runner_metadata(metadata_path: Optional[Path], metadata: dict) -> None:
    if metadata_path is None:
        return
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2))


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


def format_failure(exc: RunnerFailure) -> str:
    prefix = f"[{exc.category}]"
    if exc.status_code is not None:
        return f"{prefix} HTTP {exc.status_code}: {exc.message}"
    return f"{prefix} {exc.message}"
