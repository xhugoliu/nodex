import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from anthropic_context import load_anthropic_context
from openai_context import load_openai_context


def write_env_file(path: Path, values: dict[str, str]) -> None:
    path.write_text(
        "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
        encoding="utf-8",
    )


class ProviderContextTests(unittest.TestCase):
    def test_openai_context_prefers_overrides_then_env_local_then_process_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir).resolve()
            scripts_dir = repo_root / "scripts"
            scripts_dir.mkdir()
            write_env_file(
                repo_root / ".env.local",
                {
                    "OPENAI_API_KEY": "local-openai-key-123456789012",
                    "OPENAI_MODEL": "local-model",
                    "OPENAI_BASE_URL": "https://local.example/v1",
                    "OPENAI_TIMEOUT_SECONDS": "45",
                    "OPENAI_REASONING_EFFORT": "medium",
                },
            )
            write_env_file(
                repo_root / ".env",
                {
                    "OPENAI_API_KEY": "env-openai-key-999999999999",
                    "OPENAI_MODEL": "env-model",
                    "OPENAI_REASONING_EFFORT": "low",
                },
            )

            with patch.dict(
                os.environ,
                {
                    "OPENAI_API_KEY": "process-openai-key-abcdef123456",
                    "OPENAI_MODEL": "process-model",
                    "OPENAI_BASE_URL": "https://process.example/v1",
                    "OPENAI_TIMEOUT_SECONDS": "90",
                },
                clear=True,
            ):
                context = load_openai_context(
                    script_path=scripts_dir / "openai_context.py",
                    model_override="override-model",
                    base_url_override="https://override.example/v1",
                    timeout_override=15,
                )

        self.assertEqual(context.repo_root, repo_root)
        self.assertEqual(context.env_file_path, repo_root / ".env.local")
        self.assertEqual(context.api_key, "local-openai-key-123456789012")
        self.assertEqual(context.model, "override-model")
        self.assertEqual(context.base_url, "https://override.example/v1")
        self.assertEqual(context.timeout_seconds, 15)
        self.assertEqual(context.reasoning_effort, "medium")
        self.assertEqual(
            context.process_openai_env["OPENAI_API_KEY"],
            "process-openai-key-abcdef123456",
        )

    def test_anthropic_context_prefers_env_local_auth_and_timeout_over_process_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir).resolve()
            scripts_dir = repo_root / "scripts"
            scripts_dir.mkdir()
            write_env_file(
                repo_root / ".env.local",
                {
                    "ANTHROPIC_AUTH_TOKEN": "local-auth-token-123456789012",
                    "ANTHROPIC_API_KEY": "local-anthropic-key-123456789012",
                    "ANTHROPIC_MODEL": "local-claude",
                    "ANTHROPIC_BASE_URL": "https://local.anthropic.example",
                    "ANTHROPIC_TIMEOUT_SECONDS": "5",
                    "API_TIMEOUT_MS": "5000",
                },
            )
            write_env_file(
                repo_root / ".env",
                {
                    "ANTHROPIC_MODEL": "env-claude",
                    "API_TIMEOUT_MS": "9000",
                },
            )

            with patch.dict(
                os.environ,
                {
                    "ANTHROPIC_AUTH_TOKEN": "process-auth-token-abcdef123456",
                    "ANTHROPIC_TIMEOUT_SECONDS": "7",
                },
                clear=True,
            ):
                context = load_anthropic_context(
                    script_path=scripts_dir / "anthropic_context.py"
                )

        self.assertEqual(context.repo_root, repo_root)
        self.assertEqual(context.env_file_path, repo_root / ".env.local")
        self.assertEqual(context.api_key, "local-auth-token-123456789012")
        self.assertEqual(context.model, "local-claude")
        self.assertEqual(context.base_url, "https://local.anthropic.example")
        self.assertEqual(context.timeout_seconds, 5)
        self.assertEqual(
            context.process_anthropic_env["ANTHROPIC_AUTH_TOKEN"],
            "process-auth-token-abcdef123456",
        )

    def test_openai_context_uses_env_when_env_local_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir).resolve()
            scripts_dir = repo_root / "scripts"
            scripts_dir.mkdir()
            write_env_file(
                repo_root / ".env",
                {
                    "OPENAI_API_KEY": "env-only-openai-key-123456789012",
                    "OPENAI_BASE_URL": "https://env-only.example/v1",
                },
            )

            with patch.dict(os.environ, {}, clear=True):
                context = load_openai_context(
                    script_path=scripts_dir / "openai_context.py"
                )

        self.assertEqual(context.env_file_path, repo_root / ".env")
        self.assertEqual(context.api_key, "env-only-openai-key-123456789012")
        self.assertEqual(context.base_url, "https://env-only.example/v1")

    def test_anthropic_context_uses_api_timeout_ms_when_seconds_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir).resolve()
            scripts_dir = repo_root / "scripts"
            scripts_dir.mkdir()

            with patch.dict(
                os.environ,
                {
                    "API_TIMEOUT_MS": "2500",
                },
                clear=True,
            ):
                context = load_anthropic_context(
                    script_path=scripts_dir / "anthropic_context.py"
                )

        self.assertEqual(context.timeout_seconds, 2)

    def test_anthropic_context_uses_env_when_env_local_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir).resolve()
            scripts_dir = repo_root / "scripts"
            scripts_dir.mkdir()
            write_env_file(
                repo_root / ".env",
                {
                    "ANTHROPIC_API_KEY": "env-only-anthropic-key-123456789012",
                    "ANTHROPIC_MODEL": "env-only-claude",
                    "ANTHROPIC_BASE_URL": "https://env-only.anthropic.example",
                },
            )

            with patch.dict(os.environ, {}, clear=True):
                context = load_anthropic_context(
                    script_path=scripts_dir / "anthropic_context.py"
                )

        self.assertEqual(context.env_file_path, repo_root / ".env")
        self.assertEqual(context.api_key, "env-only-anthropic-key-123456789012")
        self.assertEqual(context.model, "env-only-claude")
        self.assertEqual(context.base_url, "https://env-only.anthropic.example")

    def test_anthropic_context_prefers_explicit_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir).resolve()
            scripts_dir = repo_root / "scripts"
            scripts_dir.mkdir()
            write_env_file(
                repo_root / ".env.local",
                {
                    "ANTHROPIC_MODEL": "local-claude",
                    "ANTHROPIC_BASE_URL": "https://local.anthropic.example",
                    "ANTHROPIC_TIMEOUT_SECONDS": "22",
                },
            )

            with patch.dict(
                os.environ,
                {
                    "ANTHROPIC_API_KEY": "process-anthropic-key-abcdef123456",
                },
                clear=True,
            ):
                context = load_anthropic_context(
                    script_path=scripts_dir / "anthropic_context.py",
                    model_override="override-claude",
                    base_url_override="https://override.anthropic.example",
                    timeout_override=15,
                )

        self.assertEqual(context.model, "override-claude")
        self.assertEqual(context.base_url, "https://override.anthropic.example")
        self.assertEqual(context.timeout_seconds, 15)


if __name__ == "__main__":
    unittest.main()
