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
from anthropic_context import load_anthropic_context


DEFAULT_MAX_RETRIES = 2


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Experimental LangChain + Anthropic-compatible runner for the Nodex AI request/response contract."
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
        help="Anthropic-compatible model name. Defaults to ANTHROPIC_MODEL.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Anthropic-compatible base URL. Defaults to ANTHROPIC_BASE_URL.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="HTTP timeout seconds. Defaults to ANTHROPIC_TIMEOUT_SECONDS or API_TIMEOUT_MS.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=int(os.environ.get("ANTHROPIC_MAX_RETRIES", str(DEFAULT_MAX_RETRIES))),
        help="LangChain/Anthropic retry count.",
    )
    args = parser.parse_args()

    request_path = ensure_path(args.request, "request")
    response_path = ensure_path(args.response, "response")
    metadata_path = (
        Path(os.environ["NODEX_AI_META"]) if os.environ.get("NODEX_AI_META") else None
    )
    context = load_anthropic_context(
        script_path=Path(__file__),
        model_override=args.model,
        base_url_override=args.base_url,
        timeout_override=args.timeout,
    )
    api_key = context.api_key
    if not api_key:
        raise SystemExit(
            "[auth] ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is missing. "
            "Set it in the environment or in .env.local next to the repo."
        )

    metadata = {
        "provider": "langchain_anthropic_compat",
        "model": context.model,
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

        contract_response = invoke_langchain_anthropic(
            request_payload=request_payload,
            api_key=api_key,
            model=context.model,
            base_url=context.base_url,
            timeout=context.timeout_seconds,
            max_retries=args.max_retries,
        )
        contract_response = coerce_contract_response(
            contract_response=contract_response,
            request_payload=request_payload,
            model=context.model,
        )
        contract_response = normalize_expand_like_patch(
            contract_response=contract_response,
            request_payload=request_payload,
        )
        validate_contract_response(
            contract_response=contract_response,
            expected_kind=response_contract,
            expected_version=request_version,
            expected_patch_version=patch_version,
        )

        contract_response["generator"] = {
            "provider": "langchain_anthropic_compat",
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


def invoke_langchain_anthropic(
    *,
    request_payload: dict[str, Any],
    api_key: str,
    model: str,
    base_url: str,
    timeout: int,
    max_retries: int,
) -> dict[str, Any]:
    chat_anthropic_class = load_langchain_anthropic_class()

    try:
        llm = chat_anthropic_class(
            api_key=api_key,
            model=model,
            base_url=base_url,
            temperature=0,
            timeout=timeout,
            max_retries=max_retries,
        )
        messages = build_langchain_messages(request_payload)

        try:
            structured_llm = llm.with_structured_output(build_anthropic_response_schema())
            output = structured_llm.invoke(messages)
            return normalize_langchain_output(output)
        except RunnerFailure as exc:
            if "unsupported structured output type" not in exc.message:
                raise
            return invoke_plain_json_fallback(llm, messages)
        except Exception:
            return invoke_plain_json_fallback(llm, messages)
    except RunnerFailure:
        raise
    except Exception as exc:
        raise RunnerFailure(
            category="runner_error",
            message=f"LangChain Anthropic runner failed: {exc}",
            retryable=False,
        ) from exc


def load_langchain_anthropic_class():
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError as exc:
        raise SystemExit(
            "[config] Missing `langchain-anthropic`. Install it with "
            "`python3 -m pip install -U langchain-anthropic` before using this pilot runner."
        ) from exc
    return ChatAnthropic


def build_anthropic_response_schema() -> dict[str, Any]:
    schema = build_response_schema()
    schema.setdefault("title", "NodexAiPatchResponse")
    schema.setdefault(
        "description",
        "Structured Nodex AI patch response contract for patch-first local editing.",
    )
    return schema


def build_langchain_messages(request_payload: dict[str, Any]) -> list[tuple[str, str]]:
    quality_instructions = build_anthropic_quality_instructions(request_payload)
    return [
        (
            "system",
            "\n\n".join(
                [
                    request_payload["system_prompt"],
                    request_payload["output_instructions"],
                    quality_instructions,
                ]
            ),
        ),
        ("human", request_payload["user_prompt"]),
    ]


def invoke_plain_json_fallback(llm, messages) -> dict[str, Any]:
    response = llm.invoke(messages)
    text = extract_response_text(response)
    try:
        return json.loads(strip_code_fence(text))
    except json.JSONDecodeError as exc:
        raise RunnerFailure(
            category="parse_error",
            message=f"Anthropic-compatible model did not return valid JSON: {exc}",
            retryable=False,
        ) from exc


def extract_response_text(response: Any) -> str:
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "\n".join(parts)
    raise RunnerFailure(
        category="parse_error",
        message=(
            "Anthropic-compatible model returned no textual content that could be parsed as JSON"
        ),
        retryable=False,
    )


def strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1]).strip()
    return stripped


def build_anthropic_quality_instructions(request_payload: dict[str, Any]) -> str:
    target_node = request_payload.get("target_node") or {}
    title = target_node.get("title") or "target node"
    kind = target_node.get("kind") or "topic"
    body = (target_node.get("body") or "").lower()
    title_lower = str(title).lower()

    kind_hint = "Prefer kind=topic unless the branch is clearly a question, action, or evidence item."
    if (
        "milestone" in body
        or "plan" in body
        or "roadmap" in body
        or "step" in body
        or "deliver" in body
        or "plan" in title_lower
        or "milestone" in title_lower
    ):
        kind_hint = "Prefer kind=action for concrete milestones, tasks, or execution branches."
    elif (
        "finding" in body
        or "research" in body
        or "study" in body
        or "evidence" in body
        or "finding" in title_lower
        or "research" in title_lower
    ):
        kind_hint = "Prefer kind=evidence or kind=question when the branch is about findings, support, gaps, or follow-up questions."
    elif "question" in body or "unknown" in body or kind == "question":
        kind_hint = "Prefer kind=question for branches that are primarily open questions, uncertainties, or checks."

    return "\n".join(
        [
            "Anthropic runner quality constraints:",
            "- Return 3 to 4 add_node operations unless the request clearly needs more.",
            "- Keep each title concise and scan-friendly; prefer 2 to 6 words or one short phrase.",
            "- Preserve source terminology when it is already specific and useful.",
            "- Avoid long explanatory titles that read like full sentences.",
            "- Keep each body to one short sentence or phrase.",
            "- Prefer concrete branch names over abstract buckets.",
            f"- The current target is \"{title}\".",
            f"- {kind_hint}",
        ]
    )


def coerce_contract_response(
    *,
    contract_response: dict[str, Any],
    request_payload: dict[str, Any],
    model: str,
) -> dict[str, Any]:
    patch = contract_response.get("patch")
    if not isinstance(patch, dict):
        patch = {}
        contract_response["patch"] = patch
    patch.setdefault("version", request_payload["contract"]["patch_version"])
    patch.setdefault("ops", [])
    if isinstance(patch.get("ops"), list):
        patch["ops"] = [coerce_patch_op(item) for item in patch["ops"]]

    contract_response.setdefault("version", request_payload["contract"]["version"])
    contract_response.setdefault("kind", request_payload["contract"]["response_kind"])
    contract_response.setdefault("capability", request_payload["capability"])
    contract_response.setdefault("request_node_id", request_payload["target_node"]["id"])
    contract_response.setdefault("status", "ok")
    contract_response.setdefault("summary", patch.get("summary"))
    contract_response.setdefault(
        "generator",
        {
            "provider": "langchain_anthropic_compat",
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
        explanation.setdefault("inferred_suggestions", [])

    return contract_response


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
        source_id = source_id or fallback.get("source_id") or "unknown-source"
        source_name = item.get("source_name") or fallback.get("source_name") or source_id
        label = item.get("label", fallback.get("label"))
        start_line = coerce_line_number(item.get("start_line"), fallback.get("start_line"))
        end_line = coerce_line_number(item.get("end_line"), fallback.get("end_line"), start_line)
        why_it_matters = (
            item.get("why_it_matters")
            or "This cited chunk supports the proposed patch."
        )
        chunk_id = chunk_id or fallback.get("chunk_id") or "unknown-chunk"
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

    patch["ops"] = normalize_patch_ops_for_quality(
        normalized_ops,
        request_payload=request_payload,
    )
    patch["summary"] = normalize_patch_summary(
        patch.get("summary"),
        request_payload=request_payload,
        patch_ops=patch["ops"],
    )
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
    for index, item in enumerate(ops[:4]):
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
    title = title.split(":", 1)[0].strip() if title.count(":") == 1 and len(title) > 42 else title
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
        token in branch_text for token in ("question", "unknown", "uncertaint", "check", "clarify")
    ):
        return "question"
    if research_context and not any(
        token in combined for token in ("question", "unknown", "uncertaint")
    ):
        return "evidence"
    if explore_by == "action" or plan_context or any(
        token in combined for token in ("action", "step", "milestone", "task", "deliver", "plan", "execution")
    ):
        return "action"
    if explore_by == "evidence" or any(
        token in combined for token in ("evidence", "support", "finding", "claim", "proof", "citation")
    ):
        return "evidence"
    if explore_by == "risk" or any(
        token in combined for token in ("risk", "failure", "mitigation", "dependency", "blocker")
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


def normalize_langchain_output(output: Any) -> dict[str, Any]:
    if isinstance(output, dict):
        return output
    if hasattr(output, "model_dump"):
        dumped = output.model_dump()
        if isinstance(dumped, dict):
            return dumped
    raise RunnerFailure(
        category="schema_error",
        message=(
            "LangChain Anthropic runner returned unsupported structured output type: "
            f"{type(output).__name__}"
        ),
        retryable=False,
    )


if __name__ == "__main__":
    raise SystemExit(main())
