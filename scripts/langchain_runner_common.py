#!/usr/bin/env python3

import json
from typing import Any, Callable, Optional

from ai_contract import RunnerFailure


PatchOpsNormalizer = Callable[[list[dict[str, Any]]], list[dict[str, Any]]]


def normalize_langchain_output(
    output: Any,
    *,
    runner_label: str = "LangChain runner",
) -> dict[str, Any]:
    if isinstance(output, dict):
        return output
    if hasattr(output, "model_dump"):
        dumped = output.model_dump()
        if isinstance(dumped, dict):
            return dumped
    raise RunnerFailure(
        category="schema_error",
        message=(
            f"{runner_label} returned unsupported structured output type: "
            f"{type(output).__name__}"
        ),
        retryable=False,
    )


def should_use_plain_json_fallback(exc: RunnerFailure) -> bool:
    return exc.category == "schema_error" and (
        "unsupported structured output type" in exc.message
    )


def invoke_plain_json_fallback(
    llm,
    messages,
    *,
    invalid_json_message: str = "LangChain model did not return valid JSON: {error}",
    no_text_message: str = (
        "LangChain model returned no textual content that could be parsed as JSON"
    ),
) -> dict[str, Any]:
    response = llm.invoke(messages)
    text = extract_response_text(response, no_text_message=no_text_message)
    try:
        return json.loads(strip_code_fence(text))
    except json.JSONDecodeError as exc:
        raise RunnerFailure(
            category="parse_error",
            message=invalid_json_message.format(error=exc),
            retryable=False,
        ) from exc


def extract_response_text(response: Any, *, no_text_message: str) -> str:
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
                    continue
            text = getattr(item, "text", None)
            if isinstance(text, str):
                parts.append(text)
        if parts:
            return "\n".join(parts)
    raise RunnerFailure(
        category="parse_error",
        message=no_text_message,
        retryable=False,
    )


def strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1]).strip()
    return stripped


def classify_langchain_runtime_failure(
    exc: Exception,
    *,
    runner_label: str,
) -> RunnerFailure:
    detail = str(exc).strip() or type(exc).__name__
    combined = f"{type(exc).__name__} {detail}".lower()

    if "timeout" in combined or "timed out" in combined:
        return RunnerFailure(
            category="timeout",
            message=f"{runner_label} failed: {detail}",
            retryable=True,
        )

    if any(
        token in combined
        for token in (
            "connection error",
            "connectionerror",
            "connect error",
            "apiconnectionerror",
            "connection refused",
            "connection reset",
            "connection aborted",
            "network is unreachable",
            "temporary failure in name resolution",
            "name or service not known",
            "nodename nor servname provided",
            "failed to resolve",
            "dns",
        )
    ):
        return RunnerFailure(
            category="network",
            message=f"{runner_label} failed: {detail}",
            retryable=True,
        )

    return RunnerFailure(
        category="runner_error",
        message=f"{runner_label} failed: {detail}",
        retryable=False,
    )


def normalize_contract_response(
    *,
    contract_response: dict[str, Any],
    request_payload: dict[str, Any],
    provider: str,
    model: str,
    patch_ops_normalizer: Optional[
        Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    ] = None,
) -> dict[str, Any]:
    normalized = coerce_contract_response(
        contract_response=contract_response,
        request_payload=request_payload,
        provider=provider,
        model=model,
    )
    normalized = normalize_expand_like_patch(
        contract_response=normalized,
        request_payload=request_payload,
        patch_ops_normalizer=patch_ops_normalizer,
    )
    patch = normalized.get("patch")
    if isinstance(patch, dict):
        normalized["summary"] = patch.get("summary")
    return normalized


def coerce_contract_response(
    *,
    contract_response: dict[str, Any],
    request_payload: dict[str, Any],
    provider: str,
    model: str,
) -> dict[str, Any]:
    patch = contract_response.get("patch")
    if not isinstance(patch, dict):
        patch = {}
        contract_response["patch"] = patch
    patch.setdefault("version", request_payload["contract"]["patch_version"])
    patch.setdefault("ops", [])
    if isinstance(patch.get("ops"), list):
        inferred_type_count = 0
        coerced_ops = []
        for item in patch["ops"]:
            coerced_item = coerce_patch_op(item)
            if (
                isinstance(item, dict)
                and not item.get("type")
                and isinstance(coerced_item, dict)
                and coerced_item.get("type")
            ):
                inferred_type_count += 1
            coerced_ops.append(coerced_item)
        patch["ops"] = coerced_ops
        if inferred_type_count:
            append_runner_note(
                contract_response,
                f"runner_normalized:inferred_patch_op_types={inferred_type_count}",
            )

    contract_response.setdefault("version", request_payload["contract"]["version"])
    contract_response.setdefault("kind", request_payload["contract"]["response_kind"])
    contract_response.setdefault("capability", request_payload["capability"])
    contract_response.setdefault("request_node_id", request_payload["target_node"]["id"])
    contract_response.setdefault("status", "ok")
    contract_response.setdefault("summary", patch.get("summary"))
    contract_response.setdefault(
        "generator",
        {
            "provider": provider,
            "model": model,
            "run_id": None,
        },
    )
    contract_response.setdefault("notes", [])

    explanation = contract_response.get("explanation")
    if isinstance(explanation, dict):
        explanation["direct_evidence"] = coerce_direct_evidence(
            explanation.get("direct_evidence"),
            request_payload,
        )
        inferred_suggestions = explanation.get("inferred_suggestions")
        if not isinstance(inferred_suggestions, list):
            inferred_suggestions = []
        else:
            inferred_suggestions = [
                item for item in inferred_suggestions if isinstance(item, str) and item.strip()
            ]
        explanation["inferred_suggestions"] = inferred_suggestions

    return contract_response


def append_runner_note(contract_response: dict[str, Any], note: str) -> None:
    notes = contract_response.setdefault("notes", [])
    if not isinstance(notes, list):
        notes = []
        contract_response["notes"] = notes
    if note not in notes:
        notes.append(note)


def coerce_direct_evidence(
    value: Any,
    request_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    lookup = build_evidence_lookup(request_payload)
    coerced = []
    for item in value:
        if not isinstance(item, dict):
            continue
        source_id = item.get("source_id")
        chunk_id = item.get("chunk_id")
        fallback = lookup.get((source_id, chunk_id)) or lookup.get(chunk_id) or {}
        source_id = source_id or fallback.get("source_id")
        chunk_id = chunk_id or fallback.get("chunk_id")
        if not source_id or not chunk_id:
            continue
        source_name = item.get("source_name") or fallback.get("source_name") or source_id
        label = item.get("label", fallback.get("label"))
        start_line = coerce_line_number(item.get("start_line"), fallback.get("start_line"))
        end_line = coerce_line_number(item.get("end_line"), fallback.get("end_line"), start_line)
        why_it_matters = (
            item.get("why_it_matters")
            or "This cited chunk supports the proposed patch."
        )
        coerced.append(
            {
                "source_id": source_id,
                "source_name": source_name,
                "chunk_id": chunk_id,
                "label": label,
                "start_line": start_line,
                "end_line": end_line,
                "why_it_matters": why_it_matters,
            }
        )
    return coerced


def build_evidence_lookup(request_payload: dict[str, Any]) -> dict[Any, dict[str, Any]]:
    lookup: dict[Any, dict[str, Any]] = {}
    for source in request_payload.get("cited_evidence") or []:
        if not isinstance(source, dict):
            continue
        source_id = source.get("source_id")
        source_name = source.get("original_name")
        for chunk in source.get("chunks") or []:
            if not isinstance(chunk, dict):
                continue
            payload = {
                "source_id": source_id,
                "source_name": source_name,
                "chunk_id": chunk.get("chunk_id"),
                "label": chunk.get("label"),
                "start_line": chunk.get("start_line"),
                "end_line": chunk.get("end_line"),
            }
            lookup[(source_id, chunk.get("chunk_id"))] = payload
            if chunk.get("chunk_id"):
                lookup[chunk.get("chunk_id")] = payload
    return lookup


def coerce_line_number(
    value: Any,
    fallback: Any,
    secondary_fallback: int = 0,
) -> int:
    if isinstance(value, int):
        return value
    if isinstance(fallback, int):
        return fallback
    return secondary_fallback


def coerce_patch_op(item: Any) -> Any:
    if not isinstance(item, dict):
        return item
    if item.get("type"):
        return item

    inferred_type = infer_patch_op_type(item)
    if inferred_type:
        item = dict(item)
        item["type"] = inferred_type
    return item


def infer_patch_op_type(item: dict[str, Any]) -> Optional[str]:
    if "parent_id" in item and "title" in item:
        return "add_node"
    if "id" in item and "parent_id" in item:
        return "move_node"
    if "id" in item and any(key in item for key in ("title", "body", "kind")):
        return "update_node"
    if "id" in item:
        return "delete_node"
    if "node_id" in item and "source_id" in item:
        return "attach_source"
    if "node_id" in item and "chunk_id" in item and any(
        key in item for key in ("citation_kind", "rationale")
    ):
        return "cite_source_chunk"
    if "node_id" in item and "chunk_id" in item:
        return "attach_source_chunk"
    return None


def normalize_expand_like_patch(
    *,
    contract_response: dict[str, Any],
    request_payload: dict[str, Any],
    patch_ops_normalizer: Optional[
        Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    ] = None,
) -> dict[str, Any]:
    capability = request_payload.get("capability")
    if capability not in {"expand", "explore"}:
        return contract_response

    patch = contract_response.get("patch")
    if not isinstance(patch, dict):
        return contract_response

    target_node = request_payload.get("target_node") or {}
    target_id = target_node.get("id") or "root"
    normalized_ops = []
    raw_ops = patch.get("ops")
    if isinstance(raw_ops, list):
        for item in raw_ops:
            normalized = normalize_expand_like_op(item=item, target_id=target_id)
            if normalized is not None:
                normalized_ops.append(normalized)

    if not normalized_ops:
        normalized_ops = fallback_scaffold_ops(request_payload)
        append_runner_note(contract_response, "runner_normalized:fallback_scaffold_ops")

    if patch_ops_normalizer is not None:
        normalized_ops = patch_ops_normalizer(normalized_ops)
        if not normalized_ops:
            normalized_ops = fallback_scaffold_ops(request_payload)
            append_runner_note(contract_response, "runner_normalized:fallback_scaffold_ops")
    else:
        normalized_ops = normalize_patch_ops_for_quality(
            normalized_ops,
            request_payload=request_payload,
        )

    patch["ops"] = normalized_ops
    patch["summary"] = normalize_patch_summary(
        patch.get("summary"),
        request_payload=request_payload,
        patch_ops=patch["ops"],
    )
    contract_response["summary"] = patch["summary"]
    return contract_response


def normalize_expand_like_op(*, item: Any, target_id: str) -> Optional[dict[str, Any]]:
    if not isinstance(item, dict):
        return None

    op_type = item.get("type")
    if op_type == "add_node":
        normalized = dict(item)
        normalized.setdefault("parent_id", target_id)
        return normalized

    if op_type == "update_node":
        op_id = item.get("id")
        if op_id == target_id:
            return dict(item)
        title = item.get("title") or humanize_node_id(op_id) or "New Branch"
        return {
            "type": "add_node",
            "parent_id": target_id,
            "title": title,
            "kind": item.get("kind"),
            "body": item.get("body"),
        }

    if isinstance(op_type, str) and op_type.strip():
        return dict(item)

    return None


def fallback_scaffold_ops(request_payload: dict[str, Any]) -> list[dict[str, Any]]:
    target_node = request_payload.get("target_node") or {}
    target_id = target_node.get("id") or "root"
    capability = request_payload.get("capability")
    explore_by = request_payload.get("explore_by")

    if capability == "explore":
        title_sets = {
            "risk": ["Risk Triggers", "Failure Modes", "Mitigations"],
            "question": ["Clarifying Questions", "Unknowns", "Tests To Run"],
            "action": ["Immediate Actions", "Dependencies", "Execution Order"],
            "evidence": ["Direct Support", "Evidence Gaps", "Counterpoints"],
        }
        titles = title_sets.get(explore_by, ["Important Angles", "Open Questions", "Next Moves"])
    else:
        titles = ["Core Concepts", "Important Angles", "Next Steps"]

    return [
        {
            "type": "add_node",
            "parent_id": target_id,
            "title": title,
            "kind": fallback_kind_for_request(request_payload),
            "body": None,
        }
        for title in titles
    ]


def build_fallback_summary(request_payload: dict[str, Any]) -> str:
    capability = request_payload.get("capability") or "expand"
    target_node = request_payload.get("target_node") or {}
    target_title = target_node.get("title") or target_node.get("id") or "target node"
    if capability == "explore":
        explore_by = request_payload.get("explore_by") or "one angle"
        return f"Explore {target_title} by {explore_by}"
    return f"Expand {target_title}"


def humanize_node_id(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    pieces = [piece for piece in value.replace("_", "-").split("-") if piece]
    if not pieces:
        return None
    return " ".join(piece.capitalize() for piece in pieces)


def normalize_patch_ops_for_quality(
    ops: list[dict[str, Any]],
    *,
    request_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    target_node = request_payload.get("target_node") or {}
    target_title = target_node.get("title") or "target node"
    normalized = []
    for index, item in enumerate(ops):
        if not isinstance(item, dict):
            continue
        op_type = item.get("type")
        if op_type != "add_node":
            normalized.append(item)
            continue
        title = normalize_branch_title(item.get("title"), target_title)
        body = normalize_branch_body(item.get("body"), title, target_title)
        kind = normalize_branch_kind(item, request_payload=request_payload)
        normalized_item = dict(item)
        normalized_item["title"] = title
        normalized_item["body"] = body
        normalized_item["kind"] = kind
        if normalized_item.get("position") is None:
            normalized_item["position"] = index
        normalized.append(normalized_item)
    return normalized or fallback_scaffold_ops(request_payload)


def normalize_branch_title(value: Any, target_title: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return "New Branch"
    title = value.strip().replace("\n", " ")
    if title.count(":") == 1 and len(title) > 42:
        title = title.split(":", 1)[0].strip()
    title = title.rstrip(".")
    words = title.split()
    if len(words) > 8:
        title = " ".join(words[:6])
    if len(title) > 64:
        title = title[:64].rstrip(" -,:;")
    if title.lower() == target_title.lower():
        title = f"{title} Detail"
    return title or "New Branch"


def normalize_branch_body(
    value: Any,
    title: str,
    target_title: str,
) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    body = " ".join(value.strip().split())
    body = body.rstrip(".")
    for separator in (". ", "; ", " - "):
        if separator in body:
            body = body.split(separator, 1)[0]
            break
    if len(body) > 140:
        body = body[:140].rstrip(" ,;:-")
    if body.lower() == title.lower() or body.lower() == target_title.lower():
        return None
    return body or None


def normalize_branch_kind(
    item: dict[str, Any],
    *,
    request_payload: dict[str, Any],
) -> str:
    title = str(item.get("title") or "").lower()
    body = str(item.get("body") or "").lower()
    explore_by = request_payload.get("explore_by")
    target_node = request_payload.get("target_node") or {}
    target_title = str(target_node.get("title") or "").lower()
    target_body = str(target_node.get("body") or "").lower()
    branch_text = " ".join([title, body]).lower()
    combined = " ".join([title, body, target_title, target_body]).lower()
    target_context = " ".join([target_title, target_body])
    plan_context = any(
        token in target_context
        for token in ("milestone", "step", "plan", "deliver", "task", "execution")
    )
    research_context = any(
        token in target_context
        for token in (
            "finding",
            "research",
            "study",
            "evidence",
            "confidence",
            "synthesis",
            "claim",
        )
    )
    target_is_question = target_node.get("kind") == "question" or any(
        token in target_title for token in ("question", "unknown", "uncertaint")
    )

    if explore_by == "question" or target_is_question or any(
        token in branch_text
        for token in ("question", "unknown", "uncertaint", "check", "clarify")
    ):
        return "question"
    if research_context and not any(
        token in combined for token in ("question", "unknown", "uncertaint")
    ):
        return "evidence"
    if explore_by == "action" or plan_context or any(
        token in combined
        for token in ("action", "step", "milestone", "task", "deliver", "plan", "execution")
    ):
        return "action"
    if explore_by == "evidence" or any(
        token in combined
        for token in ("evidence", "support", "finding", "claim", "proof", "citation")
    ):
        return "evidence"
    if explore_by == "risk" or any(
        token in combined
        for token in ("risk", "failure", "mitigation", "dependency", "blocker")
    ):
        return "topic"
    raw_kind = item.get("kind")
    if isinstance(raw_kind, str) and raw_kind.strip():
        return raw_kind
    return fallback_kind_for_request(request_payload)


def fallback_kind_for_request(request_payload: dict[str, Any]) -> str:
    explore_by = request_payload.get("explore_by")
    if explore_by == "question":
        return "question"
    if explore_by == "action":
        return "action"
    if explore_by == "evidence":
        return "evidence"

    target_node = request_payload.get("target_node") or {}
    combined = " ".join(
        [
            str(target_node.get("title") or "").lower(),
            str(target_node.get("body") or "").lower(),
        ]
    )
    if any(token in combined for token in ("milestone", "step", "plan", "deliver", "task")):
        return "action"
    if any(token in combined for token in ("finding", "research", "evidence", "study")):
        return "evidence"
    if any(token in combined for token in ("question", "unknown", "uncertaint")):
        return "question"
    return "topic"


def normalize_patch_summary(
    value: Any,
    *,
    request_payload: dict[str, Any],
    patch_ops: list[dict[str, Any]],
) -> str:
    target_node = request_payload.get("target_node") or {}
    target_title = target_node.get("title") or target_node.get("id") or "target node"
    capability = request_payload.get("capability") or "expand"
    count = len(patch_ops)

    if isinstance(value, str) and value.strip():
        summary = " ".join(value.strip().split())
        if len(summary) > 96:
            summary = summary[:96].rstrip(" ,;:-")
    else:
        summary = build_fallback_summary(request_payload)

    if capability == "explore":
        explore_by = request_payload.get("explore_by") or "one angle"
        return f"Explore {target_title} by {explore_by} with {count} branches"
    return f"Expand {target_title} with {count} branches"


__all__ = [
    "coerce_contract_response",
    "coerce_direct_evidence",
    "invoke_plain_json_fallback",
    "normalize_contract_response",
    "normalize_expand_like_patch",
    "normalize_langchain_output",
    "should_use_plain_json_fallback",
]
