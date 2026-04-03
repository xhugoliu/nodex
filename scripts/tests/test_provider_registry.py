import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from provider_registry import (
    build_diagnostics_summary,
    get_provider_entry,
    provider_names,
    runnable_provider_names,
)


class ProviderRegistryTests(unittest.TestCase):
    def test_provider_names_cover_supported_entries(self) -> None:
        self.assertEqual(provider_names(), ("codex", "openai", "gemini"))

    def test_runnable_provider_names_cover_all_current_entries(self) -> None:
        self.assertEqual(runnable_provider_names(), ("codex", "openai", "gemini"))

    def test_gemini_entry_has_runner_script(self) -> None:
        entry = get_provider_entry("gemini")
        self.assertEqual(entry.runner_script, "gemini_runner.py")

    def test_build_diagnostics_summary_uses_common_flags(self) -> None:
        entry = get_provider_entry("openai")
        summary = build_diagnostics_summary(
            entry,
            {
                "api_key": "masked",
                "process_openai_env": {"OPENAI_API_KEY": "***"},
                "shell_openai_env_candidates": [],
            },
        )
        self.assertEqual(summary["provider"], "openai")
        self.assertTrue(summary["runnable"])
        self.assertTrue(summary["has_auth"])
        self.assertTrue(summary["has_process_env_conflict"])
        self.assertFalse(summary["has_shell_env_conflict"])


if __name__ == "__main__":
    unittest.main()
