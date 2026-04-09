import json
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
FIXTURE_PATH = REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md"

from provider_smoke import run_smoke
from provider_runner import build_runner_command


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class ProviderToolScriptsTests(unittest.TestCase):
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
        self.assertTrue(command[1].endswith("scripts/codex_runner.py"))
        self.assertEqual(
            command[2:8],
            ["--mode", "plain", "--reasoning-effort", "low", "--max-retries", "3"],
        )
        self.assertEqual(command[8:], ["--model", "gpt-5.4"])


if __name__ == "__main__":
    unittest.main()
