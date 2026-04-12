import json
import re
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
FIXTURE_PATH = REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md"

from langchain_anthropic_runner import (
    coerce_direct_evidence,
    normalize_expand_like_patch,
)
from desktop_flow_smoke import build_ai_status
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

    def test_runner_compare_lists_presets(self) -> None:
        result = run_script("scripts/runner_compare.py", "--list-presets")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("langchain-pilot", result.stdout)
        self.assertIn("langchain-openai", result.stdout)
        self.assertIn("langchain-anthropic", result.stdout)

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
        self.assertTrue(checks["source_context_target_selected"])
        self.assertTrue(checks["draft_generated"])
        self.assertTrue(checks["review_payload_available"])
        self.assertTrue(checks["dry_run_verified"])
        self.assertTrue(checks["next_focus_candidate_ready"])
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
        self.assertTrue(checks["patch_applied"])
        self.assertTrue(checks["created_node_verified"])
        self.assertTrue(checks["next_focus_candidate_ready"])
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
