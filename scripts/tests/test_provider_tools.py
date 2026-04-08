import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

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
    def test_langchain_openai_runner_help(self) -> None:
        result = run_script("scripts/langchain_openai_runner.py", "--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Experimental LangChain + OpenAI runner", result.stdout)

    def test_provider_runner_list(self) -> None:
        result = run_script("scripts/provider_runner.py", "--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("codex: runnable", result.stdout)
        self.assertIn("openai: runnable", result.stdout)
        self.assertIn("gemini: runnable", result.stdout)

    def test_provider_smoke_list(self) -> None:
        result = run_script("scripts/provider_smoke.py", "--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("codex: runner=codex_runner.py", result.stdout)
        self.assertIn("openai: runner=openai_runner.py", result.stdout)
        self.assertIn("gemini: runner=gemini_runner.py", result.stdout)

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
