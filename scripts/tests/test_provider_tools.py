import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
FIXTURE_PATH = REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md"

from ai_contract import RunnerFailure, validate_contract_response
from anthropic_context import AnthropicContext
from desktop_flow_smoke import build_ai_status
import langchain_anthropic_runner as langchain_anthropic_runner_module
import langchain_openai_runner as langchain_openai_runner_module
from langchain_runner_common import (
    coerce_direct_evidence,
    invoke_plain_json_fallback,
    normalize_contract_response,
    normalize_expand_like_patch,
)
from openai_context import OpenAIContext
from provider_smoke import run_fixture_set_smoke, run_smoke
from provider_runner import build_runner_command
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


class ProviderToolScriptsTests(unittest.TestCase):
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
                "title": "Anthropic LangChain Regression",
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
            "Explore Anthropic LangChain Regression by question with 1 branches",
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

    def test_openai_invoke_preserves_auth_failure_without_plain_json_fallback(self) -> None:
        class FakeStructuredLlm:
            def invoke(self, messages):
                raise RunnerFailure(category="auth", message="401 unauthorized")

        class FakeChatOpenAI:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema, method=None):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_openai_runner_module,
            "load_langchain_openai_class",
            return_value=FakeChatOpenAI,
        ), patch.object(
            langchain_openai_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_openai_runner_module.invoke_langchain_openai(
                    request_payload=build_request_payload(node_id="auth-node"),
                    api_key="test-openai-key-123456789012",
                    model="gpt-5.4-mini",
                    base_url="https://openai.example/v1",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "auth")
        self.assertFalse(metadata["used_plain_json_fallback"])

    def test_openai_invoke_wraps_runtime_error_without_plain_json_fallback(self) -> None:
        class FakeStructuredLlm:
            def invoke(self, messages):
                raise RuntimeError("socket closed")

        class FakeChatOpenAI:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def with_structured_output(self, schema, method=None):
                return FakeStructuredLlm()

        metadata = {"used_plain_json_fallback": False}

        with patch.object(
            langchain_openai_runner_module,
            "load_langchain_openai_class",
            return_value=FakeChatOpenAI,
        ), patch.object(
            langchain_openai_runner_module,
            "invoke_plain_json_fallback",
            side_effect=AssertionError("fallback should not be called"),
        ):
            with self.assertRaises(RunnerFailure) as ctx:
                langchain_openai_runner_module.invoke_langchain_openai(
                    request_payload=build_request_payload(node_id="runtime-node"),
                    api_key="test-openai-key-123456789012",
                    model="gpt-5.4-mini",
                    base_url="https://openai.example/v1",
                    timeout=30,
                    max_retries=1,
                    metadata=metadata,
                )

        self.assertEqual(ctx.exception.category, "runner_error")
        self.assertIn("socket closed", ctx.exception.message)
        self.assertFalse(metadata["used_plain_json_fallback"])

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
        self.assertEqual(failed["auth"]["failure_kind"], "auth_invalid")
        self.assertEqual(
            payload["failure_metrics"]["counts"],
            {"auth_invalid": 1, "missing_dependency": 1},
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
            "Anthropic LangChain Regression",
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
                "anthropic-default",
                "--runner",
                f"left={command}",
                "--runner",
                f"right={command}",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["fixture_set"], "anthropic-default")
        self.assertEqual(len(payload["cases"]), 3)
        self.assertEqual(payload["aggregate"]["total_cases"], 3)

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
        self.assertIn("openai: runner=openai_runner.py", result.stdout)
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
            "Anthropic LangChain Regression",
        )
        self.assertEqual(
            result["scenario_context"]["target_node"]["id"],
            result["scenario_context"]["imported_root_node"]["id"],
        )

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
                fixture_set_name="anthropic-default",
                fixture_cases=fixture_set_cases("anthropic-default"),
                runner_command_text=shlex.join([sys.executable, str(fake_runner)]),
                apply=False,
                json_mode=True,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["fixture_set"], "anthropic-default")
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
                fixture_set_name="anthropic-default",
                fixture_cases=fixture_set_cases("anthropic-default"),
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
            "Anthropic LangChain Regression",
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
            "Anthropic LangChain Regression",
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

    def test_desktop_flow_ai_status_uses_provider_preflight_for_default_route(self) -> None:
        ai_status = build_ai_status(
            runner_command_text=(
                "python3 '/tmp/provider_runner.py' --provider anthropic --use-default-args"
            ),
            command_source="default",
            smoke_result={
                "run_external_json": {
                    "metadata": {
                        "model": "claude-sonnet",
                    }
                }
            },
            preflight_summary={
                "has_auth": True,
                "has_process_env_conflict": False,
                "has_shell_env_conflict": True,
            },
            provider="anthropic",
        )

        self.assertEqual(
            ai_status["command"],
            "python3 '/tmp/provider_runner.py' --provider anthropic --use-default-args",
        )
        self.assertEqual(ai_status["command_source"], "default")
        self.assertEqual(ai_status["provider"], "anthropic")
        self.assertEqual(ai_status["runner"], "provider_runner.py")
        self.assertEqual(ai_status["model"], "claude-sonnet")
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
                "python3 '/tmp/provider_runner.py' --provider anthropic --use-default-args"
            ),
            command_source="default",
            smoke_result={"run_external_json": {"metadata": {"model": "claude-sonnet"}}},
            preflight_summary={
                "has_auth": True,
                "has_process_env_conflict": False,
                "has_shell_env_conflict": True,
            },
            provider="anthropic",
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
