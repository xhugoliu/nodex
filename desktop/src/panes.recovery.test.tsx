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
      filteredTree={workspaceOverview?.tree ?? null}
      isCollapsed={false}
      onImportSource={() => {}}
      onLoadPatchToReview={() => {}}
      onQueryChange={() => {}}
      onRestoreSnapshot={() => {}}
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

test("TreePane renders a lightweight recovery card with recent patch review entries", () => {
  const html = renderTreePane(makeOverview());

  assert.match(html, /sidebar\.recovery/);
  assert.match(html, /sidebar\.recoverySnapshotCount \{&quot;count&quot;:4\}/);
  assert.match(html, /sidebar\.recoveryPatchCount \{&quot;count&quot;:4\}/);
  assert.match(html, /sidebar\.restoreLatestSnapshot/);
  assert.match(html, /sidebar\.recoveryRestoreNote/);
  assert.match(html, /After review/);
  assert.match(html, /Before apply|history\.noLabel/);
  assert.match(html, /history\.restore/);
  assert.match(html, /sidebar\.recoveryRecentPatches/);
  assert.match(html, /sidebar\.recoveryLoadPatchToReview/);
  assert.match(html, /Promote draft to review/);
  assert.match(
    html,
    /detail\.activityOrigin \{&quot;value&quot;:&quot;manual&quot;\}/,
  );
  assert.match(html, /Attach source evidence/);
  assert.match(html, /Tighten node wording/);
  assert.doesNotMatch(html, /Older patch that should stay hidden/);
  assert.doesNotMatch(html, /Older snapshot that should stay hidden/);
});

test("TreePane recovery card falls back to an empty restore state before any snapshots exist", () => {
  const overview = makeOverview();
  overview.snapshots = [];
  overview.patch_history = [];

  const html = renderTreePane(overview);

  assert.match(html, /sidebar\.recovery/);
  assert.match(html, /sidebar\.recoveryEmpty/);
  assert.match(html, /sidebar\.recoverySnapshotCount \{&quot;count&quot;:0\}/);
  assert.match(html, /sidebar\.recoveryPatchCount \{&quot;count&quot;:0\}/);
  assert.match(html, /disabled=""/);
});
