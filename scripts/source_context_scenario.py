#!/usr/bin/env python3

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE_PATH = REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md"
DEFAULT_TARGET_LABEL = "Provider Authentication Flow"
DEFAULT_CITATION_KIND = "direct"
DEFAULT_CITATION_RATIONALE = (
    "This imported section defines the OpenAI-compatible runner setup."
)
DEFAULT_ROOT_CITATION_RATIONALE = (
    "This imported section establishes the root source topic that the draft expands."
)
DEFAULT_FIXTURE_SET = "openai-default"

OPENAI_DEFAULT_FIXTURE_SET_CASES = [
    {
        "id": "config",
        "fixture_path": REPO_ROOT / "scripts" / "fixtures" / "source-context-smoke.md",
        "target_label": "Provider Authentication Flow",
        "citation_rationale": (
            "This imported section defines the OpenAI-compatible runner setup."
        ),
    },
    {
        "id": "research",
        "fixture_path": REPO_ROOT / "scripts" / "fixtures" / "research-context-smoke.md",
        "target_label": "Key Findings",
        "citation_rationale": (
            "This imported section captures the primary findings that the draft should build on."
        ),
    },
    {
        "id": "plan",
        "fixture_path": REPO_ROOT / "scripts" / "fixtures" / "plan-context-smoke.md",
        "target_label": "Immediate Milestones",
        "citation_rationale": (
            "This imported section defines the near-term delivery plan that the draft should extend."
        ),
    },
]

FIXTURE_SET_CASES = {
    "openai-default": OPENAI_DEFAULT_FIXTURE_SET_CASES,
    # Backward-compatible alias for older scripts/tests that still pass the legacy name.
    "anthropic-default": OPENAI_DEFAULT_FIXTURE_SET_CASES,
}


class ScenarioFailure(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def prepare_source_root_scenario(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    fixture_path: Optional[Path] = None,
    cite_root_evidence: bool = False,
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
    imported_root = parse_imported_root_from_stdout(import_step["stdout"])
    if imported_root is None:
        raise ScenarioFailure("source import output did not include an imported root node")
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

    imported_root_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["node", "show", imported_root["id"], "--format", "json"],
        expect_json=True,
    )
    result = {
        "scenario": "source-root",
        "fixture_path": str(fixture_path),
        "source_id": source_id,
        "imported_root_node": imported_root,
        "target_node": imported_root,
        "steps": {
            "source_import": import_step,
            "source_list": source_list,
            "source_show": source_detail,
            "imported_root_show": imported_root_detail,
        },
    }
    if not cite_root_evidence:
        return result

    root_context = select_source_root_context(source_detail, imported_root["id"])
    cite_step = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=[
            "node",
            "cite-chunk",
            imported_root["id"],
            root_context["chunk_id"],
            "--citation-kind",
            DEFAULT_CITATION_KIND,
            "--rationale",
            DEFAULT_ROOT_CITATION_RATIONALE,
        ],
        expect_json=False,
    )
    node_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["node", "show", imported_root["id"], "--format", "json"],
        expect_json=True,
    )
    cited_source_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["source", "show", source_id, "--format", "json"],
        expect_json=True,
    )
    result["evidence"] = {
        "chunk_id": root_context["chunk_id"],
        "chunk_label": root_context["chunk_label"],
        "citation_kind": DEFAULT_CITATION_KIND,
        "rationale": DEFAULT_ROOT_CITATION_RATIONALE,
    }
    result["steps"]["cite_chunk"] = cite_step
    result["steps"]["node_show"] = node_detail
    result["steps"]["source_show_after_cite"] = cited_source_detail
    return result


def prepare_source_context_scenario(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    fixture_path: Optional[Path] = None,
    target_label: str = DEFAULT_TARGET_LABEL,
    citation_rationale: str = DEFAULT_CITATION_RATIONALE,
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
    imported_root = parse_imported_root_from_stdout(import_step["stdout"])
    if imported_root is None:
        raise ScenarioFailure("source import output did not include an imported root node")
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
    imported_root_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["node", "show", imported_root["id"], "--format", "json"],
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
            citation_rationale,
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
        "imported_root_node": imported_root,
        "target_node": {
            "id": node_id,
            "title": target_context["node_title"],
        },
        "evidence": {
            "chunk_id": chunk_id,
            "chunk_label": target_context["chunk_label"],
            "citation_kind": DEFAULT_CITATION_KIND,
            "rationale": citation_rationale,
        },
        "steps": {
            "source_import": import_step,
            "source_list": source_list,
            "source_show": source_detail,
            "imported_root_show": imported_root_detail,
            "cite_chunk": cite_step,
            "node_show": node_detail,
        },
    }


def verify_source_root_workspace_state(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    scenario_payload: dict[str, Any],
    created_nodes: Optional[list[dict[str, Any]]] = None,
    patch_ops: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    imported_root = scenario_payload["imported_root_node"]
    target_node = scenario_payload.get("target_node") or imported_root
    evidence = scenario_payload.get("evidence")
    imported_root_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["node", "show", imported_root["id"], "--format", "json"],
        expect_json=True,
    )
    source_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["source", "show", scenario_payload["source_id"], "--format", "json"],
        expect_json=True,
    )

    imported_root_under_workspace_root = (
        (imported_root_detail.get("parent") or {}).get("id") == "root"
    )
    imported_root_source_link_retained = any(
        (detail.get("source") or {}).get("id") == scenario_payload["source_id"]
        for detail in (imported_root_detail.get("sources") or [])
        if isinstance(detail, dict)
    )
    target_evidence_retained = None
    source_evidence_link_retained = None
    if isinstance(evidence, dict):
        target_evidence_retained = target_has_expected_evidence(
            node_detail=imported_root_detail,
            expected_chunk_id=evidence["chunk_id"],
            expected_citation_kind=evidence["citation_kind"],
            expected_rationale=evidence["rationale"],
        )
        source_evidence_link_retained = source_has_expected_evidence_link(
            source_detail=source_detail,
            expected_chunk_id=evidence["chunk_id"],
            expected_node_id=target_node["id"],
            expected_citation_kind=evidence["citation_kind"],
            expected_rationale=evidence["rationale"],
        )

    created_node_checks = []
    created_nodes_present = None
    created_nodes_match_patch = None
    if created_nodes is not None:
        child_ids = {
            item.get("id")
            for item in imported_root_detail.get("children") or []
            if isinstance(item, dict) and item.get("id")
        }
        expected_created_nodes = expected_created_node_specs(created_nodes, patch_ops)
        created_nodes_present = True
        created_nodes_match_patch = True
        for expected in expected_created_nodes:
            created_id = expected.get("id")
            is_child = bool(created_id) and created_id in child_ids
            created_nodes_present = created_nodes_present and is_child
            matches_patch = False
            if created_id and is_child:
                detail = run_nodex_command(
                    manifest_path=manifest_path,
                    workspace_dir=workspace_dir,
                    args=["node", "show", created_id, "--format", "json"],
                    expect_json=True,
                )
                node = detail.get("node") or {}
                parent = detail.get("parent") or {}
                matches_patch = (
                    parent.get("id") == imported_root["id"]
                    and node.get("title") == expected.get("expected_title")
                    and node.get("kind") == expected.get("expected_kind")
                    and node.get("body") == expected.get("expected_body")
                )
            created_nodes_match_patch = created_nodes_match_patch and matches_patch
            created_node_checks.append(
                {
                    "id": created_id,
                    "reported_title": expected.get("reported_title"),
                    "expected_title": expected.get("expected_title"),
                    "present_under_imported_root": is_child,
                    "matches_patch": matches_patch,
                }
            )

    ok = imported_root_under_workspace_root and imported_root_source_link_retained
    if isinstance(evidence, dict):
        ok = ok and bool(target_evidence_retained) and bool(source_evidence_link_retained)
    if created_nodes is not None:
        ok = ok and bool(created_nodes_present) and bool(created_nodes_match_patch)

    return {
        "imported_root_node_id": imported_root["id"],
        "target_node_id": target_node["id"],
        "expected_chunk_id": evidence["chunk_id"] if isinstance(evidence, dict) else None,
        "imported_root_under_workspace_root": imported_root_under_workspace_root,
        "imported_root_source_link_retained": imported_root_source_link_retained,
        "target_evidence_retained": target_evidence_retained,
        "source_evidence_link_retained": source_evidence_link_retained,
        "created_nodes_present": created_nodes_present,
        "created_nodes_match_patch": created_nodes_match_patch,
        "created_node_checks": created_node_checks,
        "ok": ok,
    }


def verify_source_context_workspace_state(
    *,
    manifest_path: Path,
    workspace_dir: Path,
    scenario_payload: dict[str, Any],
    created_nodes: Optional[list[dict[str, Any]]] = None,
    patch_ops: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    target_node = scenario_payload["target_node"]
    evidence = scenario_payload["evidence"]
    imported_root = scenario_payload.get("imported_root_node") or {}
    target_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["node", "show", target_node["id"], "--format", "json"],
        expect_json=True,
    )
    source_detail = run_nodex_command(
        manifest_path=manifest_path,
        workspace_dir=workspace_dir,
        args=["source", "show", scenario_payload["source_id"], "--format", "json"],
        expect_json=True,
    )

    target_evidence_retained = target_has_expected_evidence(
        node_detail=target_detail,
        expected_chunk_id=evidence["chunk_id"],
        expected_citation_kind=evidence["citation_kind"],
        expected_rationale=evidence["rationale"],
    )
    source_evidence_link_retained = source_has_expected_evidence_link(
        source_detail=source_detail,
        expected_chunk_id=evidence["chunk_id"],
        expected_node_id=target_node["id"],
        expected_citation_kind=evidence["citation_kind"],
        expected_rationale=evidence["rationale"],
    )
    target_node_under_imported_root = (
        bool(imported_root.get("id"))
        and (target_detail.get("parent") or {}).get("id") == imported_root.get("id")
    )

    created_node_checks = []
    created_nodes_present = None
    created_nodes_match_patch = None
    if created_nodes is not None:
        child_ids = {
            item.get("id")
            for item in target_detail.get("children") or []
            if isinstance(item, dict) and item.get("id")
        }
        expected_created_nodes = expected_created_node_specs(created_nodes, patch_ops)
        created_nodes_present = True
        created_nodes_match_patch = True
        for expected in expected_created_nodes:
            created_id = expected.get("id")
            is_child = bool(created_id) and created_id in child_ids
            created_nodes_present = created_nodes_present and is_child
            detail = None
            matches_patch = False
            if created_id and is_child:
                detail = run_nodex_command(
                    manifest_path=manifest_path,
                    workspace_dir=workspace_dir,
                    args=["node", "show", created_id, "--format", "json"],
                    expect_json=True,
                )
                node = detail.get("node") or {}
                parent = detail.get("parent") or {}
                matches_patch = (
                    parent.get("id") == target_node["id"]
                    and node.get("title") == expected.get("expected_title")
                    and node.get("kind") == expected.get("expected_kind")
                    and node.get("body") == expected.get("expected_body")
                )
            created_nodes_match_patch = created_nodes_match_patch and matches_patch
            created_node_checks.append(
                {
                    "id": created_id,
                    "reported_title": expected.get("reported_title"),
                    "expected_title": expected.get("expected_title"),
                    "present_under_target": is_child,
                    "matches_patch": matches_patch,
                }
            )

    ok = (
        target_evidence_retained
        and source_evidence_link_retained
        and target_node_under_imported_root
    )
    if created_nodes is not None:
        ok = ok and bool(created_nodes_present) and bool(created_nodes_match_patch)

    return {
        "imported_root_node_id": imported_root.get("id"),
        "target_node_id": target_node["id"],
        "expected_chunk_id": evidence["chunk_id"],
        "target_node_under_imported_root": target_node_under_imported_root,
        "target_evidence_retained": target_evidence_retained,
        "source_evidence_link_retained": source_evidence_link_retained,
        "created_nodes_present": created_nodes_present,
        "created_nodes_match_patch": created_nodes_match_patch,
        "created_node_checks": created_node_checks,
        "ok": ok,
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


def select_source_root_context(
    source_detail: dict[str, Any],
    imported_root_id: str,
) -> dict[str, str]:
    chunks = source_detail.get("chunks")
    if not isinstance(chunks, list):
        raise ScenarioFailure("source detail did not include a chunks array")

    for chunk_detail in chunks:
        chunk = chunk_detail.get("chunk") or {}
        linked_nodes = chunk_detail.get("linked_nodes") or []
        if not any(
            isinstance(node, dict) and node.get("id") == imported_root_id
            for node in linked_nodes
        ):
            continue
        chunk_id = chunk.get("id")
        if not chunk_id:
            continue
        return {
            "chunk_id": chunk_id,
            "chunk_label": chunk.get("label") or "",
        }

    raise ScenarioFailure(
        f"source root context for imported root `{imported_root_id}` was not found"
    )


def target_has_expected_evidence(
    *,
    node_detail: dict[str, Any],
    expected_chunk_id: str,
    expected_citation_kind: str,
    expected_rationale: str,
) -> bool:
    for evidence_detail in node_detail.get("evidence") or []:
        citations = evidence_detail.get("citations") or []
        for citation in citations:
            chunk = citation.get("chunk") or {}
            if chunk.get("id") != expected_chunk_id:
                continue
            if citation.get("citation_kind") != expected_citation_kind:
                continue
            if citation.get("rationale") != expected_rationale:
                continue
            return True
    return False


def parse_imported_root_from_stdout(stdout: str) -> Optional[dict[str, str]]:
    match = re.search(
        r"generated root node:\s*(?P<title>.+?)\s*\[(?P<id>[^\]]+)\]",
        stdout,
    )
    if not match:
        return None

    return {
        "id": match.group("id").strip(),
        "title": match.group("title").strip(),
    }


def source_has_expected_evidence_link(
    *,
    source_detail: dict[str, Any],
    expected_chunk_id: str,
    expected_node_id: str,
    expected_citation_kind: str,
    expected_rationale: str,
) -> bool:
    for chunk_detail in source_detail.get("chunks") or []:
        chunk = chunk_detail.get("chunk") or {}
        if chunk.get("id") != expected_chunk_id:
            continue
        evidence_links = chunk_detail.get("evidence_links") or []
        for link in evidence_links:
            node = link.get("node") or {}
            if node.get("id") != expected_node_id:
                continue
            if link.get("citation_kind") != expected_citation_kind:
                continue
            if link.get("rationale") != expected_rationale:
                continue
            return True
    return False


def expected_created_node_specs(
    created_nodes: list[dict[str, Any]],
    patch_ops: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    add_node_ops = [
        op for op in (patch_ops or []) if isinstance(op, dict) and op.get("type") == "add_node"
    ]
    expected_nodes = []
    for index, created in enumerate(created_nodes):
        add_node_op = add_node_ops[index] if index < len(add_node_ops) else {}
        expected_nodes.append(
            {
                "id": created.get("id"),
                "reported_title": created.get("title"),
                "expected_title": add_node_op.get("title"),
                "expected_kind": add_node_op.get("kind"),
                "expected_body": add_node_op.get("body"),
            }
        )
    return expected_nodes


def fixture_set_names() -> tuple[str, ...]:
    return tuple(FIXTURE_SET_CASES.keys())


def fixture_set_cases(name: str) -> list[dict[str, Any]]:
    cases = FIXTURE_SET_CASES.get(name)
    if cases is None:
        raise ScenarioFailure(f"unsupported fixture set `{name}`")
    return [
        {
            "id": item["id"],
            "fixture_path": Path(item["fixture_path"]).resolve(),
            "target_label": item["target_label"],
            "citation_rationale": item["citation_rationale"],
        }
        for item in cases
    ]


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
