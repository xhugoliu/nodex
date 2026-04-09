#!/usr/bin/env python3

import json
import subprocess
from pathlib import Path
from typing import Any, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE_PATH = REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md"
DEFAULT_TARGET_LABEL = "Provider Authentication Flow"
DEFAULT_CITATION_KIND = "direct"
DEFAULT_CITATION_RATIONALE = (
    "This imported section defines the Anthropic-compatible runner setup."
)


class ScenarioFailure(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def prepare_source_context_scenario(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    fixture_path: Optional[Path] = None,
    target_label: str = DEFAULT_TARGET_LABEL,
) -> dict[str, Any]:
    fixture_path = (fixture_path or DEFAULT_FIXTURE_PATH).resolve()
    if not fixture_path.exists():
        raise ScenarioFailure(f"fixture was not found: {fixture_path}")

    import_step = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["source", "import", str(fixture_path)],
        expect_json=False,
    )
    source_list = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["source", "list", "--format", "json"],
        expect_json=True,
    )
    if not isinstance(source_list, list) or not source_list:
        raise ScenarioFailure("source import did not produce any source records")
    source_id = source_list[0]["id"]

    source_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["source", "show", source_id, "--format", "json"],
        expect_json=True,
    )
    target_context = select_target_context(source_detail, target_label)
    node_id = target_context["node_id"]
    chunk_id = target_context["chunk_id"]

    cite_step = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=[
            "node",
            "cite-chunk",
            node_id,
            chunk_id,
            "--citation-kind",
            DEFAULT_CITATION_KIND,
            "--rationale",
            DEFAULT_CITATION_RATIONALE,
        ],
        expect_json=False,
    )
    node_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["node", "show", node_id, "--format", "json"],
        expect_json=True,
    )
    evidence = node_detail.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise ScenarioFailure(
            f"node {node_id} did not retain evidence after cite-chunk"
        )

    return {
        "scenario": "source-context",
        "fixture_path": str(fixture_path),
        "source_id": source_id,
        "target_node": {
            "id": node_id,
            "title": target_context["node_title"],
        },
        "evidence": {
            "chunk_id": chunk_id,
            "chunk_label": target_context["chunk_label"],
            "citation_kind": DEFAULT_CITATION_KIND,
            "rationale": DEFAULT_CITATION_RATIONALE,
        },
        "steps": {
            "source_import": import_step,
            "source_list": source_list,
            "source_show": source_detail,
            "cite_chunk": cite_step,
            "node_show": node_detail,
        },
    }


def select_target_context(source_detail: dict[str, Any], target_label: str) -> dict[str, str]:
    chunks = source_detail.get("chunks")
    if not isinstance(chunks, list):
        raise ScenarioFailure("source detail did not include a chunks array")

    for chunk_detail in chunks:
        chunk = chunk_detail.get("chunk") or {}
        label = chunk.get("label")
        linked_nodes = chunk_detail.get("linked_nodes") or []
        if label != target_label or not linked_nodes:
            continue
        node = linked_nodes[0]
        return {
            "node_id": node["id"],
            "node_title": node["title"],
            "chunk_id": chunk["id"],
            "chunk_label": label,
        }

    available_labels = [
        item.get("chunk", {}).get("label")
        for item in chunks
        if isinstance(item, dict)
    ]
    raise ScenarioFailure(
        f"source context chunk `{target_label}` was not found; available labels: {available_labels}"
    )


def run_nodex_command(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    args: list[str],
    expect_json: bool,
) -> Any:
    command = [
        "cargo",
        "run",
        "--manifest-path",
        str(manifest_path),
        "--",
        *args,
    ]
    completed = subprocess.run(
        command,
        cwd=workspace_dir,
        check=False,
        capture_output=True,
        text=True,
    )
    detail = completed.stderr.strip() or completed.stdout.strip()
    if completed.returncode != 0:
        raise ScenarioFailure(detail or str(completed.returncode))

    if not expect_json:
        return {
            "command": command,
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }

    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ScenarioFailure(f"command did not return valid JSON: {exc}") from exc
