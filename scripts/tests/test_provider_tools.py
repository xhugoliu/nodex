import io
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Optional
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
FIXTURE_PATH = REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md"

from ai_contract import RunnerFailure, validate_contract_response
from anthropic_context import AnthropicContext
import compare_offline_runner
from desktop_flow_smoke import (
    DEFAULT_DESKTOP_FLOW_PROVIDER,
    apply_default_ai_status_contract,
    build_ai_status,
    resolve_runner_command,
    run_desktop_flow_smoke,
)
import langchain_anthropic_runner as langchain_anthropic_runner_module
import langchain_openai_runner as langchain_openai_runner_module
from langchain_runner_common import (
    coerce_direct_evidence,
    invoke_plain_json_fallback,
    normalize_contract_response,
    normalize_expand_like_patch,
)
from openai_context import OpenAIContext
import openai_runner as openai_runner_module
from provider_smoke import run_fixture_set_smoke, run_smoke
from provider_runner import build_runner_command
import runner_compare
from source_context_scenario import fixture_set_cases


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def build_request_payload(
    *,
    node_id: str = "node-1",
    capability: str = "expand",
    explore_by: Optional[str] = None,
) -> dict:
    payload = {
        "version": 2,
        "kind": (
            "nodex_ai_expand_request"
            if capability == "expand"
            else "nodex_ai_explore_request"
        ),
        "capability": capability,
        "workspace_name": "test-workspace",
        "target_node": {
            "id": node_id,
            "title": "Test Target",
            "body": "Source-backed branch context.",
            "kind": "topic",
        },
        "system_prompt": "You are a test runner.",
        "user_prompt": "Expand the node.",
        "output_instructions": "Return JSON only.",
        "contract": {
            "version": 2,
            "response_kind": "nodex_ai_patch_response",
            "patch_version": 1,
        },
    }
    if capability == "explore":
        payload["explore_by"] = explore_by or "question"
    return payload


def build_mixed_offline_runner_specs() -> list[dict]:
    fake_preset = {
        "langchain-pilot": [
            ("openai-minimal", "python3 scripts/openai_runner.py"),
            ("langchain-openai", "python3 scripts/langchain_openai_runner.py"),
            (
                "langchain-anthropic",
                runner_compare.build_compare_offline_command("langchain-anthropic"),
            ),
        ]
    }
    with patch.object(runner_compare, "preset_runners", return_value=fake_preset):
        return runner_compare.build_runner_specs(
            preset_names=["langchain-pilot"],
            explicit_specs=[],
            preset_offline_mode="openai",
        )


def run_mixed_offline_compare(*, scenario: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="nodex-mixed-compare-") as tmp_dir:
        return runner_compare.compare_runners(
            workspace_dir=Path(tmp_dir),
            runner_specs=build_mixed_offline_runner_specs(),
            node_id="root",
            scenario=scenario,
            fixture_path=FIXTURE_PATH,
        )


def fake_openai_key() -> str:
    return "openai-test-key"


def fake_anthropic_key() -> str:
    return "anthropic-test-key"


def build_cited_evidence_payload() -> list[dict]:
    return [
        {
            "source_id": "source-1",
            "original_name": "fixture.md",
            "chunks": [
                {
                    "chunk_id": "chunk-1",
                    "label": "Provider Authentication Flow",
                    "start_line": 7,
                    "end_line": 9,
                }
            ],
        }
    ]


STANDARDIZED_SERVER_ERROR_DETAIL = "[server_error] HTTP 502: Upstream request failed"
STANDARDIZED_RATE_LIMIT_DETAIL = "[rate_limit] HTTP 429: Too many requests"
STANDARDIZED_QUOTA_DETAIL = "[quota] HTTP 429: Insufficient balance"
STANDARDIZED_PERMISSION_DETAIL = "[permission] HTTP 403: Access denied"
STANDARDIZED_INVALID_REQUEST_DETAIL = (
    "[invalid_request] HTTP 400: Request contract contains incompatible fields"
)
STANDARDIZED_HTTP_ERROR_DETAIL = "[http_error] HTTP 404: Resource not found"
STANDARDIZED_NETWORK_DETAIL = "[network] Connection error while contacting provider"
STANDARDIZED_TIMEOUT_DETAIL = "[timeout] Runner request timed out"
GENERIC_RUNNER_BUNDLE_ERROR_DETAIL = (
    "[runner] Process exited with status 17 while preparing result bundle."
)
STANDARDIZED_COMPAT_AUTH_MESSAGE = (
    "\\u8eab\\u4efd\\u9a8c\\u8bc1\\u5931\\u8d25\\u3002"
    .encode("utf-8")
    .decode("unicode_escape")
)


def build_standardized_compat_auth_detail() -> str:
    return (
        "[runner_error] LangChain Anthropic runner failed: "
        f"Error code: 401 - {{'error': {{'message': '{STANDARDIZED_COMPAT_AUTH_MESSAGE}', 'type': '1000'}}}}"
    )


def build_history_backed_failure_metadata(*, category: str, message: str) -> dict:
    return {
        "provider": "fake-runner",
        "model": "fake-model",
        "provider_run_id": None,
        "retry_count": 0,
        "used_plain_json_fallback": False,
        "normalization_notes": [],
        "last_error_category": category,
        "last_error_message": message,
        "last_status_code": 502 if category == "server_error" else None,
    }


def build_langchain_fallback_request_payload(
    *,
    node_id: str,
    title: str,
    body: str,
    cited_evidence: Optional[list[dict]] = None,
) -> dict:
    payload = build_request_payload(node_id=node_id)
    payload["target_node"]["title"] = title
    payload["target_node"]["body"] = body
    if cited_evidence is not None:
        payload["cited_evidence"] = cited_evidence
    return payload


def normalize_langchain_fallback_response(
    *,
    request_payload: dict,
    direct_evidence: Optional[list[dict]] = None,
    patch_ops: Optional[list[dict]] = None,
    rationale_summary: str = "Fallback scaffold response.",
) -> dict:
    return normalize_contract_response(
        contract_response={
            "explanation": {
                "rationale_summary": rationale_summary,
                "direct_evidence": direct_evidence or [],
                "inferred_suggestions": [],
            },
            "notes": [],
            "patch": {"ops": patch_ops or []},
        },
        request_payload=request_payload,
        provider="langchain_openai",
        model="gpt-5.4-mini",
    )


def write_request_paths(tmp_dir: str, request_payload: dict) -> tuple[Path, Path, Path]:
    request_path = Path(tmp_dir) / "request.json"
    response_path = Path(tmp_dir) / "response.json"
    metadata_path = Path(tmp_dir) / "metadata.json"
    request_path.write_text(json.dumps(request_payload, indent=2), encoding="utf-8")
    return request_path, response_path, metadata_path


def build_openai_context() -> OpenAIContext:
    return OpenAIContext(
        repo_root=REPO_ROOT,
        env_file_path=None,
        api_key="test-openai-key-123456789012",
        model="gpt-5.4-mini",
        base_url="https://openai.example/v1",
        reasoning_effort="medium",
        timeout_seconds=30,
        process_openai_env={},
        shell_openai_env_candidates=[],
    )


def build_anthropic_context() -> AnthropicContext:
    return AnthropicContext(
        repo_root=REPO_ROOT,
        env_file_path=None,
        api_key="test-anthropic-key-123456789012",
        model="claude-test",
        base_url="https://anthropic.example",
        timeout_seconds=30,
        process_anthropic_env={},
        shell_anthropic_env_candidates=[],
    )


class FakeHttpResponse:
    def __init__(self, *, status_code: int, body: dict, headers: Optional[dict] = None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}
        self.text = json.dumps(body)

    def json(self) -> dict:
        return self._body


class FakeHttpStatusError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        body: dict,
        message: str,
        headers: Optional[dict] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body
        self.response = FakeHttpResponse(
            status_code=status_code,
            body=body,
            headers=headers,
        )


def build_fake_openai_chat_class_for_structured_error(error: Exception):
    class FakeStructuredLlm:
        def invoke(self, messages):
            raise error

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def with_structured_output(self, schema, method=None):
            return FakeStructuredLlm()

    return FakeChatOpenAI


def capture_openai_invoke_runner_failure(
    *,
    node_id: str,
    error: Exception,
) -> tuple[RunnerFailure, dict]:
    metadata = {"used_plain_json_fallback": False}

    with patch.object(
        langchain_openai_runner_module,
        "load_langchain_openai_class",
        return_value=build_fake_openai_chat_class_for_structured_error(error),
    ), patch.object(
        langchain_openai_runner_module,
        "invoke_plain_json_fallback",
        side_effect=AssertionError("fallback should not be called"),
    ):
        try:
            langchain_openai_runner_module.invoke_langchain_openai(
                request_payload=build_request_payload(node_id=node_id),
                api_key=fake_openai_key(),
                model="gpt-5.4-mini",
                base_url="https://openai.example/v1",
                timeout=30,
                max_retries=1,
                metadata=metadata,
            )
        except RunnerFailure as exc:
            return exc, metadata

    raise AssertionError("expected invoke_langchain_openai to raise RunnerFailure")


class ProviderToolScriptsTests(unittest.TestCase):
    def test_desktop_flow_smoke_defaults_to_openai_provider_route(self) -> None:
        self.assertEqual(DEFAULT_DESKTOP_FLOW_PROVIDER, "openai")

    def test_desktop_flow_smoke_default_route_matches_desktop_default_command(self) -> None:
        with patch(
            "desktop_flow_smoke.load_provider_payload",
            return_value={"summary": {"has_auth": True}},
        ):
            command, summary, command_source = resolve_runner_command(
                provider="openai",
                runner_command=None,
                passthrough=[],
                scripts_dir=REPO_ROOT / "scripts",
            )

        self.assertEqual(command_source, "default")
        self.assertEqual(summary, {"has_auth": True})
        self.assertIn("provider_runner.py", command)
        self.assertIn("--provider openai", command)
        self.assertIn("--use-default-args", command)

    def test_desktop_flow_smoke_default_route_ai_status_contract_becomes_a_hard_gate(self) -> None:
        desktop_flow = {
            "ok": True,
            "checks": {
                "workspace_initialized": True,
            },
        }

        aligned = apply_default_ai_status_contract(
            desktop_flow=desktop_flow,
            ai_status={
                "provider": "openai",
                "runner": "provider_runner.py",
                "uses_provider_defaults": True,
                "status_error": None,
            },
            provider="openai",
            command_source="default",
        )

        self.assertTrue(aligned["ok"])
        self.assertTrue(aligned["checks"]["default_ai_status_provider"])
        self.assertTrue(aligned["checks"]["default_ai_status_runner"])
        self.assertTrue(aligned["checks"]["default_ai_status_uses_provider_defaults"])
        self.assertTrue(aligned["checks"]["default_ai_status_has_no_status_error"])

        drifted = apply_default_ai_status_contract(
            desktop_flow={
                "ok": True,
                "checks": {
                    "workspace_initialized": True,
                },
            },
            ai_status={
                "provider": "openai",
                "runner": "langchain_openai_runner.py",
                "uses_provider_defaults": False,
                "status_error": None,
            },
            provider="openai",
            command_source="default",
        )

        self.assertFalse(drifted["ok"])
        self.assertFalse(drifted["checks"]["default_ai_status_runner"])
        self.assertFalse(
            drifted["checks"]["default_ai_status_uses_provider_defaults"]
        )

    def test_compare_offline_runner_source_context_builds_semantic_env_var_blueprint(self) -> None:
        request_payload = build_request_payload(node_id="node-1")
        request_payload["target_node"]["title"] = "Provider Authentication Flow"
        request_payload["target_node"]["body"] = (
            "Local configuration is expected to define "
            "`OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`. "
            "The desktop default route now prefers the OpenAI-compatible LangChain runner."
        )
        request_payload["cited_evidence"] = [
            {
                "source_id": "source-1",
                "original_name": "fixture.md",
                "chunks": [
                    {
                        "chunk_id": "chunk-1",
                        "label": "Provider Authentication Flow",
                        "start_line": 1,
                        "end_line": 3,
                    }
                ],
            }
        ]

        response = compare_offline_runner.build_contract_response(
            request_payload=request_payload,
            variant="openai-minimal",
            scenario="source-context",
        )

        self.assertEqual(
            [item["title"] for item in response["patch"]["ops"]],
            [
                "OPENAI_API_KEY",
                "OPENAI_BASE_URL",
                "OPENAI_MODEL",
                "Desktop Default Route",
            ],
        )
        self.assertEqual(
            [item["body"] for item in response["patch"]["ops"]],
            [
                "Secret token used to authenticate requests to the OpenAI-compatible runner",
                "Base URL for routing requests to the OpenAI-compatible API endpoint",
                "Model identifier passed to the OpenAI-compatible LangChain runner",
                "The desktop default now prefers the OpenAI-compatible LangChain runner over other providers",
            ],
        )
        self.assertEqual(
            response["explanation"]["inferred_suggestions"],
            [
                "Add a node for fallback behavior when any of the three variables are missing.",
                "Document how to rotate or refresh OPENAI_API_KEY in local environments.",
                "Capture any environment-specific overrides (dev vs staging vs production) for the base URL or model.",
            ],
        )

    def test_compare_offline_runner_source_root_builds_regression_blueprint(self) -> None:
        request_payload = build_request_payload(node_id="node-1")
        request_payload["target_node"]["title"] = "OpenAI LangChain Regression"
        request_payload["target_node"]["body"] = (
            "This fixture is used to exercise a realistic source-backed AI draft "
            "path in Nodex."
        )

        response = compare_offline_runner.build_contract_response(
            request_payload=request_payload,
            variant="openai-minimal",
            scenario="source-root",
        )

        self.assertEqual(
            [item["title"] for item in response["patch"]["ops"]],
            [
                "Draft Path Trigger Conditions",
                "Source-Backed Chunk Resolution",
                "Regression Scope And Assertions",
                "OpenAI Model Configuration",
            ],
        )
        self.assertEqual(
            response["explanation"]["inferred_suggestions"],
            [
                "Expand Draft Path Trigger Conditions with specific input payloads or environment flags that activate the path.",
                "Populate Regression Scope And Assertions with concrete pass/fail criteria once test specs are available.",
                "Add LangChain chain topology details under OpenAI Model Configuration if chain structure is relevant.",
            ],
        )

    def test_compare_offline_runner_prefers_source_root_target_kind_over_cited_evidence(
        self,
    ) -> None:
        request_payload = build_request_payload(node_id="node-1")
        request_payload["target_node"]["kind"] = "source"
        request_payload["cited_evidence"] = build_cited_evidence_payload()

        self.assertEqual(
            compare_offline_runner.derive_scenario(request_payload),
            "source-root",
        )

    def test_build_patch_ops_structure_reports_position_level_field_differences(self) -> None:
        detail = runner_compare.build_patch_ops_structure(
            [
                {
                    "type": "add_node",
                    "title": "Alpha",
                    "kind": "topic",
                    "body": "Body A",
                },
                {
                    "type": "add_node",
                    "title": "Beta",
                    "kind": "topic",
                    "body": "Body B",
                },
            ],
            [
                {
                    "type": "add_node",
                    "title": "Alpha",
                    "kind": "action",
                    "body": "Body A revised",
                },
                {
                    "type": "add_node",
                    "title": "Gamma",
                    "kind": "topic",
                    "body": "Body C",
                },
            ],
        )

        self.assertEqual(detail["left_count"], 2)
        self.assertEqual(detail["right_count"], 2)
        self.assertEqual(detail["left_kind_counts"], {"topic": 2})
        self.assertEqual(detail["right_kind_counts"], {"action": 1, "topic": 1})
        self.assertFalse(detail["shape_aligned"])
        self.assertEqual(detail["title_overlap_ratio"], 0.5)
        self.assertEqual(detail["body_overlap_ratio"], 0.0)
        self.assertFalse(detail["same_body_sequence"])
        self.assertEqual(
            detail["field_mismatch_counts"],
            {"title": 1, "kind": 1, "body": 2, "left_extra": 0, "right_extra": 0},
        )
        self.assertEqual(
            detail["field_mismatch_positions"],
            {"title": [1], "kind": [0], "body": [0, 1], "left_extra": [], "right_extra": []},
        )
        self.assertEqual(detail["position_details"]["aligned_positions"], 2)
        self.assertEqual(detail["position_details"]["title_match_count"], 1)
        self.assertEqual(detail["position_details"]["kind_match_count"], 1)
        self.assertEqual(detail["position_details"]["body_match_count"], 0)
        self.assertEqual(detail["position_details"]["left_extra_positions"], [])
        self.assertEqual(detail["position_details"]["right_extra_positions"], [])
        self.assertEqual(
            detail["position_details"]["differing_positions"],
            [
                {
                    "position": 0,
                    "title_match": True,
                    "left_title": "Alpha",
                    "right_title": "Alpha",
                    "kind_match": False,
                    "left_kind": "topic",
                    "right_kind": "action",
                    "body_match": False,
                    "left_body": "Body A",
                    "right_body": "Body A revised",
                },
                {
                    "position": 1,
                    "title_match": False,
                    "left_title": "Beta",
                    "right_title": "Gamma",
                    "kind_match": True,
                    "left_kind": "topic",
                    "right_kind": "topic",
                    "body_match": False,
                    "left_body": "Body B",
                    "right_body": "Body C",
                },
            ],
        )

    def test_build_explanation_structure_reports_shared_and_side_specific_refs(self) -> None:
        detail = runner_compare.build_explanation_structure(
            {
                "direct_evidence": [
                    {"source_id": "source-1", "chunk_id": "chunk-a"},
                    {"source_id": "source-2", "chunk_id": "chunk-b"},
                ],
                "inferred_suggestions": [
                    "Keep the current branch focused.",
                    "Attach more evidence.",
                ],
            },
            {
                "direct_evidence": [
                    {"source_id": "source-2", "chunk_id": "chunk-b"},
                    {"source_id": "source-3", "chunk_id": "chunk-c"},
                ],
                "inferred_suggestions": [
                    "Attach more evidence.",
                    "Capture blocker details.",
                ],
            },
        )

        self.assertEqual(detail["shared_direct_evidence_refs"], ["source-2:chunk-b"])
        self.assertEqual(
            detail["left_only_direct_evidence_refs"],
            ["source-1:chunk-a"],
        )
        self.assertEqual(
            detail["right_only_direct_evidence_refs"],
            ["source-3:chunk-c"],
        )
        self.assertEqual(
            detail["shared_inferred_suggestions"],
            ["Attach more evidence."],
        )
        self.assertEqual(
            detail["left_only_inferred_suggestions"],
            ["Keep the current branch focused."],
        )
        self.assertEqual(
            detail["right_only_inferred_suggestions"],
            ["Capture blocker details."],
        )
        self.assertEqual(detail["left_only_direct_evidence_count"], 1)
        self.assertEqual(detail["right_only_direct_evidence_count"], 1)
        self.assertEqual(detail["direct_evidence_overlap_ratio"], 0.5)
        self.assertEqual(detail["shared_inferred_suggestions_count"], 1)
        self.assertEqual(detail["left_only_inferred_suggestions_count"], 1)
        self.assertEqual(detail["right_only_inferred_suggestions_count"], 1)
        self.assertEqual(detail["inferred_overlap_ratio"], 0.5)

    def test_build_patch_ops_structure_uses_normalized_multiset_overlap(self) -> None:
        detail = runner_compare.build_patch_ops_structure(
            [
                {
                    "type": "add_node",
                    "title": "Repeat",
                    "kind": "topic",
                    "body": "Body",
                },
                {
                    "type": "add_node",
                    "title": "Repeat",
                    "kind": "topic",
                    "body": "Body",
                },
            ],
            [
                {
                    "type": "add_node",
                    "title": " Repeat ",
                    "kind": "topic",
                    "body": " Body ",
                },
                {
                    "type": "add_node",
                    "title": "Repeat",
                    "kind": "topic",
                    "body": "Body",
                },
            ],
        )

        self.assertTrue(detail["shape_aligned"])
        self.assertEqual(detail["shared_title_count"], 1)
        self.assertEqual(detail["shared_body_count"], 1)
        self.assertEqual(detail["title_overlap_ratio"], 1.0)
        self.assertEqual(detail["body_overlap_ratio"], 1.0)
        self.assertEqual(
            detail["field_mismatch_counts"],
            {"title": 0, "kind": 0, "body": 0, "left_extra": 0, "right_extra": 0},
        )

    def test_build_explanation_structure_tracks_duplicate_overlap_counts(self) -> None:
        detail = runner_compare.build_explanation_structure(
            {
                "direct_evidence": [
                    {"source_id": "source-1", "chunk_id": "chunk-a"},
                    {"source_id": "source-1", "chunk_id": "chunk-a"},
                ],
                "inferred_suggestions": ["Same", "Same"],
            },
            {
                "direct_evidence": [
                    {"source_id": "source-1", "chunk_id": "chunk-a"},
                ],
                "inferred_suggestions": ["Same"],
            },
        )

        self.assertEqual(
            detail["shared_direct_evidence_refs"],
            ["source-1:chunk-a", "source-1:chunk-a"],
        )
        self.assertEqual(
            detail["left_only_direct_evidence_refs"], []
        )
        self.assertEqual(detail["right_only_direct_evidence_refs"], [])
        self.assertEqual(detail["left_only_direct_evidence_count"], 1)
        self.assertEqual(detail["right_only_direct_evidence_count"], 0)
        self.assertEqual(detail["direct_evidence_overlap_ratio"], 0.5)
        self.assertEqual(detail["shared_inferred_suggestions"], ["Same", "Same"])
        self.assertEqual(detail["left_only_inferred_suggestions"], [])
        self.assertEqual(detail["right_only_inferred_suggestions"], [])
        self.assertEqual(detail["shared_inferred_suggestions_count"], 1)
        self.assertEqual(detail["left_only_inferred_suggestions_count"], 1)
        self.assertEqual(detail["right_only_inferred_suggestions_count"], 0)
        self.assertEqual(detail["inferred_overlap_ratio"], 0.5)

    def test_anthropic_runner_coerces_incomplete_direct_evidence(self) -> None:
        request_payload = {
            "cited_evidence": [
                {
                    "source_id": "source-1",
                    "original_name": "fixture.md",
                    "chunks": [
                        {
                            "chunk_id": "chunk-1",
                            "label": "Provider Authentication Flow",
                            "start_line": 7,
                            "end_line": 9,
                        }
                    ],
                }
            ]
        }

        result = coerce_direct_evidence(
            [
                {
                    "source_id": "source-1",
                    "chunk_id": "chunk-1",
                }
            ],
            request_payload,
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["source_name"], "fixture.md")
        self.assertEqual(result[0]["label"], "Provider Authentication Flow")
        self.assertEqual(result[0]["start_line"], 7)
        self.assertEqual(result[0]["end_line"], 9)
        self.assertTrue(result[0]["why_it_matters"])

    def test_shared_langchain_drops_unresolvable_direct_evidence(self) -> None:
        result = coerce_direct_evidence(
            [{"source_name": "fixture.md", "why_it_matters": "unknown chunk"}],
            {"cited_evidence": []},
        )

        self.assertEqual(result, [])

    def test_anthropic_runner_normalizes_plan_patch_quality(self) -> None:
        request_payload = {
            "capability": "expand",
            "target_node": {
                "id": "node-1",
                "title": "Immediate Milestones",
                "body": "First stabilize the runner, then verify real source nodes, then expand regressions.",
            },
        }
        contract_response = {
            "patch": {
                "summary": "A very long patch summary that should be normalized away in favor of a concise stable summary",
                "ops": [
                    {
                        "type": "add_node",
                        "parent_id": "node-1",
                        "title": "Stabilize Anthropic-compatible LangChain runner for the default route and verify all supporting behavior",
                        "kind": "topic",
                        "body": "Harden the runner so it reliably completes against the Anthropic-compatible API without errors or hangs. Includes fixing streaming, parsing, and retries.",
                    },
                    {
                        "type": "add_node",
                        "parent_id": "node-1",
                        "title": "Verify runner on real imported source nodes",
                        "kind": "topic",
                        "body": "Run the stabilized runner against actual imported source nodes and confirm end-to-end correctness.",
                    },
                ],
            }
        }

        normalized = normalize_expand_like_patch(
            contract_response=contract_response,
            request_payload=request_payload,
        )

        ops = normalized["patch"]["ops"]
        self.assertEqual(normalized["patch"]["summary"], "Expand Immediate Milestones with 2 branches")
        self.assertEqual(ops[0]["kind"], "action")
        self.assertLessEqual(len(ops[0]["title"]), 64)
        self.assertIsNotNone(ops[0]["body"])
        self.assertLessEqual(len(ops[0]["body"]), 140)

    def test_anthropic_runner_prefers_evidence_kind_for_research_context(self) -> None:
        request_payload = {
            "capability": "expand",
            "target_node": {
                "id": "node-2",
                "title": "Key Findings",
                "body": "Research synthesis with evidence, confidence gaps, and follow-up questions.",
            },
        }
        contract_response = {
            "patch": {
                "summary": "Expand Key Findings",
                "ops": [
                    {
                        "type": "add_node",
                        "parent_id": "node-2",
                        "title": "Consistency across pilot runs",
                        "kind": "topic",
                        "body": "Cross-run consistency supports confidence in the finding.",
                    }
                ],
            }
        }

        normalized = normalize_expand_like_patch(
            contract_response=contract_response,
            request_payload=request_payload,
        )

        self.assertEqual(normalized["patch"]["ops"][0]["kind"], "evidence")

    def test_shared_langchain_fallback_parses_fenced_json_text(self) -> None:
        class FakeLlm:
            def invoke(self, messages):
                self.messages = messages
                return type(
                    "FakeResponse",
                    (),
                    {"content": "```json\n{\"status\": \"ok\", \"patch\": {}}\n```"},
                )()

        llm = FakeLlm()
        result = invoke_plain_json_fallback(llm, [("system", "hello")])

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["patch"], {})
        self.assertEqual(llm.messages, [("system", "hello")])

    def test_shared_langchain_fallback_raises_parse_error_for_invalid_json(self) -> None:
        class FakeLlm:
            def invoke(self, messages):
                self.messages = messages
                return type("FakeResponse", (), {"content": "not-json"})()

        with self.assertRaises(RunnerFailure) as ctx:
            invoke_plain_json_fallback(
                FakeLlm(),
                [("human", "hello")],
                invalid_json_message="LangChain fallback failed: {error}",
            )

        self.assertEqual(ctx.exception.category, "parse_error")
        self.assertIn("LangChain fallback failed:", ctx.exception.message)

    def test_shared_langchain_normalize_contract_response_completes_openai_shape(self) -> None:
        request_payload = {
            "capability": "explore",
            "explore_by": "question",
            "target_node": {
                "id": "imported-root",
                "title": "OpenAI LangChain Regression",
                "body": "Research notes, evidence gaps, and open follow-up questions.",
            },
            "contract": {
                "version": 2,
                "patch_version": 1,
                "response_kind": "nodex_ai_patch_response",
            },
        }
        contract_response = {
            "explanation": {
                "rationale_summary": "Ask the next clarifying question from imported evidence.",
                "direct_evidence": [],
                "inferred_suggestions": [],
            },
            "patch": {
                "ops": [
                    {
                        "parent_id": "imported-root",
                        "title": "Clarify imported evidence",
                        "body": "Check the chunk selection before comparing runners.",
                    }
                ]
            }
        }

        normalized = normalize_contract_response(
            contract_response=contract_response,
            request_payload=request_payload,
            provider="langchain_openai",
            model="gpt-5.4-mini",
        )

        self.assertEqual(normalized["kind"], "nodex_ai_patch_response")
        self.assertEqual(normalized["version"], 2)
        self.assertEqual(normalized["request_node_id"], "imported-root")
        self.assertEqual(
            normalized["summary"],
            "Explore OpenAI LangChain Regression by question with 1 branches",
        )
        self.assertEqual(
            normalized["generator"],
            {
                "provider": "langchain_openai",
                "model": "gpt-5.4-mini",
                "run_id": None,
            },
        )
        self.assertEqual(normalized["explanation"]["direct_evidence"], [])
        self.assertEqual(normalized["explanation"]["inferred_suggestions"], [])
        self.assertIn("runner_normalized:inferred_patch_op_types=1", normalized["notes"])
        self.assertEqual(normalized["patch"]["ops"][0]["type"], "add_node")
        self.assertEqual(normalized["patch"]["ops"][0]["kind"], "question")
        self.assertEqual(normalized["patch"]["ops"][0]["parent_id"], "imported-root")

    def test_shared_langchain_normalize_contract_response_does_not_invent_explanation(self) -> None:
        request_payload = {
            "capability": "expand",
            "target_node": {
                "id": "node-3",
                "title": "Imported Root",
                "body": "Expand from imported source context.",
            },
            "contract": {
                "version": 2,
                "patch_version": 1,
                "response_kind": "nodex_ai_patch_response",
            },
        }
        normalized = normalize_contract_response(
            contract_response={
                "patch": {
                    "ops": [
                        {
                            "parent_id": "node-3",
                            "title": "Shared runner branch",
                        }
                    ]
                }
            },
            request_payload=request_payload,
            provider="langchain_openai",
            model="gpt-5.4-mini",
        )

        with self.assertRaises(RunnerFailure) as ctx:
            validate_contract_response(
                contract_response=normalized,
                expected_kind="nodex_ai_patch_response",
                expected_version=2,
                expected_patch_version=1,
            )

        self.assertEqual(ctx.exception.category, "schema_error")
        self.assertIn("missing required keys: explanation", ctx.exception.message)

    def test_shared_langchain_marks_scaffold_fallback_after_custom_normalizer(self) -> None:
        request_payload = {
            "capability": "expand",
            "target_node": {
                "id": "node-4",
                "title": "Fallback Branches",
                "body": "Test runner-authored scaffold visibility.",
            },
        }
        normalized = normalize_expand_like_patch(
            contract_response={
                "notes": [],
                "patch": {
                    "ops": [
                        {
                            "type": "add_node",
                            "parent_id": "node-4",
                            "title": "Original Branch",
                        }
                    ]
                },
            },
            request_payload=request_payload,
            patch_ops_normalizer=lambda ops: [],
        )

        self.assertIn("runner_normalized:fallback_scaffold_ops", normalized["notes"])
        self.assertGreater(len(normalized["patch"]["ops"]), 0)

    def test_shared_langchain_synthesizes_direct_evidence_for_source_backed_fallback_scaffold(self) -> None:
        request_payload = build_langchain_fallback_request_payload(
            node_id="node-fallback",
            title="Provider Authentication Flow",
            body="Fallback scaffold should still carry direct support.",
            cited_evidence=build_cited_evidence_payload(),
        )
        normalized = normalize_langchain_fallback_response(
            request_payload=request_payload
        )

        self.assertIn("runner_normalized:fallback_scaffold_ops", normalized["notes"])
        self.assertIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            normalized["notes"],
        )
        self.assertEqual(len(normalized["explanation"]["direct_evidence"]), 1)
        evidence = normalized["explanation"]["direct_evidence"][0]
        self.assertEqual(evidence["source_id"], "source-1")
        self.assertEqual(evidence["source_name"], "fixture.md")
        self.assertEqual(evidence["chunk_id"], "chunk-1")
        self.assertEqual(evidence["label"], "Provider Authentication Flow")
        self.assertEqual(evidence["start_line"], 7)
        self.assertEqual(evidence["end_line"], 9)
        self.assertIn("Provider Authentication Flow", evidence["why_it_matters"])

    def test_shared_langchain_does_not_synthesize_direct_evidence_without_cited_evidence(self) -> None:
        request_payload = build_langchain_fallback_request_payload(
            node_id="node-no-evidence",
            title="Fallback Branches",
            body="No cited chunks available.",
        )
        normalized = normalize_langchain_fallback_response(
            request_payload=request_payload
        )

        self.assertIn("runner_normalized:fallback_scaffold_ops", normalized["notes"])
        self.assertNotIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            normalized["notes"],
        )
        self.assertEqual(normalized["explanation"]["direct_evidence"], [])

    def test_shared_langchain_keeps_existing_direct_evidence_during_fallback_scaffold(self) -> None:
        request_payload = build_langchain_fallback_request_payload(
            node_id="node-existing-evidence",
            title="Provider Authentication Flow",
            body="Existing direct evidence should survive fallback scaffolding.",
            cited_evidence=build_cited_evidence_payload(),
        )
        normalized = normalize_langchain_fallback_response(
            request_payload=request_payload,
            direct_evidence=[
                {
                    "source_id": "source-1",
                    "chunk_id": "chunk-1",
                }
            ],
        )

        self.assertIn("runner_normalized:fallback_scaffold_ops", normalized["notes"])
        self.assertNotIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            normalized["notes"],
        )
        self.assertEqual(len(normalized["explanation"]["direct_evidence"]), 1)
        evidence = normalized["explanation"]["direct_evidence"][0]
        self.assertEqual(evidence["source_name"], "fixture.md")
        self.assertEqual(evidence["chunk_id"], "chunk-1")

    def test_shared_langchain_does_not_synthesize_direct_evidence_without_fallback_scaffold(self) -> None:
        request_payload = build_langchain_fallback_request_payload(
            node_id="node-non-fallback",
            title="Provider Authentication Flow",
            body="Normal runner output should not synthesize direct evidence.",
            cited_evidence=build_cited_evidence_payload(),
        )
        normalized = normalize_langchain_fallback_response(
            request_payload=request_payload,
            rationale_summary="Normal response.",
            patch_ops=[
                {
                    "type": "add_node",
                    "parent_id": "node-non-fallback",
                    "title": "Normal Branch",
                    "kind": "topic",
                }
            ],
        )

        self.assertNotIn("runner_normalized:fallback_scaffold_ops", normalized["notes"])
        self.assertNotIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            normalized["notes"],
        )
        self.assertEqual(normalized["explanation"]["direct_evidence"], [])

    def test_shared_langchain_preserves_non_add_patch_ops(self) -> None:
        request_payload = {
            "capability": "expand",
            "target_node": {
                "id": "node-5",
                "title": "Preserve Attach Ops",
                "body": "Keep valid patch semantics during shared normalization.",
            },
            "contract": {
                "version": 2,
                "patch_version": 1,
                "response_kind": "nodex_ai_patch_response",
            },
        }
        normalized = normalize_contract_response(
            contract_response={
                "explanation": {
                    "rationale_summary": "Preserve source attachment semantics.",
                    "direct_evidence": [],
                    "inferred_suggestions": [],
                },
                "patch": {
                    "ops": [
                        {
                            "type": "attach_source_chunk",
                            "node_id": "node-5",
                            "chunk_id": "chunk-1",
                        },
                        {
                            "type": "attach_source",
                            "node_id": "node-5",
                            "source_id": "source-1",
                        },
                    ]
                },
            },
            request_payload=request_payload,
            provider="langchain_openai",
            model="gpt-5.4-mini",
        )

        self.assertEqual(
            [item["type"] for item in normalized["patch"]["ops"]],
            ["attach_source_chunk", "attach_source"],
        )

    def test_openai_runner_main_writes_invalid_request_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            request_path, response_path, metadata_path = write_request_paths(
                tmp_dir,
                {"version": 2},
            )

            with patch.dict(
                os.environ,
                {
                    "NODEX_AI_REQUEST": str(request_path),
                    "NODEX_AI_RESPONSE": str(response_path),
                    "NODEX_AI_META": str(metadata_path),
                },
                clear=True,
            ):
                with patch.object(
                    langchain_openai_runner_module,
                    "load_openai_context",
                    return_value=build_openai_context(),
                ):
                    with patch.object(sys, "argv", ["langchain_openai_runner.py"]):
                        with self.assertRaises(SystemExit):
                            langchain_openai_runner_module.main()

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

        self.assertEqual(metadata["last_error_category"], "invalid_request")
        self.assertIn("missing required keys", metadata["last_error_message"])
        self.assertFalse(response_path.exists())

    def test_openai_runner_main_records_fallback_metadata_on_success(self) -> None:
        request_payload = build_request_payload(node_id="openai-node")
        fallback_response = {
            "explanation": {
                "rationale_summary": "Fallback JSON repaired the structured response path.",
                "direct_evidence": [],
                "inferred_suggestions": [],
            },
            "patch": {
                "ops": [
                    {
                        "parent_id": "openai-node",
                        "title": "OpenAI Fallback Branch",
                    }
                ]
            },
        }

        class FakeStructuredLlm:
            def invoke(self, messages):
                return object()

        class FakeChatOpenAI:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema, method=None):
                return FakeStructuredLlm()

            def invoke(self, messages):
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": "```json\n"
                        + json.dumps(fallback_response)
                        + "\n```"
                    },
                )()

        with tempfile.TemporaryDirectory() as tmp_dir:
            request_path, response_path, metadata_path = write_request_paths(
                tmp_dir,
                request_payload,
            )

            with patch.dict(
                os.environ,
                {
                    "NODEX_AI_REQUEST": str(request_path),
                    "NODEX_AI_RESPONSE": str(response_path),
                    "NODEX_AI_META": str(metadata_path),
                },
                clear=True,
            ):
                with patch.object(
                    langchain_openai_runner_module,
                    "load_openai_context",
                    return_value=build_openai_context(),
                ), patch.object(
                    langchain_openai_runner_module,
                    "load_langchain_openai_class",
                    return_value=FakeChatOpenAI,
                ), patch.object(sys, "argv", ["langchain_openai_runner.py"]):
                    exit_code = langchain_openai_runner_module.main()

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            response_payload = json.loads(response_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertTrue(metadata["used_plain_json_fallback"])
        self.assertIn(
            "runner_normalized:inferred_patch_op_types=1",
            metadata["normalization_notes"],
        )
        self.assertIsNone(metadata["last_error_category"])
        self.assertEqual(response_payload["patch"]["ops"][0]["type"], "add_node")

    def test_openai_runner_main_records_schema_error_metadata_after_normalization(self) -> None:
        request_payload = build_request_payload(node_id="schema-node")
        malformed_response = {
            "patch": {
                "ops": [
                    {
                        "parent_id": "schema-node",
                        "title": "Missing Explanation Branch",
                    }
                ]
            }
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            request_path, response_path, metadata_path = write_request_paths(
                tmp_dir,
                request_payload,
            )

            with patch.dict(
                os.environ,
                {
                    "NODEX_AI_REQUEST": str(request_path),
                    "NODEX_AI_RESPONSE": str(response_path),
                    "NODEX_AI_META": str(metadata_path),
                },
                clear=True,
            ):
                with patch.object(
                    langchain_openai_runner_module,
                    "load_openai_context",
                    return_value=build_openai_context(),
                ), patch.object(
                    langchain_openai_runner_module,
                    "invoke_langchain_openai",
                    return_value=malformed_response,
                ), patch.object(sys, "argv", ["langchain_openai_runner.py"]):
                    with self.assertRaises(SystemExit):
                        langchain_openai_runner_module.main()

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

        self.assertEqual(metadata["last_error_category"], "schema_error")
        self.assertIn(
            "runner_normalized:inferred_patch_op_types=1",
            metadata["normalization_notes"],
        )
        self.assertFalse(response_path.exists())

    def test_anthropic_runner_main_records_fallback_metadata_on_success(self) -> None:
        request_payload = build_request_payload(node_id="anthropic-node")
        fallback_response = {
            "explanation": {
                "rationale_summary": "Fallback JSON repaired the Anthropic structured path.",
                "direct_evidence": [],
                "inferred_suggestions": [],
            },
            "patch": {
                "ops": [
                    {
                        "parent_id": "anthropic-node",
                        "title": "Anthropic Fallback Branch",
                    }
                ]
            },
        }

        class FakeStructuredLlm:
            def invoke(self, messages):
                return object()

        class FakeChatAnthropic:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema):
                return FakeStructuredLlm()

            def invoke(self, messages):
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": "```json\n"
                        + json.dumps(fallback_response)
                        + "\n```"
                    },
                )()

        with tempfile.TemporaryDirectory() as tmp_dir:
            request_path, response_path, metadata_path = write_request_paths(
                tmp_dir,
                request_payload,
            )

            with patch.dict(
                os.environ,
                {
                    "NODEX_AI_REQUEST": str(request_path),
                    "NODEX_AI_RESPONSE": str(response_path),
                    "NODEX_AI_META": str(metadata_path),
                },
                clear=True,
            ):
                with patch.object(
                    langchain_anthropic_runner_module,
                    "load_anthropic_context",
                    return_value=build_anthropic_context(),
                ), patch.object(
                    langchain_anthropic_runner_module,
                    "load_langchain_anthropic_class",
                    return_value=FakeChatAnthropic,
                ), patch.object(sys, "argv", ["langchain_anthropic_runner.py"]):
                    exit_code = langchain_anthropic_runner_module.main()

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertTrue(metadata["used_plain_json_fallback"])
        self.assertIn(
            "runner_normalized:inferred_patch_op_types=1",
            metadata["normalization_notes"],
        )
        self.assertIsNone(metadata["last_error_category"])

    def test_anthropic_runner_main_synthesizes_direct_evidence_for_source_backed_fallback_scaffold(self) -> None:
        request_payload = build_request_payload(node_id="anthropic-fallback-node")
        request_payload["target_node"]["title"] = "Provider Authentication Flow"
        request_payload["target_node"]["body"] = (
            "Fallback scaffold should keep cited support visible on the Anthropic lane."
        )
        request_payload["cited_evidence"] = build_cited_evidence_payload()
        fallback_response = {
            "explanation": {
                "rationale_summary": "Fallback scaffold response.",
                "direct_evidence": [],
                "inferred_suggestions": [],
            },
            "notes": [],
            "patch": {"ops": []},
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            request_path, response_path, metadata_path = write_request_paths(
                tmp_dir,
                request_payload,
            )

            with patch.dict(
                os.environ,
                {
                    "NODEX_AI_REQUEST": str(request_path),
                    "NODEX_AI_RESPONSE": str(response_path),
                    "NODEX_AI_META": str(metadata_path),
                },
                clear=True,
            ):
                with patch.object(
                    langchain_anthropic_runner_module,
                    "load_anthropic_context",
                    return_value=build_anthropic_context(),
                ), patch.object(
                    langchain_anthropic_runner_module,
                    "invoke_langchain_anthropic",
                    return_value=fallback_response,
                ), patch.object(sys, "argv", ["langchain_anthropic_runner.py"]):
                    exit_code = langchain_anthropic_runner_module.main()

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            response_payload = json.loads(response_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertFalse(metadata["used_plain_json_fallback"])
        self.assertIn(
            "runner_normalized:fallback_scaffold_ops",
            metadata["normalization_notes"],
        )
        self.assertIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            metadata["normalization_notes"],
        )
        self.assertEqual(len(response_payload["explanation"]["direct_evidence"]), 1)
        evidence = response_payload["explanation"]["direct_evidence"][0]
        self.assertEqual(evidence["source_id"], "source-1")
        self.assertEqual(evidence["source_name"], "fixture.md")
        self.assertEqual(evidence["chunk_id"], "chunk-1")
        self.assertEqual(evidence["start_line"], 7)
        self.assertEqual(evidence["end_line"], 9)

    def test_openai_invoke_preserves_auth_failure_without_plain_json_fallback(self) -> None:
        exc, metadata = capture_openai_invoke_runner_failure(
            node_id="auth-node",
            error=RunnerFailure(category="auth", message="401 unauthorized"),
        )

        self.assertEqual(exc.category, "auth")
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_invoke_wraps_runtime_error_without_plain_json_fallback(self) -> None:
        exc, metadata = capture_openai_invoke_runner_failure(
            node_id="runtime-node",
            error=RuntimeError("socket closed"),
        )

        self.assertEqual(exc.category, "runner_error")
        self.assertIn("socket closed", exc.message)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_invoke_classifies_connection_error_as_network(self) -> None:
        exc, metadata = capture_openai_invoke_runner_failure(
            node_id="network-node",
            error=RuntimeError("Connection error."),
        )

        self.assertEqual(exc.category, "network")
        self.assertIn("Connection error", exc.message)
        self.assertTrue(exc.retryable)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_invoke_classifies_timeout_shaped_connection_error_as_timeout(self) -> None:
        exc, metadata = capture_openai_invoke_runner_failure(
            node_id="timeout-node",
            error=RuntimeError("Connection error: request timed out"),
        )

        self.assertEqual(exc.category, "timeout")
        self.assertIn("timed out", exc.message)
        self.assertTrue(exc.retryable)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_invoke_classifies_http_quota_shaped_runtime_error_as_quota(
        self,
    ) -> None:
        exc, metadata = capture_openai_invoke_runner_failure(
            node_id="quota-node",
            error=FakeHttpStatusError(
                status_code=400,
                body={
                    "error": {
                        "message": "relay: 账户余额不足",
                        "type": "invalid_request_error",
                    }
                },
                message=(
                    "Error code: 400 - {'error': {'message': 'relay: 账户余额不足', "
                    "'type': 'invalid_request_error'}}"
                ),
            ),
        )

        self.assertEqual(exc.category, "quota")
        self.assertEqual(exc.status_code, 400)
        self.assertIn("账户余额不足", exc.message)
        self.assertFalse(exc.retryable)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_invoke_classifies_http_invalid_request_runtime_error(
        self,
    ) -> None:
        exc, metadata = capture_openai_invoke_runner_failure(
            node_id="invalid-request-node",
            error=FakeHttpStatusError(
                status_code=400,
                body={
                    "error": {
                        "message": "Prompt field is invalid",
                        "type": "invalid_request_error",
                    }
                },
                message=(
                    "Error code: 400 - {'error': {'message': 'Prompt field is invalid', "
                    "'type': 'invalid_request_error'}}"
                ),
            ),
        )

        self.assertEqual(exc.category, "invalid_request")
        self.assertEqual(exc.status_code, 400)
        self.assertIn("Prompt field is invalid", exc.message)
        self.assertFalse(exc.retryable)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_runner_normalizes_root_base_url_to_responses_endpoint(self) -> None:
        self.assertEqual(
            openai_runner_module.normalize_responses_base_url("https://openai.example/v1"),
            "https://openai.example/v1/responses",
        )
        self.assertEqual(
            openai_runner_module.normalize_responses_base_url(
                "https://openai.example/v1/responses"
            ),
            "https://openai.example/v1/responses",
        )

    def test_openai_structured_schema_includes_title_and_description(self) -> None:
        captured = {}

        class FakeLlm:
            def with_structured_output(self, schema, method=None):
                captured["schema"] = schema
                captured["method"] = method
                return object()

        langchain_openai_runner_module.build_structured_llm(FakeLlm())

        self.assertEqual(captured["method"], "json_schema")
        self.assertEqual(captured["schema"]["title"], "NodexAiPatchResponse")
        self.assertIn(
            "Structured Nodex AI patch response contract",
            captured["schema"]["description"],
        )

    def test_anthropic_invoke_preserves_auth_failure_without_plain_json_fallback(self) -> None:
        class FakeStructuredLlm:
            def invoke(self, messages):
                raise RunnerFailure(category="auth", message="401 unauthorized")

        class FakeChatAnthropic:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_anthropic_runner_module,
            "load_langchain_anthropic_class",
            return_value=FakeChatAnthropic,
        ), patch.object(
            langchain_anthropic_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_anthropic_runner_module.invoke_langchain_anthropic(
                    request_payload=build_request_payload(node_id="anthropic-auth-node"),
                    api_key="test-anthropic-key-123456789012",
                    model="claude-test",
                    base_url="https://anthropic.example",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "auth")
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_anthropic_invoke_classifies_http_auth_runtime_error_as_auth(self) -> None:
        auth_message = STANDARDIZED_COMPAT_AUTH_MESSAGE
        runtime_error_message = (
            "Error code: 401 - {'error': {'message': '%s', 'type': '1000'}}"
            % auth_message
        )

        class FakeStructuredLlm:
            def invoke(self, messages):
                raise FakeHttpStatusError(
                    status_code=401,
                    body={
                        "error": {
                            "message": auth_message,
                            "type": "1000",
                        }
                    },
                    message=runtime_error_message,
                )

        class FakeChatAnthropic:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_anthropic_runner_module,
            "load_langchain_anthropic_class",
            return_value=FakeChatAnthropic,
        ), patch.object(
            langchain_anthropic_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_anthropic_runner_module.invoke_langchain_anthropic(
                    request_payload=build_request_payload(node_id="anthropic-http-auth-node"),
                    api_key=fake_anthropic_key(),
                    model="claude-test",
                    base_url="https://anthropic.example",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "auth")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn(auth_message, ctx.exception.message)
        self.assertFalse(ctx.exception.retryable)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_anthropic_invoke_classifies_http_rate_limit_runtime_error(self) -> None:
        rate_limit_message = "Too many requests, retry later."

        class FakeStructuredLlm:
            def invoke(self, messages):
                raise FakeHttpStatusError(
                    status_code=429,
                    body={
                        "error": {
                            "message": rate_limit_message,
                            "type": "rate_limit_error",
                        }
                    },
                    message=(
                        "Error code: 429 - {'error': {'message': "
                        f"'{rate_limit_message}', 'type': 'rate_limit_error'}}"
                    ),
                    headers={"Retry-After": "2"},
                )

        class FakeChatAnthropic:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_anthropic_runner_module,
            "load_langchain_anthropic_class",
            return_value=FakeChatAnthropic,
        ), patch.object(
            langchain_anthropic_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_anthropic_runner_module.invoke_langchain_anthropic(
                    request_payload=build_request_payload(
                        node_id="anthropic-rate-limit-node"
                    ),
                    api_key=fake_anthropic_key(),
                    model="claude-test",
                    base_url="https://anthropic.example",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "rate_limit")
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn(rate_limit_message, ctx.exception.message)
        self.assertTrue(ctx.exception.retryable)
        self.assertEqual(ctx.exception.retry_after, 2.0)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_anthropic_invoke_wraps_runtime_error_without_plain_json_fallback(self) -> None:
        class FakeStructuredLlm:
            def invoke(self, messages):
                raise RuntimeError("socket closed")

        class FakeChatAnthropic:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_anthropic_runner_module,
            "load_langchain_anthropic_class",
            return_value=FakeChatAnthropic,
        ), patch.object(
            langchain_anthropic_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_anthropic_runner_module.invoke_langchain_anthropic(
                    request_payload=build_request_payload(node_id="anthropic-runtime-node"),
                    api_key="test-anthropic-key-123456789012",
                    model="claude-test",
                    base_url="https://anthropic.example",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "runner_error")
        self.assertIn("socket closed", ctx.exception.message)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_anthropic_invoke_classifies_connection_error_as_network(self) -> None:
        class FakeStructuredLlm:
            def invoke(self, messages):
                raise RuntimeError("Connection error.")

        class FakeChatAnthropic:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_anthropic_runner_module,
            "load_langchain_anthropic_class",
            return_value=FakeChatAnthropic,
        ), patch.object(
            langchain_anthropic_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_anthropic_runner_module.invoke_langchain_anthropic(
                    request_payload=build_request_payload(node_id="anthropic-network-node"),
                    api_key=fake_anthropic_key(),
                    model="claude-test",
                    base_url="https://anthropic.example",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "network")
        self.assertIn("Connection error", ctx.exception.message)
        self.assertTrue(ctx.exception.retryable)
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_runner_compare_lists_presets(self) -> None:
        result = run_script("scripts/runner_compare.py", "--list-presets")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("langchain-pilot", result.stdout)
        self.assertIn("langchain-openai", result.stdout)
        self.assertIn("langchain-anthropic", result.stdout)

    def test_provider_smoke_quality_surfaces_runner_metadata_flags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'metadata smoke summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'metadata smoke rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake-model',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'metadata smoke summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Metadata Smoke Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from smoke metadata test',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "metadata = {",
                        "    'provider': 'fake_runner',",
                        "    'model': 'fake-model',",
                        "    'provider_run_id': 'provider-run-1',",
                        "    'retry_count': 0,",
                        "    'used_plain_json_fallback': True,",
                        "    'normalization_notes': [",
                        "        'runner_normalized:fallback_scaffold_ops',",
                        "        'runner_normalized:inferred_patch_op_types=1',",
                        "    ],",
                        "    'last_error_category': None,",
                        "    'last_error_message': None,",
                        "    'last_status_code': None,",
                        "}",
                        "Path(os.environ['NODEX_AI_META']).write_text(json.dumps(metadata, indent=2))",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_dir=Path(tmp_dir),
                node_id="root",
                scenario="minimal",
                fixture_path=None,
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=False,
                json_mode=True,
            )

        self.assertTrue(result["quality"]["used_plain_json_fallback"])
        self.assertEqual(result["quality"]["normalization_note_count"], 2)
        self.assertTrue(result["quality"]["has_normalization_notes"])
        self.assertIn(
            "runner_normalized:fallback_scaffold_ops",
            result["quality"]["normalization_notes"],
        )
        self.assertTrue(
            result["run_external_json"]["metadata"]["used_plain_json_fallback"]
        )
        self.assertTrue(
            result["verification"]["ai_run"]["history_used_plain_json_fallback"]
        )
        self.assertTrue(
            result["verification"]["ai_run"]["show_used_plain_json_fallback"]
        )
        self.assertTrue(result["verification"]["ai_run"]["history_metadata_flags_match"])
        self.assertTrue(result["verification"]["ai_run"]["show_metadata_flags_match"])
        self.assertEqual(
            result["verification"]["ai_run"]["show_normalization_note_count"],
            2,
        )
        self.assertCountEqual(
            result["verification"]["ai_run"]["history_normalization_notes"],
            [
                "runner_normalized:inferred_patch_op_types=1",
                "runner_normalized:fallback_scaffold_ops",
            ],
        )
        self.assertCountEqual(
            result["verification"]["ai_run"]["show_normalization_notes"],
            [
                "runner_normalized:inferred_patch_op_types=1",
                "runner_normalized:fallback_scaffold_ops",
            ],
        )

    def test_runner_compare_surfaces_runner_metadata_flags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "import sys",
                        "from pathlib import Path",
                        "",
                        "label = sys.argv[1]",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "used_fallback = label == 'left'",
                        "notes = ['runner_normalized:fallback_scaffold_ops'] if used_fallback else []",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'shared summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'shared rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': label,",
                        "        'run_id': label,",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'shared summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Shared Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Shared body',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "metadata = {",
                        "    'provider': 'fake_runner',",
                        "    'model': label,",
                        "    'provider_run_id': label,",
                        "    'retry_count': 0,",
                        "    'used_plain_json_fallback': used_fallback,",
                        "    'normalization_notes': notes,",
                        "    'last_error_category': None,",
                        "    'last_error_message': None,",
                        "    'last_status_code': None,",
                        "}",
                        "Path(os.environ['NODEX_AI_META']).write_text(json.dumps(metadata, indent=2))",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            left_command = shlex.join([sys.executable, str(fake_runner), "left"])
            right_command = shlex.join([sys.executable, str(fake_runner), "right"])
            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--scenario",
                "source-root",
                "--fixture",
                str(FIXTURE_PATH),
                "--runner",
                f"left={left_command}",
                "--runner",
                f"right={right_command}",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["runner_metrics"]["left"]["used_plain_json_fallback"])
        self.assertFalse(payload["runner_metrics"]["right"]["used_plain_json_fallback"])
        self.assertEqual(
            payload["runner_metrics"]["left"]["normalization_note_count"],
            1,
        )
        self.assertEqual(
            payload["runner_metrics"]["right"]["normalization_note_count"],
            0,
        )
        comparison = payload["comparisons"][0]["comparison"]
        self.assertFalse(comparison["same_used_plain_json_fallback"])
        self.assertFalse(comparison["same_normalization_notes"])
        self.assertEqual(
            comparison["difference_kinds"],
            ["used_plain_json_fallback", "normalization_notes"],
        )

    def test_runner_compare_classifies_failed_runners(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "import sys",
                        "from pathlib import Path",
                        "",
                        "mode = sys.argv[1]",
                        "if mode == 'missing-dependency':",
                        "    sys.stderr.write(\"[config] Missing `langchain-openai`. Install it with `python3 -m pip install -U langchain-openai` before using this pilot runner.\\n\")",
                        "    raise SystemExit(1)",
                        "if mode == 'invalid-auth':",
                        "    sys.stderr.write('[auth] HTTP 401: {\"code\":\"INVALID_API_KEY\",\"message\":\"Invalid API key\"}\\n')",
                        "    raise SystemExit(1)",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'success summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'success rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'success',",
                        "        'run_id': 'success-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'success summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Success Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated by success runner',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            success_command = shlex.join([sys.executable, str(fake_runner), "success"])
            missing_dep_command = shlex.join(
                [sys.executable, str(fake_runner), "missing-dependency"]
            )
            invalid_auth_command = shlex.join(
                [sys.executable, str(fake_runner), "invalid-auth"]
            )

            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--scenario",
                "source-root",
                "--fixture",
                str(FIXTURE_PATH),
                "--runner",
                f"success={success_command}",
                "--runner",
                f"missing={missing_dep_command}",
                "--runner",
                f"auth={invalid_auth_command}",
            )

        self.assertEqual(result.returncode, 1, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["successful_runs"], 1)
        self.assertEqual(payload["failed_runs"], 2)
        failed = {item["label"]: item for item in payload["runs"] if item["status"] == "failed"}
        self.assertEqual(failed["missing"]["failure_kind"], "missing_dependency")
        self.assertIn("langchain-openai", failed["missing"]["failure_summary"])
        self.assertEqual(failed["missing"]["failure_source"], "stderr")
        self.assertEqual(failed["auth"]["failure_kind"], "auth_invalid")
        self.assertEqual(failed["auth"]["failure_source"], "history_metadata")
        self.assertEqual(
            payload["failure_metrics"]["counts"],
            {"auth_invalid": 1, "missing_dependency": 1},
        )
        self.assertEqual(payload["scenario"], "source-root")
        self.assertEqual(
            payload["node_id"],
            payload["scenario_context"]["imported_root_node"]["id"],
        )
        readiness = payload["comparison_readiness"]
        self.assertEqual(readiness["status"], "blocked")
        self.assertFalse(readiness["compare_ready"])
        self.assertFalse(readiness["all_pairs_compared"])
        self.assertEqual(readiness["comparable_pairs"], 0)
        self.assertEqual(readiness["blocked_pairs"], 3)
        self.assertEqual(
            readiness["blocker_counts"],
            {"auth_invalid": 2, "missing_dependency": 2},
        )
        blocked = {
            frozenset((item["left_label"], item["right_label"])): item
            for item in payload["blocked_comparisons"]
        }
        self.assertEqual(len(blocked), 3)
        self.assertEqual(
            blocked[frozenset(("success", "missing"))]["blocker_kinds"],
            ["missing_dependency"],
        )
        missing_blocker = blocked[frozenset(("success", "missing"))]["blocked_by"][0]
        self.assertEqual(missing_blocker["failure_source"], "stderr")
        self.assertEqual(
            blocked[frozenset(("success", "auth"))]["blocker_kinds"],
            ["auth_invalid"],
        )
        auth_blocker = blocked[frozenset(("success", "auth"))]["blocked_by"][0]
        self.assertEqual(auth_blocker["failure_source"], "history_metadata")
        self.assertCountEqual(
            blocked[frozenset(("missing", "auth"))]["blocker_kinds"],
            ["missing_dependency", "auth_invalid"],
        )

    def test_runner_compare_classifies_standardized_online_failures(self) -> None:
        server_failure = runner_compare.classify_run_failure(
            STANDARDIZED_SERVER_ERROR_DETAIL,
            spec={
                "label": "openai-minimal",
                "source": "langchain-pilot",
                "offline_substitute": False,
            },
        )
        self.assertEqual(server_failure["kind"], "server_error")
        self.assertIn("HTTP 502", server_failure["summary"])
        self.assertIn("--preset-offline openai", server_failure["hint"])

        anthropic_server_failure = runner_compare.classify_run_failure(
            STANDARDIZED_SERVER_ERROR_DETAIL,
            spec={
                "label": "langchain-anthropic",
                "source": "langchain-pilot",
                "offline_substitute": False,
            },
        )
        self.assertEqual(anthropic_server_failure["hint"], "Retry compare later. If you only need structural regression coverage for this preset, rerun with `--preset-offline all`.")

        explicit_server_failure = runner_compare.classify_run_failure(
            STANDARDIZED_SERVER_ERROR_DETAIL,
            spec={
                "label": "custom-runner",
                "source": "explicit",
                "offline_substitute": False,
            },
        )
        self.assertEqual(explicit_server_failure["hint"], "Retry compare later.")

        rate_limit_failure = runner_compare.classify_run_failure(
            STANDARDIZED_RATE_LIMIT_DETAIL
        )
        self.assertEqual(rate_limit_failure["kind"], "rate_limit")
        self.assertEqual(
            rate_limit_failure["summary"],
            "Runner was throttled before compare could collect artifacts.",
        )
        self.assertEqual(
            rate_limit_failure["hint"],
            "Wait for provider rate limits to reset, then rerun compare.",
        )
        self.assertEqual(rate_limit_failure["source"], "stderr")

        quota_failure = runner_compare.classify_run_failure(
            STANDARDIZED_QUOTA_DETAIL,
            spec={
                "label": "langchain-openai",
                "source": "langchain-pilot",
                "offline_substitute": False,
            },
        )
        self.assertEqual(quota_failure["kind"], "quota")
        self.assertEqual(
            quota_failure["summary"],
            "Runner exhausted provider quota before compare could complete.",
        )
        self.assertEqual(
            quota_failure["hint"],
            "Restore provider quota or billing, then rerun compare. If you only need structural regression coverage, rerun with `--preset-offline openai` or `--preset-offline all`.",
        )
        self.assertEqual(quota_failure["source"], "stderr")

        permission_failure = runner_compare.classify_run_failure(
            STANDARDIZED_PERMISSION_DETAIL
        )
        self.assertEqual(permission_failure["kind"], "permission")
        self.assertEqual(
            permission_failure["summary"],
            "Runner was denied permission by the provider.",
        )
        self.assertEqual(
            permission_failure["hint"],
            "Check provider permissions and model access for the configured credentials.",
        )
        self.assertEqual(permission_failure["source"], "stderr")

        invalid_request_failure = runner_compare.classify_run_failure(
            STANDARDIZED_INVALID_REQUEST_DETAIL
        )
        self.assertEqual(invalid_request_failure["kind"], "invalid_request")
        self.assertEqual(
            invalid_request_failure["summary"],
            "Runner request was rejected as invalid.",
        )
        self.assertEqual(
            invalid_request_failure["hint"],
            "Inspect the runner error detail and request contract for incompatible fields.",
        )
        self.assertEqual(invalid_request_failure["source"], "stderr")

        http_error_failure = runner_compare.classify_run_failure(
            STANDARDIZED_HTTP_ERROR_DETAIL
        )
        self.assertEqual(http_error_failure["kind"], "http_error")
        self.assertEqual(
            http_error_failure["summary"],
            "Runner returned a non-retryable HTTP error (HTTP 404).",
        )
        self.assertEqual(
            http_error_failure["hint"],
            "Inspect provider compatibility and request configuration before rerunning compare.",
        )
        self.assertEqual(http_error_failure["source"], "stderr")

        network_failure = runner_compare.classify_run_failure(
            STANDARDIZED_NETWORK_DETAIL
        )
        self.assertEqual(network_failure["kind"], "network")
        self.assertEqual(
            network_failure["summary"],
            "Runner hit a network error before compare could collect artifacts.",
        )
        self.assertEqual(
            network_failure["hint"],
            "Check network reachability and provider base URL, then rerun compare.",
        )
        self.assertEqual(network_failure["source"], "stderr")

        timeout_failure = runner_compare.classify_run_failure(
            STANDARDIZED_TIMEOUT_DETAIL
        )
        self.assertEqual(timeout_failure["kind"], "timeout")
        self.assertEqual(
            timeout_failure["summary"],
            "Runner timed out before compare could collect artifacts.",
        )
        self.assertEqual(
            timeout_failure["hint"],
            "Retry compare later or raise the provider timeout for this lane.",
        )
        self.assertEqual(timeout_failure["source"], "stderr")

        auth_failure = runner_compare.classify_run_failure(
            build_standardized_compat_auth_detail()
        )
        self.assertEqual(auth_failure["kind"], "auth_invalid")
        self.assertIn("credentials", auth_failure["summary"].lower())
        self.assertIn(".env.local", auth_failure["hint"])

    def test_runner_compare_classifies_config_error_fallback_from_stderr(self) -> None:
        failure = runner_compare.classify_run_failure(
            "[config] Local provider/runtime setup is incomplete for this runner."
        )
        self.assertEqual(failure["kind"], "config_error")
        self.assertEqual(
            failure["summary"],
            "Runner configuration is incomplete or incompatible.",
        )
        self.assertEqual(
            failure["hint"],
            "Review the runner error detail and local provider/runtime setup.",
        )
        self.assertEqual(failure["source"], "stderr")

    def test_runner_compare_classifies_schema_error_from_failed_run_metadata(
        self,
    ) -> None:
        failure = runner_compare.classify_run_failure(
            GENERIC_RUNNER_BUNDLE_ERROR_DETAIL,
            failed_run_record=build_history_backed_failure_metadata(
                category="schema_error",
                message="Normalized contract response missing required `patch` object.",
            ),
        )
        self.assertEqual(failure["kind"], "schema_error")
        self.assertEqual(
            failure["summary"],
            "Runner returned output that did not match the Nodex contract.",
        )
        self.assertEqual(
            failure["hint"],
            "Inspect the runner response payload and normalization path before rerunning compare.",
        )
        self.assertEqual(failure["source"], "history_metadata")

    def test_runner_compare_classifies_refusal_from_failed_run_metadata(self) -> None:
        failure = runner_compare.classify_run_failure(
            GENERIC_RUNNER_BUNDLE_ERROR_DETAIL,
            failed_run_record=build_history_backed_failure_metadata(
                category="refusal",
                message="model refused the request: safety policy refusal",
            ),
        )
        self.assertEqual(failure["kind"], "refusal")
        self.assertEqual(
            failure["summary"],
            "Runner model refused the request before compare could collect artifacts.",
        )
        self.assertEqual(
            failure["hint"],
            "Inspect the refusal detail and prompt/contract shape before retrying.",
        )
        self.assertEqual(failure["source"], "history_metadata")

    def test_runner_compare_classifies_auth_missing_fallback_from_stderr(self) -> None:
        failure = runner_compare.classify_run_failure(
            "[preflight] Runner has no configured auth for this provider."
        )
        self.assertEqual(failure["kind"], "auth_missing")
        self.assertEqual(
            failure["summary"],
            "No provider credentials are configured.",
        )
        self.assertEqual(
            failure["hint"],
            "Run `python3 scripts/provider_doctor.py --provider <provider>` and set the required auth env var.",
        )
        self.assertEqual(failure["source"], "stderr")

    def test_runner_compare_classifies_auth_error_fallback_from_preset_runner_stderr(
        self,
    ) -> None:
        failure = runner_compare.classify_run_failure(
            "[auth] OPENAI_API_KEY is missing. Set it in the environment or in "
            ".env.local next to the repo."
        )
        expected = runner_compare.build_auth_error_failure()
        self.assertEqual(failure["kind"], "auth_error")
        self.assertEqual(failure["summary"], expected["summary"])
        self.assertEqual(failure["hint"], expected["hint"])
        self.assertEqual(failure["source"], "stderr")

    def test_runner_compare_classifies_invalid_json_fallback_from_stderr(self) -> None:
        failure = runner_compare.classify_run_failure(
            "[runner] Command did not return valid JSON output."
        )
        self.assertEqual(failure["kind"], "invalid_json")
        self.assertEqual(
            failure["summary"],
            "Runner completed without valid JSON output.",
        )
        self.assertEqual(
            failure["hint"],
            "Inspect the runner stdout/stderr and contract response formatting.",
        )
        self.assertEqual(failure["source"], "stderr")

    def test_runner_compare_classifies_runner_error_fallback_from_generic_stderr(
        self,
    ) -> None:
        failure = runner_compare.classify_run_failure(GENERIC_RUNNER_BUNDLE_ERROR_DETAIL)
        self.assertEqual(failure["kind"], "runner_error")
        self.assertEqual(
            failure["summary"],
            "Runner failed before compare could collect artifacts.",
        )
        self.assertIsNone(failure["hint"])
        self.assertEqual(failure["source"], "stderr")

    def test_runner_compare_aggregates_server_and_auth_blockers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "import sys",
                        "from pathlib import Path",
                        "",
                        "mode = sys.argv[1]",
                        "if mode == 'server-error':",
                        f"    sys.stderr.write({STANDARDIZED_SERVER_ERROR_DETAIL!r} + '\\n')",
                        "    raise SystemExit(1)",
                        "if mode == 'compat-auth-401':",
                        f"    sys.stderr.write({build_standardized_compat_auth_detail()!r} + '\\n')",
                        "    raise SystemExit(1)",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': request['target_node']['title'],",
                        "    'explanation': {",
                        "        'rationale_summary': request['target_node']['title'],",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': mode,",
                        "        'run_id': request['target_node']['id'],",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': request['target_node']['title'],",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Success Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated by success runner',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            success_command = shlex.join([sys.executable, str(fake_runner), "success"])
            server_command = shlex.join([sys.executable, str(fake_runner), "server-error"])
            auth_command = shlex.join([sys.executable, str(fake_runner), "compat-auth-401"])

            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--scenario",
                "source-root",
                "--fixture",
                str(FIXTURE_PATH),
                "--runner",
                f"success={success_command}",
                "--runner",
                f"server={server_command}",
                "--runner",
                f"auth={auth_command}",
            )

        self.assertEqual(result.returncode, 1, result.stderr)
        payload = json.loads(result.stdout)
        failed = {item["label"]: item for item in payload["runs"] if item["status"] == "failed"}
        self.assertEqual(failed["server"]["failure_kind"], "server_error")
        self.assertEqual(failed["server"]["failure_hint"], "Retry compare later.")
        self.assertEqual(failed["auth"]["failure_kind"], "auth_invalid")
        self.assertEqual(
            payload["failure_metrics"]["counts"],
            {"auth_invalid": 1, "server_error": 1},
        )
        self.assertEqual(
            payload["comparison_readiness"]["blocker_counts"],
            {"auth_invalid": 2, "server_error": 2},
        )
        blocked = {
            frozenset((item["left_label"], item["right_label"])): item
            for item in payload["blocked_comparisons"]
        }
        self.assertEqual(
            blocked[frozenset(("success", "server"))]["blocker_kinds"],
            ["server_error"],
        )
        self.assertEqual(
            blocked[frozenset(("success", "auth"))]["blocker_kinds"],
            ["auth_invalid"],
        )
        self.assertCountEqual(
            blocked[frozenset(("server", "auth"))]["blocker_kinds"],
            ["server_error", "auth_invalid"],
        )

    def test_runner_compare_prefers_failed_run_metadata_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "import sys",
                        "from pathlib import Path",
                        "",
                        "mode = sys.argv[1]",
                        "if mode == 'metadata-backed-failure':",
                        "    metadata_path = Path(os.environ['NODEX_AI_META'])",
                        f"    metadata_path.write_text(json.dumps({build_history_backed_failure_metadata(category='server_error', message='HTTP 502: Upstream request failed')!r}, indent=2))",
                        "    sys.stderr.write('runner crashed without structured stderr\\n')",
                        "    raise SystemExit(1)",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': request['target_node']['title'],",
                        "    'explanation': {",
                        "        'rationale_summary': request['target_node']['title'],",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': mode,",
                        "        'run_id': request['target_node']['id'],",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': request['target_node']['title'],",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Success Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated by success runner',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            success_command = shlex.join([sys.executable, str(fake_runner), "success"])
            metadata_command = shlex.join(
                [sys.executable, str(fake_runner), "metadata-backed-failure"]
            )

            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--scenario",
                "source-root",
                "--fixture",
                str(FIXTURE_PATH),
                "--runner",
                f"success={success_command}",
                "--runner",
                f"metadata={metadata_command}",
            )

        self.assertEqual(result.returncode, 1, result.stderr)
        payload = json.loads(result.stdout)
        failed = next(
            item for item in payload["runs"] if item["label"] == "metadata"
        )
        self.assertIsNotNone(failed["failed_run_id"])
        self.assertEqual(failed["failure_kind"], "server_error")
        self.assertEqual(failed["failure_source"], "history_metadata")
        self.assertEqual(
            failed["failure_summary"],
            "Runner hit a retry-exhausted upstream server error (HTTP 502).",
        )
        self.assertEqual(failed["failure_hint"], "Retry compare later.")
        blocked = next(
            item
            for item in payload["blocked_comparisons"]
            if item["left_label"] == "success" or item["right_label"] == "success"
        )
        blocker = next(
            item for item in blocked["blocked_by"] if item["label"] == "metadata"
        )
        self.assertEqual(blocker["kind"], "server_error")
        self.assertEqual(blocker["failure_source"], "history_metadata")
        self.assertEqual(blocker["failed_run_id"], failed["failed_run_id"])

    def test_runner_compare_ignores_preexisting_failed_run_matches(self) -> None:
        command = "python3 fake_runner.py repeated-failure"
        with patch.object(
            runner_compare,
            "run_nodex_command",
            return_value=[
                {
                    "id": "new-run",
                    "status": "failed",
                    "node_id": "root",
                    "command": command,
                    "dry_run": True,
                    "last_error_category": None,
                    "last_error_message": "runner crashed without structured stderr",
                    "last_status_code": None,
                },
                {
                    "id": "old-run",
                    "status": "failed",
                    "node_id": "root",
                    "command": command,
                    "dry_run": True,
                    "last_error_category": "server_error",
                    "last_error_message": "HTTP 502: Upstream request failed",
                    "last_status_code": 502,
                },
            ],
        ):
            failed_run_record = runner_compare.load_latest_failed_run_record(
                workspace_dir=Path.cwd(),
                node_id="root",
                command=command,
                previous_run_ids={"old-run"},
            )

        self.assertEqual(failed_run_record["id"], "new-run")
        failure = runner_compare.classify_run_failure(
            "[config] Missing `langchain-openai`. Install it with `python3 -m pip install -U langchain-openai` before using this pilot runner.",
            failed_run_record=failed_run_record,
        )
        self.assertEqual(failure["kind"], "missing_dependency")
        self.assertEqual(failure["source"], "stderr")

    def test_runner_compare_text_report_surfaces_failure_provenance(self) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            runner_compare.print_text_report(
                {
                    "workspace_dir": "/tmp/nodex-compare",
                    "scenario": "source-root",
                    "node_id": "root",
                    "successful_runs": 1,
                    "failed_runs": 1,
                    "runner_count": 2,
                    "runs": [
                        {
                            "label": "success",
                            "command": "python3 success.py",
                            "status": "ok",
                            "run_id": "run-ok",
                            "metadata": {"provider": "fake", "model": "ok"},
                            "report": {
                                "explanation": {"rationale_summary": "ok"},
                                "report": {"summary": "ok"},
                            },
                            "quality": {
                                "used_plain_json_fallback": False,
                                "normalization_note_count": 0,
                            },
                        },
                        {
                            "label": "metadata",
                            "command": "python3 fail.py",
                            "status": "failed",
                            "error": "runner crashed without structured stderr",
                            "failed_run_id": "run-failed",
                            "failure_kind": "server_error",
                            "failure_summary": "Runner hit a retry-exhausted upstream server error (HTTP 502).",
                            "failure_hint": "Retry compare later.",
                            "failure_source": "history_metadata",
                        },
                    ],
                    "comparisons": [],
                    "blocked_comparisons": [
                        {
                            "left_label": "success",
                            "right_label": "metadata",
                            "status": "blocked",
                            "blocked_by": [
                                {
                                    "label": "metadata",
                                    "kind": "server_error",
                                    "summary": "Runner hit a retry-exhausted upstream server error (HTTP 502).",
                                    "failed_run_id": "run-failed",
                                    "failure_source": "history_metadata",
                                }
                            ],
                            "blocker_kinds": ["server_error"],
                        }
                    ],
                    "comparison_readiness": {
                        "status": "blocked",
                        "comparable_pairs": 0,
                        "blocked_pairs": 1,
                    },
                    "failure_metrics": {"counts": {"server_error": 1}},
                    "comparison_metrics": {},
                }
            )
        rendered = buffer.getvalue()
        self.assertIn(
            "provenance: classified from history metadata; failed run run-failed",
            rendered,
        )

    def test_runner_compare_text_report_surfaces_blocked_provenance_in_partial_mode(
        self,
    ) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            runner_compare.print_text_report(
                {
                    "workspace_dir": "/tmp/nodex-compare",
                    "scenario": "source-root",
                    "node_id": "root",
                    "successful_runs": 1,
                    "failed_runs": 1,
                    "runner_count": 2,
                    "runs": [
                        {
                            "label": "success",
                            "command": "python3 success.py",
                            "status": "ok",
                            "run_id": "run-ok",
                            "metadata": {"provider": "fake", "model": "ok"},
                            "report": {
                                "explanation": {"rationale_summary": "ok"},
                                "report": {"summary": "ok"},
                            },
                            "quality": {
                                "used_plain_json_fallback": False,
                                "normalization_note_count": 0,
                            },
                        },
                        {
                            "label": "metadata",
                            "command": "python3 fail.py",
                            "status": "failed",
                            "error": "runner crashed without structured stderr",
                            "failed_run_id": "run-failed",
                            "failure_kind": "server_error",
                            "failure_summary": "Runner hit a retry-exhausted upstream server error (HTTP 502).",
                            "failure_hint": "Retry compare later.",
                            "failure_source": "history_metadata",
                        },
                    ],
                    "comparisons": [
                        {
                            "left_label": "success",
                            "right_label": "other-success",
                            "status": "ok",
                            "comparison": {
                                "same_used_plain_json_fallback": True,
                                "same_normalization_notes": True,
                                "same_rationale_summary": True,
                                "same_patch_summary": True,
                                "same_patch_preview": True,
                                "same_response_notes": True,
                                "difference_kinds": [],
                            },
                            "difference_details": {},
                        }
                    ],
                    "blocked_comparisons": [
                        {
                            "left_label": "success",
                            "right_label": "metadata",
                            "status": "blocked",
                            "blocked_by": [
                                {
                                    "label": "metadata",
                                    "kind": "server_error",
                                    "summary": "Runner hit a retry-exhausted upstream server error (HTTP 502).",
                                    "failed_run_id": "run-failed",
                                    "failure_source": "history_metadata",
                                }
                            ],
                            "blocker_kinds": ["server_error"],
                        }
                    ],
                    "comparison_readiness": {
                        "status": "partial",
                        "comparable_pairs": 1,
                        "blocked_pairs": 1,
                    },
                    "failure_metrics": {"counts": {"server_error": 1}},
                    "comparison_metrics": {"compared_pairs": 1, "differing_pairs": 0},
                }
            )
        rendered = buffer.getvalue()
        self.assertIn("[blocked comparisons]", rendered)
        self.assertIn(
            "provenance: classified from history metadata; failed run run-failed",
            rendered,
        )

    def test_runner_compare_can_compare_two_fake_runners(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "import sys",
                        "from pathlib import Path",
                        "",
                        "label = sys.argv[1]",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': f'{label} summary',",
                        "    'explanation': {",
                        "        'rationale_summary': f'{label} rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [f'{label} suggestion'],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': label,",
                        "        'run_id': label,",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': f'{label} summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': f'{label} branch',",
                        "                'kind': 'topic',",
                        "                'body': f'{label} body',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [f'{label} note'],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            left_command = shlex.join([sys.executable, str(fake_runner), "left"])
            right_command = shlex.join([sys.executable, str(fake_runner), "right"])

            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--runner",
                f"left={left_command}",
                "--runner",
                f"right={right_command}",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["successful_runs"], 2)
        self.assertEqual(len(payload["comparisons"]), 1)
        self.assertEqual(payload["comparisons"][0]["status"], "ok")

    def test_runner_compare_source_context_targets_imported_node(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'source-context summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'source-context rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'source-context summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Source Context Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from fixture-backed context',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            command = shlex.join([sys.executable, str(fake_runner)])
            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--scenario",
                "source-context",
                "--fixture",
                str(FIXTURE_PATH),
                "--runner",
                f"left={command}",
                "--runner",
                f"right={command}",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["scenario"], "source-context")
        self.assertNotEqual(payload["node_id"], "root")
        self.assertEqual(
            payload["scenario_context"]["target_node"]["title"],
            "Provider Authentication Flow",
        )
        self.assertEqual(
            payload["scenario_context"]["evidence"]["chunk_label"],
            "Provider Authentication Flow",
        )

    def test_runner_compare_source_root_targets_imported_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'source-root summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'source-root rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'source-root summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Source Root Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from imported root context',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            command = shlex.join([sys.executable, str(fake_runner)])
            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--scenario",
                "source-root",
                "--fixture",
                str(FIXTURE_PATH),
                "--runner",
                f"left={command}",
                "--runner",
                f"right={command}",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["scenario"], "source-root")
        self.assertEqual(
            payload["node_id"],
            payload["scenario_context"]["imported_root_node"]["id"],
        )
        self.assertEqual(
            payload["scenario_context"]["target_node"]["title"],
            "OpenAI LangChain Regression",
        )

    def test_runner_compare_fixture_set_runs_multiple_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': request['target_node']['title'],",
                        "    'explanation': {",
                        "        'rationale_summary': request['target_node']['title'],",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': request['target_node']['id'],",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': request['target_node']['title'],",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Fixture Set Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from fixture-set context',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            command = shlex.join([sys.executable, str(fake_runner)])
            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--fixture-set",
                "openai-default",
                "--runner",
                f"left={command}",
                "--runner",
                f"right={command}",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["fixture_set"], "openai-default")
        self.assertEqual(len(payload["cases"]), 3)
        self.assertEqual(payload["aggregate"]["total_cases"], 3)
        self.assertEqual(payload["aggregate"]["compared_pairs"], 3)
        self.assertEqual(payload["aggregate"]["differing_pairs"], 0)
        self.assertEqual(payload["aggregate"]["compare_difference_kind_counts"], {})
        self.assertEqual(payload["aggregate"]["blocked_comparison_cases"], 0)
        self.assertEqual(payload["aggregate"]["blocked_comparison_pairs"], 0)
        self.assertEqual(payload["aggregate"]["blocked_comparison_kinds"], {})

    def test_runner_compare_fixture_set_aggregates_blocked_comparisons(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "import sys",
                        "from pathlib import Path",
                        "",
                        "mode = sys.argv[1]",
                        "if mode == 'missing-dependency':",
                        "    sys.stderr.write(\"[config] Missing `langchain-openai`. Install it with `python3 -m pip install -U langchain-openai` before using this pilot runner.\\n\")",
                        "    raise SystemExit(1)",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': request['target_node']['title'],",
                        "    'explanation': {",
                        "        'rationale_summary': request['target_node']['title'],",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': mode,",
                        "        'run_id': request['target_node']['id'],",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': request['target_node']['title'],",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Fixture Set Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from fixture-set context',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            success_command = shlex.join([sys.executable, str(fake_runner), "success"])
            missing_dep_command = shlex.join(
                [sys.executable, str(fake_runner), "missing-dependency"]
            )
            result = run_script(
                "scripts/runner_compare.py",
                "--json",
                "--fixture-set",
                "openai-default",
                "--runner",
                f"success={success_command}",
                "--runner",
                f"missing={missing_dep_command}",
            )

        self.assertEqual(result.returncode, 1, result.stderr)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["aggregate"]["total_cases"], 3)
        self.assertEqual(payload["aggregate"]["failed_cases"], 3)
        self.assertEqual(payload["aggregate"]["blocked_comparison_cases"], 3)
        self.assertEqual(payload["aggregate"]["blocked_comparison_pairs"], 3)
        self.assertEqual(
            payload["aggregate"]["blocked_comparison_kinds"],
            {"missing_dependency": 3},
        )
        for case in payload["cases"]:
            self.assertEqual(case["comparison_readiness"]["status"], "blocked")
            self.assertFalse(case["comparison_readiness"]["compare_ready"])
            self.assertEqual(case["comparison_readiness"]["blocked_pairs"], 1)
            self.assertEqual(
                case["comparison_readiness"]["blocker_counts"],
                {"missing_dependency": 1},
            )
            self.assertEqual(len(case["blocked_comparisons"]), 1)

    def test_runner_compare_offline_preset_all_makes_source_context_comparable(self) -> None:
        result = run_script(
            "scripts/runner_compare.py",
            "--json",
            "--preset",
            "langchain-pilot",
            "--preset-offline",
            "all",
            "--scenario",
            "source-context",
            "--fixture",
            str(FIXTURE_PATH),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["preset_offline_mode"], "all")
        self.assertEqual(payload["scenario"], "source-context")
        self.assertNotEqual(payload["node_id"], "root")
        self.assertEqual(payload["comparison_readiness"]["status"], "ready")
        self.assertTrue(payload["comparison_readiness"]["compare_ready"])
        self.assertTrue(payload["comparison_readiness"]["all_pairs_compared"])
        self.assertEqual(payload["comparison_readiness"]["comparable_pairs"], 3)
        self.assertEqual(payload["comparison_readiness"]["blocked_pairs"], 0)
        self.assertEqual(payload["blocked_comparisons"], [])
        self.assertEqual(len(payload["comparisons"]), 3)
        self.assertEqual(
            payload["comparison_metrics"],
            {
                "compared_pairs": 3,
                "differing_pairs": 3,
                "identical_pairs": 0,
                "difference_kind_counts": {
                    "used_plain_json_fallback": 2,
                    "rationale_summary": 3,
                    "patch_preview": 3,
                    "response_notes": 3,
                },
            },
        )

        runs = {item["label"]: item for item in payload["runs"]}
        self.assertEqual(set(runs.keys()), {"openai-minimal", "langchain-openai", "langchain-anthropic"})
        self.assertTrue(all(item["status"] == "ok" for item in runs.values()))
        self.assertTrue(all(item["offline_substitute"] is True for item in runs.values()))
        self.assertTrue(runs["openai-minimal"]["quality"]["used_plain_json_fallback"])
        self.assertFalse(runs["openai-minimal"]["quality"]["has_normalization_notes"])
        self.assertEqual(runs["openai-minimal"]["quality"]["patch_op_count"], 4)
        self.assertGreater(runs["langchain-openai"]["quality"]["direct_evidence_count"], 0)

        difference_kinds = {
            kind
            for comparison in payload["comparisons"]
            for kind in comparison["comparison"]["difference_kinds"]
        }
        self.assertIn("used_plain_json_fallback", difference_kinds)
        self.assertIn("rationale_summary", difference_kinds)
        self.assertIn("patch_preview", difference_kinds)
        self.assertIn("response_notes", difference_kinds)

        comparisons = {
            (item["left_label"], item["right_label"]): item
            for item in payload["comparisons"]
        }
        openai_pair = comparisons[("openai-minimal", "langchain-openai")]
        self.assertEqual(
            openai_pair["difference_details"]["used_plain_json_fallback"],
            {"left": True, "right": False},
        )
        self.assertNotIn("normalization_notes", openai_pair["difference_details"])
        self.assertNotIn("patch_summary", openai_pair["difference_details"])
        self.assertEqual(
            openai_pair["difference_details"]["patch_preview"]["left_count"],
            4,
        )
        self.assertEqual(
            openai_pair["difference_details"]["patch_preview"]["right_count"],
            4,
        )
        self.assertIn(
            "offline_compare_stub:openai-minimal",
            openai_pair["difference_details"]["response_notes"]["left_only"],
        )
        self.assertIn(
            "offline_compare_stub:langchain-openai",
            openai_pair["difference_details"]["response_notes"]["right_only"],
        )
        self.assertIn(
            "source-context request shape",
            openai_pair["difference_details"]["rationale_summary"]["left"],
        )
        patch_ops = openai_pair["structure_details"]["patch_ops"]
        self.assertEqual(patch_ops["left_count"], 4)
        self.assertEqual(patch_ops["right_count"], 4)
        self.assertEqual(patch_ops["left_kind_counts"], {"topic": 4})
        self.assertEqual(patch_ops["right_kind_counts"], {"action": 1, "topic": 3})
        self.assertFalse(patch_ops["shape_aligned"])
        self.assertEqual(patch_ops["title_overlap_ratio"], 1.0)
        self.assertEqual(patch_ops["body_overlap_ratio"], 1.0)
        self.assertEqual(
            patch_ops["field_mismatch_counts"],
            {"title": 0, "kind": 1, "body": 0, "left_extra": 0, "right_extra": 0},
        )
        self.assertEqual(patch_ops["position_details"]["aligned_positions"], 4)
        self.assertEqual(patch_ops["position_details"]["title_match_count"], 4)
        self.assertEqual(patch_ops["position_details"]["kind_match_count"], 3)
        self.assertEqual(patch_ops["position_details"]["body_match_count"], 4)
        self.assertEqual(len(patch_ops["position_details"]["differing_positions"]), 1)
        self.assertFalse(
            patch_ops["position_details"]["differing_positions"][0]["kind_match"]
        )
        self.assertTrue(
            patch_ops["position_details"]["differing_positions"][0]["title_match"]
        )
        self.assertTrue(
            patch_ops["position_details"]["differing_positions"][0]["body_match"]
        )
        explanation = openai_pair["structure_details"]["explanation"]
        self.assertEqual(explanation["left_direct_evidence_count"], 1)
        self.assertEqual(explanation["right_direct_evidence_count"], 1)
        self.assertEqual(explanation["shared_direct_evidence_count"], 1)
        self.assertEqual(explanation["left_only_direct_evidence_count"], 0)
        self.assertEqual(explanation["right_only_direct_evidence_count"], 0)
        self.assertEqual(explanation["direct_evidence_overlap_ratio"], 1.0)
        self.assertEqual(len(explanation["shared_direct_evidence_refs"]), 1)
        self.assertEqual(explanation["left_only_direct_evidence_refs"], [])
        self.assertEqual(explanation["right_only_direct_evidence_refs"], [])
        self.assertEqual(
            explanation["shared_inferred_suggestions"],
            [
                "Add a node for fallback behavior when any of the three variables are missing.",
                "Document how to rotate or refresh OPENAI_API_KEY in local environments.",
                "Capture any environment-specific overrides (dev vs staging vs production) for the base URL or model.",
            ],
        )
        self.assertEqual(explanation["left_inferred_suggestions_count"], 3)
        self.assertEqual(explanation["right_inferred_suggestions_count"], 3)
        self.assertEqual(explanation["shared_inferred_suggestions_count"], 3)
        self.assertEqual(explanation["left_only_inferred_suggestions_count"], 0)
        self.assertEqual(explanation["right_only_inferred_suggestions_count"], 0)
        self.assertEqual(explanation["inferred_overlap_ratio"], 1.0)
        self.assertEqual(
            explanation["left_only_inferred_suggestions"], []
        )
        self.assertEqual(explanation["right_only_inferred_suggestions"], [])
        self.assertEqual(
            openai_pair["structure_details"]["response_notes"],
            {
                "left_count": 3,
                "right_count": 3,
                "same_count": True,
                "left_category_counts": {
                    "offline_compare_marker": 2,
                    "branch_count": 1,
                },
                "right_category_counts": {
                    "offline_compare_marker": 2,
                    "branch_count": 1,
                },
                "same_category_counts": True,
            },
        )
        self.assertEqual(
            openai_pair["structure_details"]["normalization_notes"],
            {
                "left_count": 0,
                "right_count": 0,
                "same_count": True,
                "left_category_counts": {},
                "right_category_counts": {},
                "same_category_counts": True,
            },
        )

    def test_runner_compare_offline_preset_all_makes_source_root_comparable(self) -> None:
        result = run_script(
            "scripts/runner_compare.py",
            "--json",
            "--preset",
            "langchain-pilot",
            "--preset-offline",
            "all",
            "--scenario",
            "source-root",
            "--fixture",
            str(FIXTURE_PATH),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["preset_offline_mode"], "all")
        self.assertEqual(payload["scenario"], "source-root")
        self.assertEqual(
            payload["node_id"],
            payload["scenario_context"]["imported_root_node"]["id"],
        )
        self.assertEqual(payload["comparison_readiness"]["status"], "ready")
        self.assertEqual(payload["comparison_readiness"]["comparable_pairs"], 3)
        self.assertEqual(payload["comparison_readiness"]["blocked_pairs"], 0)
        self.assertEqual(payload["blocked_comparisons"], [])
        self.assertEqual(
            payload["comparison_metrics"],
            {
                "compared_pairs": 3,
                "differing_pairs": 3,
                "identical_pairs": 0,
                "difference_kind_counts": {
                    "used_plain_json_fallback": 2,
                    "rationale_summary": 3,
                    "patch_preview": 3,
                    "response_notes": 3,
                },
            },
        )

        runs = {item["label"]: item for item in payload["runs"]}
        self.assertTrue(all(item["offline_substitute"] is True for item in runs.values()))
        self.assertEqual(payload["scenario_context"]["evidence"]["citation_kind"], "direct")
        self.assertTrue(all(item["quality"]["has_direct_evidence"] for item in runs.values()))
        self.assertFalse(any(item["quality"]["has_normalization_notes"] for item in runs.values()))
        self.assertEqual(
            runs["openai-minimal"]["metadata"]["provider_run_id"],
            "offline-openai-minimal-source-root",
        )
        self.assertIn(
            "offline_compare_scenario:source-root",
            runs["openai-minimal"]["show"]["response_notes"],
        )
        self.assertEqual(
            runs["openai-minimal"]["show"]["patch"]["ops"][0]["title"],
            "Draft Path Trigger Conditions",
        )

        comparisons = {
            (item["left_label"], item["right_label"]): item
            for item in payload["comparisons"]
        }
        openai_pair = comparisons[("openai-minimal", "langchain-openai")]
        self.assertIn(
            "source-root request shape",
            openai_pair["difference_details"]["rationale_summary"]["left"],
        )
        self.assertNotIn("patch_summary", openai_pair["difference_details"])
        self.assertEqual(
            openai_pair["difference_details"]["patch_preview"]["left_count"],
            4,
        )
        self.assertEqual(
            openai_pair["difference_details"]["patch_preview"]["right_count"],
            4,
        )
        patch_ops = openai_pair["structure_details"]["patch_ops"]
        self.assertEqual(patch_ops["left_count"], 4)
        self.assertEqual(patch_ops["right_count"], 4)
        self.assertEqual(patch_ops["left_kind_counts"], {"topic": 4})
        self.assertEqual(patch_ops["right_kind_counts"], {"action": 1, "topic": 3})
        self.assertFalse(patch_ops["shape_aligned"])
        self.assertEqual(patch_ops["title_overlap_ratio"], 1.0)
        self.assertEqual(patch_ops["body_overlap_ratio"], 1.0)
        self.assertEqual(
            patch_ops["field_mismatch_counts"],
            {"title": 0, "kind": 1, "body": 0, "left_extra": 0, "right_extra": 0},
        )
        self.assertEqual(patch_ops["position_details"]["aligned_positions"], 4)
        self.assertEqual(patch_ops["position_details"]["title_match_count"], 4)
        self.assertEqual(patch_ops["position_details"]["kind_match_count"], 3)
        self.assertEqual(patch_ops["position_details"]["body_match_count"], 4)
        self.assertEqual(len(patch_ops["position_details"]["differing_positions"]), 1)
        self.assertFalse(
            patch_ops["position_details"]["differing_positions"][0]["kind_match"]
        )
        self.assertTrue(
            patch_ops["position_details"]["differing_positions"][0]["title_match"]
        )
        self.assertTrue(
            patch_ops["position_details"]["differing_positions"][0]["body_match"]
        )
        explanation = openai_pair["structure_details"]["explanation"]
        self.assertEqual(explanation["left_direct_evidence_count"], 1)
        self.assertEqual(explanation["right_direct_evidence_count"], 1)
        self.assertEqual(explanation["shared_direct_evidence_count"], 1)
        self.assertEqual(explanation["left_only_direct_evidence_count"], 0)
        self.assertEqual(explanation["right_only_direct_evidence_count"], 0)
        self.assertEqual(explanation["direct_evidence_overlap_ratio"], 1.0)
        self.assertEqual(len(explanation["shared_direct_evidence_refs"]), 1)
        self.assertEqual(
            explanation["shared_inferred_suggestions"],
            [
                "Expand Draft Path Trigger Conditions with specific input payloads or environment flags that activate the path.",
                "Populate Regression Scope And Assertions with concrete pass/fail criteria once test specs are available.",
                "Add LangChain chain topology details under OpenAI Model Configuration if chain structure is relevant.",
            ],
        )
        self.assertEqual(explanation["shared_inferred_suggestions_count"], 3)
        self.assertEqual(explanation["left_only_inferred_suggestions_count"], 0)
        self.assertEqual(explanation["right_only_inferred_suggestions_count"], 0)
        self.assertEqual(explanation["inferred_overlap_ratio"], 1.0)
        self.assertEqual(
            explanation["left_only_inferred_suggestions"],
            [],
        )
        self.assertEqual(
            explanation["right_only_inferred_suggestions"],
            [],
        )
        self.assertEqual(
            openai_pair["structure_details"]["response_notes"],
            {
                "left_count": 3,
                "right_count": 3,
                "same_count": True,
                "left_category_counts": {
                    "offline_compare_marker": 2,
                    "branch_count": 1,
                },
                "right_category_counts": {
                    "offline_compare_marker": 2,
                    "branch_count": 1,
                },
                "same_category_counts": True,
            },
        )
        self.assertEqual(
            openai_pair["structure_details"]["normalization_notes"],
            {
                "left_count": 0,
                "right_count": 0,
                "same_count": True,
                "left_category_counts": {},
                "right_category_counts": {},
                "same_category_counts": True,
            },
        )

    def test_runner_compare_offline_preset_all_minimal_keeps_openai_normalization_noise(self) -> None:
        result = run_script(
            "scripts/runner_compare.py",
            "--json",
            "--preset",
            "langchain-pilot",
            "--preset-offline",
            "all",
            "--scenario",
            "minimal",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        runs = {item["label"]: item for item in payload["runs"]}
        self.assertTrue(runs["openai-minimal"]["quality"]["has_normalization_notes"])
        self.assertEqual(runs["openai-minimal"]["quality"]["patch_op_count"], 3)
        self.assertIn(
            "normalization_notes",
            payload["comparison_metrics"]["difference_kind_counts"],
        )
        self.assertIn(
            "patch_summary",
            payload["comparison_metrics"]["difference_kind_counts"],
        )

    def test_build_runner_specs_openai_offline_only_substitutes_openai_lanes(self) -> None:
        specs = runner_compare.build_runner_specs(
            preset_names=["langchain-pilot"],
            explicit_specs=[],
            preset_offline_mode="openai",
        )

        by_label = {item["label"]: item for item in specs}
        self.assertTrue(by_label["openai-minimal"]["offline_substitute"])
        self.assertTrue(by_label["langchain-openai"]["offline_substitute"])
        self.assertFalse(by_label["langchain-anthropic"]["offline_substitute"])
        self.assertIn(
            "compare_offline_runner.py",
            by_label["openai-minimal"]["command"],
        )
        self.assertIn(
            "compare_offline_runner.py",
            by_label["langchain-openai"]["command"],
        )
        self.assertIn(
            "langchain_anthropic_runner.py",
            by_label["langchain-anthropic"]["command"],
        )

    def test_runner_compare_mixed_openai_offline_source_context_is_compare_ready(self) -> None:
        payload = run_mixed_offline_compare(scenario="source-context")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["comparison_readiness"]["status"], "ready")
        self.assertEqual(
            payload["comparison_metrics"],
            {
                "compared_pairs": 3,
                "differing_pairs": 3,
                "identical_pairs": 0,
                "difference_kind_counts": {
                    "used_plain_json_fallback": 2,
                    "rationale_summary": 3,
                    "patch_preview": 3,
                    "response_notes": 3,
                },
            },
        )

        runs = {item["label"]: item for item in payload["runs"]}
        self.assertTrue(runs["openai-minimal"]["offline_substitute"])
        self.assertTrue(runs["langchain-openai"]["offline_substitute"])
        self.assertFalse(runs["langchain-anthropic"]["offline_substitute"])

        comparisons = {
            (item["left_label"], item["right_label"]): item
            for item in payload["comparisons"]
        }
        openai_pair = comparisons[("openai-minimal", "langchain-openai")]
        self.assertEqual(
            openai_pair["comparison"]["difference_kinds"],
            [
                "used_plain_json_fallback",
                "rationale_summary",
                "patch_preview",
                "response_notes",
            ],
        )
        patch_ops = openai_pair["structure_details"]["patch_ops"]
        self.assertEqual(patch_ops["left_count"], 4)
        self.assertEqual(patch_ops["right_count"], 4)
        self.assertEqual(patch_ops["left_kind_counts"], {"topic": 4})
        self.assertEqual(patch_ops["right_kind_counts"], {"action": 1, "topic": 3})
        self.assertFalse(patch_ops["shape_aligned"])
        self.assertEqual(patch_ops["title_overlap_ratio"], 1.0)
        self.assertEqual(patch_ops["body_overlap_ratio"], 1.0)
        self.assertEqual(
            patch_ops["field_mismatch_counts"],
            {"title": 0, "kind": 1, "body": 0, "left_extra": 0, "right_extra": 0},
        )
        self.assertEqual(patch_ops["position_details"]["aligned_positions"], 4)
        self.assertEqual(patch_ops["position_details"]["title_match_count"], 4)
        self.assertEqual(patch_ops["position_details"]["kind_match_count"], 3)
        self.assertEqual(patch_ops["position_details"]["body_match_count"], 4)
        self.assertEqual(len(patch_ops["position_details"]["differing_positions"]), 1)
        self.assertEqual(
            openai_pair["structure_details"]["normalization_notes"],
            {
                "left_count": 0,
                "right_count": 0,
                "same_count": True,
                "left_category_counts": {},
                "right_category_counts": {},
                "same_category_counts": True,
            },
        )

    def test_runner_compare_mixed_openai_offline_source_root_is_compare_ready(self) -> None:
        payload = run_mixed_offline_compare(scenario="source-root")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["comparison_readiness"]["status"], "ready")
        self.assertEqual(payload["scenario_context"]["evidence"]["citation_kind"], "direct")
        self.assertEqual(
            payload["comparison_metrics"],
            {
                "compared_pairs": 3,
                "differing_pairs": 3,
                "identical_pairs": 0,
                "difference_kind_counts": {
                    "used_plain_json_fallback": 2,
                    "rationale_summary": 3,
                    "patch_preview": 3,
                    "response_notes": 3,
                },
            },
        )

        comparisons = {
            (item["left_label"], item["right_label"]): item
            for item in payload["comparisons"]
        }
        runs = {item["label"]: item for item in payload["runs"]}
        self.assertTrue(all(item["quality"]["has_direct_evidence"] for item in runs.values()))
        openai_pair = comparisons[("openai-minimal", "langchain-openai")]
        self.assertEqual(
            openai_pair["comparison"]["difference_kinds"],
            [
                "used_plain_json_fallback",
                "rationale_summary",
                "patch_preview",
                "response_notes",
            ],
        )
        patch_ops = openai_pair["structure_details"]["patch_ops"]
        self.assertEqual(patch_ops["left_count"], 4)
        self.assertEqual(patch_ops["right_count"], 4)
        self.assertEqual(patch_ops["left_kind_counts"], {"topic": 4})
        self.assertEqual(patch_ops["right_kind_counts"], {"action": 1, "topic": 3})
        self.assertFalse(patch_ops["shape_aligned"])
        self.assertEqual(patch_ops["title_overlap_ratio"], 1.0)
        self.assertEqual(patch_ops["body_overlap_ratio"], 1.0)
        self.assertEqual(
            patch_ops["field_mismatch_counts"],
            {"title": 0, "kind": 1, "body": 0, "left_extra": 0, "right_extra": 0},
        )
        self.assertEqual(patch_ops["position_details"]["aligned_positions"], 4)
        self.assertEqual(patch_ops["position_details"]["title_match_count"], 4)
        self.assertEqual(patch_ops["position_details"]["kind_match_count"], 3)
        self.assertEqual(patch_ops["position_details"]["body_match_count"], 4)
        self.assertEqual(len(patch_ops["position_details"]["differing_positions"]), 1)
        self.assertIn(
            "source-root request shape",
            openai_pair["difference_details"]["rationale_summary"]["left"],
        )
        explanation = openai_pair["structure_details"]["explanation"]
        self.assertEqual(explanation["left_direct_evidence_count"], 1)
        self.assertEqual(explanation["right_direct_evidence_count"], 1)
        self.assertEqual(explanation["shared_direct_evidence_count"], 1)
        self.assertEqual(explanation["direct_evidence_overlap_ratio"], 1.0)
        self.assertEqual(len(explanation["shared_direct_evidence_refs"]), 1)
        self.assertEqual(
            explanation["shared_inferred_suggestions"],
            [
                "Expand Draft Path Trigger Conditions with specific input payloads or environment flags that activate the path.",
                "Populate Regression Scope And Assertions with concrete pass/fail criteria once test specs are available.",
                "Add LangChain chain topology details under OpenAI Model Configuration if chain structure is relevant.",
            ],
        )
        self.assertEqual(explanation["shared_inferred_suggestions_count"], 3)
        self.assertEqual(explanation["left_only_inferred_suggestions"], [])
        self.assertEqual(explanation["right_only_inferred_suggestions"], [])
        self.assertEqual(
            openai_pair["structure_details"]["normalization_notes"],
            {
                "left_count": 0,
                "right_count": 0,
                "same_count": True,
                "left_category_counts": {},
                "right_category_counts": {},
                "same_category_counts": True,
            },
        )

    def test_langchain_anthropic_runner_help(self) -> None:
        result = run_script("scripts/langchain_anthropic_runner.py", "--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "Experimental LangChain + Anthropic-compatible runner", result.stdout
        )

    def test_langchain_openai_runner_help(self) -> None:
        result = run_script("scripts/langchain_openai_runner.py", "--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Experimental LangChain + OpenAI runner", result.stdout)

    def test_provider_runner_list(self) -> None:
        result = run_script("scripts/provider_runner.py", "--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("codex: runnable", result.stdout)
        self.assertIn("anthropic: runnable", result.stdout)
        self.assertIn("openai: runnable", result.stdout)
        self.assertIn("gemini: runnable", result.stdout)

    def test_provider_smoke_list(self) -> None:
        result = run_script("scripts/provider_smoke.py", "--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("codex: runner=codex_runner.py", result.stdout)
        self.assertIn(
            "anthropic: runner=langchain_anthropic_runner.py", result.stdout
        )
        self.assertIn("openai: runner=langchain_openai_runner.py", result.stdout)
        self.assertIn("gemini: runner=gemini_runner.py", result.stdout)

    def test_provider_smoke_can_prepare_source_context_scenario(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'provider smoke source-context summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'provider smoke source-context rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'provider smoke source-context summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Smoke Scenario Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated in smoke scenario',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_dir=Path(tmp_dir),
                node_id="root",
                scenario="source-context",
                fixture_path=FIXTURE_PATH,
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=False,
                json_mode=True,
            )

        self.assertEqual(result["scenario"], "source-context")
        self.assertNotEqual(result["node_id"], "root")
        self.assertEqual(
            result["scenario_context"]["target_node"]["title"],
            "Provider Authentication Flow",
        )

    def test_provider_smoke_can_prepare_source_root_scenario(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'provider smoke source-root summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'provider smoke source-root rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'provider smoke source-root summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Smoke Root Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from imported root',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_dir=Path(tmp_dir),
                node_id="root",
                scenario="source-root",
                fixture_path=FIXTURE_PATH,
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=False,
                json_mode=True,
            )

        self.assertEqual(result["scenario"], "source-root")
        self.assertEqual(
            result["node_id"],
            result["scenario_context"]["imported_root_node"]["id"],
        )
        self.assertEqual(
            result["scenario_context"]["imported_root_node"]["title"],
            "OpenAI LangChain Regression",
        )
        self.assertEqual(
            result["scenario_context"]["target_node"]["id"],
            result["scenario_context"]["imported_root_node"]["id"],
        )
        evidence = result["scenario_context"]["evidence"]
        self.assertEqual(evidence["citation_kind"], "direct")
        self.assertEqual(
            evidence["rationale"],
            "This imported section establishes the root source topic that the draft expands.",
        )
        node_show = result["scenario_context"]["steps"]["node_show"]
        self.assertTrue(
            any(
                citation.get("chunk", {}).get("id") == evidence["chunk_id"]
                and citation.get("citation_kind") == evidence["citation_kind"]
                and citation.get("rationale") == evidence["rationale"]
                for detail in node_show.get("evidence") or []
                for citation in detail.get("citations") or []
            )
        )

    def test_provider_smoke_source_root_fallback_synthesizes_direct_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "import sys",
                        f"sys.path.insert(0, {str(REPO_ROOT / 'scripts')!r})",
                        "from langchain_runner_common import normalize_contract_response",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = normalize_contract_response(",
                        "    contract_response={",
                        "        'explanation': {",
                        "            'rationale_summary': 'provider smoke source-root fallback rationale',",
                        "            'direct_evidence': [],",
                        "            'inferred_suggestions': [],",
                        "        },",
                        "        'patch': {'ops': []},",
                        "        'notes': [],",
                        "    },",
                        "    request_payload=request,",
                        "    provider='langchain_openai',",
                        "    model='fake',",
                        ")",
                        "meta_path = os.environ.get('NODEX_AI_META')",
                        "if meta_path:",
                        "    Path(meta_path).write_text(json.dumps({",
                        "        'provider': 'langchain_openai',",
                        "        'model': 'fake',",
                        "        'provider_run_id': None,",
                        "        'retry_count': 0,",
                        "        'used_plain_json_fallback': False,",
                        "        'normalization_notes': [",
                        "            note for note in response.get('notes', [])",
                        "            if isinstance(note, str) and note.startswith('runner_normalized:')",
                        "        ],",
                        "        'last_error_category': None,",
                        "        'last_error_message': None,",
                        "        'last_status_code': None,",
                        "    }, indent=2))",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_dir=Path(tmp_dir),
                node_id="root",
                scenario="source-root",
                fixture_path=FIXTURE_PATH,
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=False,
                json_mode=True,
            )

        self.assertTrue(result["quality"]["has_direct_evidence"])
        self.assertGreater(result["quality"]["direct_evidence_count"], 0)
        self.assertIn(
            "runner_normalized:fallback_scaffold_ops",
            result["quality"]["normalization_notes"],
        )
        self.assertIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            result["quality"]["normalization_notes"],
        )
        self.assertTrue(result["verification"]["scenario"]["target_evidence_retained"])
        self.assertTrue(result["verification"]["scenario"]["source_evidence_link_retained"])

    def test_provider_smoke_fixture_set_runs_multiple_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': request['target_node']['title'],",
                        "    'explanation': {",
                        "        'rationale_summary': request['target_node']['title'],",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': request['target_node']['id'],",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': request['target_node']['title'],",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Fixture Set Smoke Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from fixture-set smoke',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_fixture_set_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_root_dir=Path(tmp_dir),
                fixture_set_name="openai-default",
                fixture_cases=fixture_set_cases("openai-default"),
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=False,
                json_mode=True,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["fixture_set"], "openai-default")
        self.assertEqual(result["metrics"]["total_cases"], 3)
        self.assertEqual(result["metrics"]["verification_ok_cases"], 3)

    def test_provider_smoke_apply_verifies_source_context_post_apply_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "cited = request.get('cited_evidence') or []",
                        "direct_evidence = []",
                        "if cited and cited[0].get('chunks'):",
                        "    chunk = cited[0]['chunks'][0]",
                        "    direct_evidence.append({",
                        "        'source_id': cited[0]['source_id'],",
                        "        'source_name': cited[0]['original_name'],",
                        "        'chunk_id': chunk['chunk_id'],",
                        "        'label': chunk.get('label'),",
                        "        'start_line': chunk['start_line'],",
                        "        'end_line': chunk['end_line'],",
                        "        'why_it_matters': 'Fixture-backed support for apply verification',",
                        "    })",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'provider smoke apply summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'provider smoke apply rationale',",
                        "        'direct_evidence': direct_evidence,",
                        "        'inferred_suggestions': ['follow-up'],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'provider smoke apply summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Applied Smoke Branch',",
                        "                'kind': 'evidence',",
                        "                'body': 'Generated from imported evidence',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': ['note-1'],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_dir=Path(tmp_dir),
                node_id="root",
                scenario="source-context",
                fixture_path=FIXTURE_PATH,
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=True,
                json_mode=True,
            )

        self.assertEqual(result["status"], "applied")
        self.assertTrue(result["quality"]["status_ok"])
        self.assertTrue(result["quality"]["patch_run_link_ok"])
        self.assertEqual(result["quality"]["created_node_count"], 1)
        self.assertTrue(result["verification"]["ok"])
        self.assertTrue(result["verification"]["ai_run"]["ok"])
        self.assertEqual(result["verification"]["ai_run"]["response_notes_count"], 1)
        self.assertTrue(result["verification"]["scenario"]["ok"])
        self.assertTrue(result["verification"]["scenario"]["target_evidence_retained"])
        self.assertTrue(
            result["verification"]["scenario"]["source_evidence_link_retained"]
        )
        self.assertTrue(result["verification"]["scenario"]["created_nodes_present"])
        self.assertTrue(
            result["verification"]["scenario"]["created_nodes_match_patch"]
        )

    def test_provider_smoke_apply_verifies_source_root_post_apply_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'provider smoke source-root apply summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'provider smoke source-root apply rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': ['expand the imported root'],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'fake-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'provider smoke source-root apply summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Applied Root Branch',",
                        "                'kind': 'action',",
                        "                'body': 'Generated from imported root apply smoke',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': ['note-1'],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_dir=Path(tmp_dir),
                node_id="root",
                scenario="source-root",
                fixture_path=FIXTURE_PATH,
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=True,
                json_mode=True,
            )

        self.assertEqual(result["status"], "applied")
        self.assertTrue(result["quality"]["status_ok"])
        self.assertTrue(result["verification"]["ok"])
        self.assertTrue(result["verification"]["ai_run"]["ok"])
        self.assertTrue(result["verification"]["scenario"]["ok"])
        self.assertTrue(
            result["verification"]["scenario"]["imported_root_under_workspace_root"]
        )
        self.assertTrue(
            result["verification"]["scenario"]["imported_root_source_link_retained"]
        )
        self.assertTrue(result["verification"]["scenario"]["created_nodes_present"])
        self.assertTrue(
            result["verification"]["scenario"]["created_nodes_match_patch"]
        )

    def test_provider_smoke_fixture_set_apply_counts_verified_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': request['target_node']['title'],",
                        "    'explanation': {",
                        "        'rationale_summary': request['target_node']['title'],",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': [],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': request['target_node']['id'],",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': request['target_node']['title'],",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Fixture Set Applied Branch',",
                        "                'kind': 'topic',",
                        "                'body': 'Generated from fixture-set apply smoke',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            result = run_fixture_set_smoke(
                manifest_path=REPO_ROOT / "Cargo.toml",
                workspace_root_dir=Path(tmp_dir),
                fixture_set_name="openai-default",
                fixture_cases=fixture_set_cases("openai-default"),
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=True,
                json_mode=True,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["metrics"]["successful_cases"], 3)
        self.assertEqual(result["metrics"]["verification_ok_cases"], 3)
        self.assertEqual(result["metrics"]["verification_failed_cases"], 0)

    def test_desktop_flow_smoke_dry_run_reports_next_focus_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'desktop flow dry-run summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'desktop flow dry-run rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': ['keep the focus on the first branch'],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'desktop-dry-run',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'desktop flow dry-run summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Desktop Flow Draft Branch',",
                        "                'kind': 'action',",
                        "                'body': 'A branch that should appear as the next focus candidate in dry-run mode.',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': [],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            command = shlex.join([sys.executable, str(fake_runner)])
            result = run_script(
                "scripts/desktop_flow_smoke.py",
                "--runner-command",
                command,
                "--fixture",
                str(FIXTURE_PATH),
                "--json",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["mode"], "dry_run")
        checks = payload["desktop_flow"]["checks"]
        self.assertTrue(checks["imported_root_node_available"])
        self.assertTrue(checks["source_context_target_selected"])
        self.assertTrue(checks["target_node_under_imported_root"])
        self.assertTrue(checks["draft_generated"])
        self.assertTrue(checks["review_payload_available"])
        self.assertTrue(checks["dry_run_verified"])
        self.assertTrue(checks["next_focus_candidate_ready"])
        imported_root = payload["desktop_flow"]["imported_root_node"]
        self.assertTrue(imported_root["id"])
        self.assertEqual(
            imported_root["title"],
            "OpenAI LangChain Regression",
        )
        self.assertEqual(payload["desktop_flow"]["predicted_node_count"], 1)
        self.assertEqual(payload["desktop_flow"]["created_node_count"], 0)
        self.assertEqual(
            payload["desktop_flow"]["next_focus_candidate"]["title"],
            "Desktop Flow Draft Branch",
        )
        ai_status = payload["ai_status"]
        self.assertEqual(ai_status["command"], command)
        self.assertEqual(ai_status["command_source"], "override")
        self.assertIsNone(ai_status["provider"])
        self.assertEqual(ai_status["runner"], "custom")
        self.assertEqual(ai_status["model"], "fake")
        self.assertIsNone(ai_status["reasoning_effort"])
        self.assertIsNone(ai_status["has_auth"])
        self.assertIsNone(ai_status["has_process_env_conflict"])
        self.assertIsNone(ai_status["has_shell_env_conflict"])
        self.assertFalse(ai_status["uses_provider_defaults"])
        self.assertIn("does not map to a known provider runner", ai_status["status_error"])

    def test_desktop_flow_smoke_reports_fallback_direct_evidence_quality(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "import sys",
                        f"sys.path.insert(0, {str(REPO_ROOT / 'scripts')!r})",
                        "from langchain_runner_common import normalize_contract_response",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = normalize_contract_response(",
                        "    contract_response={",
                        "        'explanation': {",
                        "            'rationale_summary': 'desktop flow fallback rationale',",
                        "            'direct_evidence': [],",
                        "            'inferred_suggestions': ['keep the focus on the first branch'],",
                        "        },",
                        "        'patch': {'ops': []},",
                        "        'notes': [],",
                        "    },",
                        "    request_payload=request,",
                        "    provider='langchain_openai',",
                        "    model='fake',",
                        ")",
                        "meta_path = os.environ.get('NODEX_AI_META')",
                        "if meta_path:",
                        "    Path(meta_path).write_text(json.dumps({",
                        "        'provider': 'langchain_openai',",
                        "        'model': 'fake',",
                        "        'provider_run_id': None,",
                        "        'retry_count': 0,",
                        "        'used_plain_json_fallback': False,",
                        "        'normalization_notes': [",
                        "            note for note in response.get('notes', [])",
                        "            if isinstance(note, str) and note.startswith('runner_normalized:')",
                        "        ],",
                        "        'last_error_category': None,",
                        "        'last_error_message': None,",
                        "        'last_status_code': None,",
                        "    }, indent=2))",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            command = shlex.join([sys.executable, str(fake_runner)])
            result = run_script(
                "scripts/desktop_flow_smoke.py",
                "--runner-command",
                command,
                "--fixture",
                str(FIXTURE_PATH),
                "--json",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["smoke"]["quality"]["has_direct_evidence"])
        self.assertGreater(payload["smoke"]["quality"]["direct_evidence_count"], 0)
        self.assertIn(
            "runner_normalized:fallback_scaffold_ops",
            payload["smoke"]["quality"]["normalization_notes"],
        )
        self.assertIn(
            "runner_normalized:synthesized_direct_evidence_from_cited_evidence",
            payload["smoke"]["quality"]["normalization_notes"],
        )

    def test_desktop_flow_smoke_apply_reports_created_node_focus(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_runner = Path(tmp_dir) / "fake_runner.py"
            fake_runner.write_text(
                "\n".join(
                    [
                        "#!/usr/bin/env python3",
                        "import json",
                        "import os",
                        "from pathlib import Path",
                        "",
                        "request = json.loads(Path(os.environ['NODEX_AI_REQUEST']).read_text())",
                        "response = {",
                        "    'version': request['contract']['version'],",
                        "    'kind': request['contract']['response_kind'],",
                        "    'capability': request['capability'],",
                        "    'request_node_id': request['target_node']['id'],",
                        "    'status': 'ok',",
                        "    'summary': 'desktop flow apply summary',",
                        "    'explanation': {",
                        "        'rationale_summary': 'desktop flow apply rationale',",
                        "        'direct_evidence': [],",
                        "        'inferred_suggestions': ['focus the new branch'],",
                        "    },",
                        "    'generator': {",
                        "        'provider': 'fake_runner',",
                        "        'model': 'fake',",
                        "        'run_id': 'desktop-apply',",
                        "    },",
                        "    'patch': {",
                        "        'version': request['contract']['patch_version'],",
                        "        'summary': 'desktop flow apply summary',",
                        "        'ops': [",
                        "            {",
                        "                'type': 'add_node',",
                        "                'parent_id': request['target_node']['id'],",
                        "                'title': 'Desktop Flow Applied Branch',",
                        "                'kind': 'evidence',",
                        "                'body': 'A branch that should be created and focused after apply.',",
                        "            }",
                        "        ],",
                        "    },",
                        "    'notes': ['applied'],",
                        "}",
                        "Path(os.environ['NODEX_AI_RESPONSE']).write_text(json.dumps(response, indent=2))",
                    ]
                )
            )
            command = shlex.join([sys.executable, str(fake_runner)])
            result = run_script(
                "scripts/desktop_flow_smoke.py",
                "--runner-command",
                command,
                "--fixture",
                str(FIXTURE_PATH),
                "--apply",
                "--json",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["mode"], "apply")
        checks = payload["desktop_flow"]["checks"]
        self.assertTrue(checks["imported_root_node_available"])
        self.assertTrue(checks["target_node_under_imported_root"])
        self.assertTrue(checks["patch_applied"])
        self.assertTrue(checks["created_node_verified"])
        self.assertTrue(checks["next_focus_candidate_ready"])
        imported_root = payload["desktop_flow"]["imported_root_node"]
        self.assertTrue(imported_root["id"])
        self.assertEqual(
            imported_root["title"],
            "OpenAI LangChain Regression",
        )
        self.assertEqual(payload["desktop_flow"]["predicted_node_count"], 1)
        self.assertEqual(payload["desktop_flow"]["created_node_count"], 1)
        candidate = payload["desktop_flow"]["next_focus_candidate"]
        self.assertTrue(candidate["id"])
        self.assertEqual(candidate["title"], "Desktop Flow Applied Branch")
        ai_status = payload["ai_status"]
        self.assertEqual(ai_status["command"], command)
        self.assertEqual(ai_status["command_source"], "override")
        self.assertIsNone(ai_status["provider"])
        self.assertEqual(ai_status["runner"], "custom")
        self.assertEqual(ai_status["model"], "fake")
        self.assertIsNone(ai_status["reasoning_effort"])
        self.assertIsNone(ai_status["has_auth"])
        self.assertIsNone(ai_status["has_process_env_conflict"])
        self.assertIsNone(ai_status["has_shell_env_conflict"])
        self.assertFalse(ai_status["uses_provider_defaults"])
        self.assertIn("does not map to a known provider runner", ai_status["status_error"])

    def test_run_desktop_flow_smoke_apply_hard_gates_default_ai_status(self) -> None:
        smoke_result = {
            "status": "applied",
            "steps": {"init": {"command": ["cargo", "run", "--", "init"]}},
            "scenario_context": {
                "imported_root_node": {
                    "id": "imported-root",
                    "title": "Imported Root",
                },
                "target_node": {
                    "id": "target-node",
                    "title": "Provider Authentication Flow",
                },
                "evidence": {
                    "chunk_id": "chunk-1",
                    "chunk_label": "Provider Authentication Flow",
                },
            },
            "run_external_json": {
                "metadata": {
                    "model": "gpt-5.4-mini",
                },
                "patch": {
                    "ops": [
                        {
                            "type": "add_node",
                            "parent_id": "target-node",
                            "title": "Applied Branch",
                            "kind": "topic",
                        }
                    ]
                },
                "report": {
                    "preview": ["add node Applied Branch"],
                    "created_nodes": [
                        {
                            "id": "generated-node",
                            "title": "Applied Branch",
                        }
                    ],
                },
            },
            "quality": {
                "status_ok": True,
                "rationale_present": True,
            },
            "verification": {
                "ai_run": {"ok": True},
                "scenario": {
                    "target_node_under_imported_root": True,
                    "target_evidence_retained": True,
                    "source_evidence_link_retained": True,
                    "created_nodes_present": True,
                    "created_nodes_match_patch": True,
                },
            },
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace_dir = Path(tmp_dir)
            with patch("desktop_flow_smoke.run_smoke", return_value=smoke_result):
                aligned = run_desktop_flow_smoke(
                    manifest_path=REPO_ROOT / "Cargo.toml",
                    workspace_dir=workspace_dir,
                    runner_command_text=(
                        "python3 '/tmp/provider_runner.py' "
                        "--provider openai --use-default-args"
                    ),
                    apply=True,
                    fixture_path=None,
                    target_label="Provider Authentication Flow",
                    citation_rationale="default route rationale",
                    preflight_summary={
                        "has_auth": True,
                        "has_process_env_conflict": False,
                        "has_shell_env_conflict": False,
                    },
                    provider="openai",
                    command_source="default",
                )

                drifted = run_desktop_flow_smoke(
                    manifest_path=REPO_ROOT / "Cargo.toml",
                    workspace_dir=workspace_dir,
                    runner_command_text="python3 '/tmp/langchain_openai_runner.py'",
                    apply=True,
                    fixture_path=None,
                    target_label="Provider Authentication Flow",
                    citation_rationale="default route rationale",
                    preflight_summary={
                        "has_auth": True,
                        "has_process_env_conflict": False,
                        "has_shell_env_conflict": False,
                    },
                    provider="openai",
                    command_source="default",
                )

        self.assertTrue(aligned["ok"])
        self.assertTrue(
            aligned["desktop_flow"]["checks"]["default_ai_status_provider"]
        )
        self.assertTrue(aligned["desktop_flow"]["checks"]["default_ai_status_runner"])
        self.assertTrue(
            aligned["desktop_flow"]["checks"][
                "default_ai_status_uses_provider_defaults"
            ]
        )
        self.assertTrue(
            aligned["desktop_flow"]["checks"][
                "default_ai_status_has_no_status_error"
            ]
        )

        self.assertFalse(drifted["ok"])
        self.assertFalse(drifted["desktop_flow"]["checks"]["default_ai_status_runner"])
        self.assertFalse(
            drifted["desktop_flow"]["checks"][
                "default_ai_status_uses_provider_defaults"
            ]
        )

    def test_desktop_flow_ai_status_uses_provider_preflight_for_default_route(self) -> None:
        ai_status = build_ai_status(
            runner_command_text=(
                "python3 '/tmp/provider_runner.py' --provider openai --use-default-args"
            ),
            command_source="default",
            smoke_result={
                "run_external_json": {
                    "metadata": {
                        "model": "gpt-5.4-mini",
                    }
                }
            },
            preflight_summary={
                "has_auth": True,
                "has_process_env_conflict": False,
                "has_shell_env_conflict": True,
            },
            provider="openai",
        )

        self.assertEqual(
            ai_status["command"],
            "python3 '/tmp/provider_runner.py' --provider openai --use-default-args",
        )
        self.assertEqual(ai_status["command_source"], "default")
        self.assertEqual(ai_status["provider"], "openai")
        self.assertEqual(ai_status["runner"], "provider_runner.py")
        self.assertEqual(ai_status["model"], "gpt-5.4-mini")
        self.assertIsNone(ai_status["reasoning_effort"])
        self.assertTrue(ai_status["has_auth"])
        self.assertFalse(ai_status["has_process_env_conflict"])
        self.assertTrue(ai_status["has_shell_env_conflict"])
        self.assertTrue(ai_status["uses_provider_defaults"])
        self.assertIsNone(ai_status["status_error"])

    def test_desktop_ai_status_contract_matches_rust_struct_fields(self) -> None:
        rust_lib = REPO_ROOT / "desktop" / "src-tauri" / "src" / "lib.rs"
        rust_text = rust_lib.read_text(encoding="utf-8")
        struct_match = re.search(
            r"struct\s+DesktopAiStatus\s*\{(?P<body>.*?)\n\}",
            rust_text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(struct_match, "DesktopAiStatus struct was not found in lib.rs")

        rust_fields = set(
            re.findall(
                r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^,]+,",
                struct_match.group("body"),
                flags=re.MULTILINE,
            )
        )
        self.assertTrue(rust_fields, "DesktopAiStatus field list was empty")

        ai_status = build_ai_status(
            runner_command_text=(
                "python3 '/tmp/provider_runner.py' --provider openai --use-default-args"
            ),
            command_source="default",
            smoke_result={"run_external_json": {"metadata": {"model": "gpt-5.4-mini"}}},
            preflight_summary={
                "has_auth": True,
                "has_process_env_conflict": False,
                "has_shell_env_conflict": True,
            },
            provider="openai",
        )
        python_keys = set(ai_status.keys())

        missing_in_python = sorted(rust_fields - python_keys)
        extra_in_python = sorted(python_keys - rust_fields)
        self.assertEqual(
            missing_in_python,
            [],
            f"build_ai_status() is missing DesktopAiStatus fields: {missing_in_python}",
        )
        self.assertEqual(
            extra_in_python,
            [],
            f"build_ai_status() returned keys not present in DesktopAiStatus: {extra_in_python}",
        )

    def test_provider_doctor_json_includes_summary(self) -> None:
        result = run_script("scripts/provider_doctor.py", "--provider", "openai", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"summary"', result.stdout)
        self.assertIn('"provider": "openai"', result.stdout)

    def test_provider_runner_can_prepend_provider_default_args(self) -> None:
        command = build_runner_command(
            script_path=REPO_ROOT / "scripts" / "provider_runner.py",
            provider="codex",
            passthrough=["--model", "gpt-5.4"],
            use_default_args=True,
        )
        self.assertEqual(command[0], sys.executable)
        self.assertEqual(Path(command[1]).name, "codex_runner.py")
        self.assertEqual(
            command[2:8],
            ["--mode", "plain", "--reasoning-effort", "low", "--max-retries", "3"],
        )
        self.assertEqual(command[8:], ["--model", "gpt-5.4"])


if __name__ == "__main__":
    unittest.main()
