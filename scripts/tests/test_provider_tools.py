import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class ProviderToolScriptsTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
