import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TreePane } from "./components/panes";
import type { WorkspaceOverview } from "./types";

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

function makeOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "node-1",
            parent_id: "root",
            title: "Authentication",
            body: null,
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
      ],
    },
    sources: [],
    snapshots: [
      {
        id: "snapshot-3",
        label: "After review",
        file_name: "snapshot-3.json",
        created_at: 1710000300,
      },
      {
        id: "snapshot-2",
        label: null,
        file_name: "snapshot-2.json",
        created_at: 1710000200,
      },
      {
        id: "snapshot-1",
        label: "Before apply",
        file_name: "snapshot-1.json",
        created_at: 1710000100,
      },
      {
        id: "snapshot-0",
        label: "Older snapshot that should stay hidden",
        file_name: "snapshot-0.json",
        created_at: 1710000000,
      },
    ],
    patch_history: [
      {
        id: "patch-3",
        summary: "Promote draft to review",
        origin: "manual",
        file_name: "patch-3.json",
        applied_at: 1710000500,
      },
      {
        id: "patch-2",
        summary: "Attach source evidence",
        origin: "manual",
        file_name: "patch-2.json",
        applied_at: 1710000400,
      },
      {
        id: "patch-1",
        summary: "Tighten node wording",
        origin: "manual",
        file_name: "patch-1.json",
        applied_at: 1710000300,
      },
      {
        id: "patch-0",
        summary: "Older patch that should stay hidden",
        origin: "manual",
        file_name: "patch-0.json",
        applied_at: 1710000200,
      },
    ],
  };
}

function renderTreePane(workspaceOverview: WorkspaceOverview | null) {
  return renderToStaticMarkup(
    <TreePane
      defaultRecoveryExpanded={false}
      filteredTree={workspaceOverview?.tree ?? null}
      isCollapsed={false}
      onImportSource={() => {}}
      onLoadPatchToReview={() => {}}
      onQueryChange={() => {}}
      onRestoreLatestSnapshot={() => {}}
      onSaveSnapshot={() => {}}
      onSelectNode={() => {}}
      onToggleCollapse={() => {}}
      query=""
      selectedNodeId="node-1"
      t={t}
      treeQuery=""
      treeSummary="navigator.totalNodes"
      workspaceOverview={workspaceOverview}
    />,
  );
}

function renderExpandedTreePane(workspaceOverview: WorkspaceOverview | null) {
  return renderToStaticMarkup(
    <TreePane
      defaultRecoveryExpanded={true}
      filteredTree={workspaceOverview?.tree ?? null}
      isCollapsed={false}
      onImportSource={() => {}}
      onLoadPatchToReview={() => {}}
      onQueryChange={() => {}}
      onRestoreLatestSnapshot={() => {}}
      onSaveSnapshot={() => {}}
      onSelectNode={() => {}}
      onToggleCollapse={() => {}}
      query=""
      selectedNodeId="node-1"
      t={t}
      treeQuery=""
      treeSummary="navigator.totalNodes"
      workspaceOverview={workspaceOverview}
    />,
  );
}

test("TreePane keeps Recovery as a lightweight latest-only entry", () => {
  const html = renderTreePane(makeOverview());

  assert.match(html, /sidebar\.recoveryExpand/);
  assert.doesNotMatch(html, /sidebar\.recovery"/);
  assert.doesNotMatch(html, /sidebar\.recovery</);
  assert.doesNotMatch(html, /sidebar\.recoverySnapshotCount/);
  assert.doesNotMatch(html, /sidebar\.recoveryPatchCount/);
  assert.doesNotMatch(html, /sidebar\.recoveryBody/);
  assert.doesNotMatch(html, /sidebar\.restoreLatestSnapshot/);
  assert.doesNotMatch(html, /sidebar\.recoveryRestoreNote/);
  assert.doesNotMatch(html, /sidebar\.recoveryLatestSnapshot/);
  assert.doesNotMatch(html, /After review/);
  assert.doesNotMatch(html, /Before apply/);
  assert.doesNotMatch(html, /history\.restore/);
  assert.doesNotMatch(html, /sidebar\.recoveryLatestPatch/);
  assert.doesNotMatch(html, /sidebar\.recoveryLoadPatchToReview/);
  assert.doesNotMatch(html, /Promote draft to review/);
});

test("TreePane shows latest-only recovery details when the secondary entry is expanded", () => {
  const html = renderExpandedTreePane(makeOverview());

  assert.match(html, /sidebar\.recovery/);
  assert.match(html, /sidebar\.recoveryCollapse/);
  assert.match(html, /sidebar\.recoveryBody/);
  assert.match(html, /sidebar\.restoreLatestSnapshot/);
  assert.match(html, /sidebar\.recoveryRestoreNote/);
  assert.match(html, /sidebar\.recoveryLatestSnapshot/);
  assert.match(html, /After review/);
  assert.doesNotMatch(html, /Before apply/);
  assert.match(html, /sidebar\.recoveryLatestPatch/);
  assert.match(html, /sidebar\.recoveryLoadPatchToReview/);
  assert.match(html, /Promote draft to review/);
  assert.match(
    html,
    /detail\.activityOrigin \{&quot;value&quot;:&quot;manual&quot;\}/,
  );
  assert.doesNotMatch(html, /sidebar\.recoverySnapshotCount/);
  assert.doesNotMatch(html, /sidebar\.recoveryPatchCount/);
  assert.doesNotMatch(html, /Attach source evidence/);
  assert.doesNotMatch(html, /Tighten node wording/);
  assert.doesNotMatch(html, /Older patch that should stay hidden/);
  assert.doesNotMatch(html, /Older snapshot that should stay hidden/);
});

test("TreePane recovery card falls back to an empty restore state before any snapshots exist", () => {
  const overview = makeOverview();
  overview.snapshots = [];
  overview.patch_history = [];

  const html = renderExpandedTreePane(overview);

  assert.match(html, /sidebar\.recovery/);
  assert.match(html, /sidebar\.recoveryEmpty/);
  assert.doesNotMatch(html, /sidebar\.recoverySnapshotCount/);
  assert.doesNotMatch(html, /sidebar\.recoveryPatchCount/);
  assert.match(html, /disabled=""/);
});
