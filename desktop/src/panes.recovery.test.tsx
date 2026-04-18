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
        id: "snapshot-1",
        label: "Before apply",
        file_name: "snapshot-1.json",
        created_at: 1710000100,
      },
      {
        id: "snapshot-2",
        label: null,
        file_name: "snapshot-2.json",
        created_at: 1710000200,
      },
    ],
    patch_history: [
      {
        id: "patch-1",
        summary: "Attach source evidence",
        origin: "manual",
        file_name: "patch-1.json",
        applied_at: 1710000300,
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

test("TreePane renders a lightweight recovery card with latest snapshot and patch summary", () => {
  const html = renderTreePane(makeOverview());

  assert.match(html, /sidebar\.recovery/);
  assert.match(html, /sidebar\.recoverySnapshotCount \{&quot;count&quot;:2\}/);
  assert.match(html, /sidebar\.recoveryPatchCount \{&quot;count&quot;:1\}/);
  assert.match(html, /sidebar\.restoreLatestSnapshot/);
  assert.match(html, /Before apply|snapshot-2/);
  assert.match(html, /Attach source evidence/);
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
