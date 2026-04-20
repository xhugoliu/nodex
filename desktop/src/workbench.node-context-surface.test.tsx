import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { NodeContextSurface } from "./components/workbench";
import type {
  ApplyPatchReport,
  NodeWorkspaceContext,
} from "./types";

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

function makeNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "node-1",
        parent_id: "root",
        title: "Authentication",
        body: "Current auth routing notes",
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "root", title: "Root" },
      children: [
        { id: "node-child-1", title: "Existing child" },
      ],
      sources: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [],
        },
      ],
      evidence: [],
    },
  };
}

function makeApplyResult(overrides: Partial<ApplyPatchReport>): ApplyPatchReport {
  return {
    run_id: "run-1",
    summary: "Applied patch summary",
    preview: [
      "Added child node",
      "Attached source",
      "Updated summary",
      "Recorded metadata",
    ],
    created_nodes: [
      { id: "node-1", title: "Current focus node" },
      { id: "node-created-2", title: "Follow-up branch" },
    ],
    ...overrides,
  };
}

function renderSurface(options: {
  applyResult?: ApplyPatchReport | null;
  nodeContext?: NodeWorkspaceContext | null;
}) {
  return renderToStaticMarkup(
    <NodeContextSurface
      applyResult={options.applyResult ?? null}
      nodeContext={options.nodeContext ?? makeNodeContext()}
      onBodyChange={() => {}}
      onOpenDraft={() => {}}
      onDraftUpdate={() => {}}
      onOpenCreatedNode={() => {}}
      onOpenSource={() => {}}
      onTitleChange={() => {}}
      t={t}
      updateNodeBody="Current auth routing notes"
      updateNodeTitle="Authentication"
    />,
  );
}

test("NodeContextSurface renders apply result summary, created nodes, and focus on newly created node", () => {
  const html = renderSurface({
    applyResult: makeApplyResult({}),
  });

  assert.match(html, /workbench\.applyResultTitle/);
  assert.match(html, /Applied patch summary/);
  assert.match(html, /Added child node/);
  assert.match(html, /Attached source/);
  assert.match(html, /workbench\.applyResultMoreChanges \{&quot;count&quot;:1\}/);
  assert.match(html, /Follow-up branch/);
  assert.doesNotMatch(html, /Current focus node/);
  assert.match(html, /workbench\.applyResultFocusNewNode/);
  assert.match(html, /workbench\.applyResultNextCreated/);
});

test("NodeContextSurface hides duplicate created-node quick actions when the current focus is the only newly created node", () => {
  const html = renderSurface({
    applyResult: makeApplyResult({
      created_nodes: [{ id: "node-1", title: "Current focus node" }],
    }),
  });

  assert.doesNotMatch(html, /workbench\.applyResultCreatedNodesLabel/);
  assert.match(html, /workbench\.applyResultFocusNewNode/);
  assert.match(html, /workbench\.applyResultNextCreated/);
});

test("NodeContextSurface falls back to current-node focus and source-guided next step without created nodes", () => {
  const html = renderSurface({
    applyResult: makeApplyResult({
      created_nodes: [],
      preview: ["Updated node body"],
    }),
  });

  assert.match(html, /workbench\.applyResultFocusCurrentNode/);
  assert.match(html, /workbench\.applyResultNextWithSources/);
  assert.doesNotMatch(html, /workbench\.applyResultCreatedNodesLabel/);
});

test("NodeContextSurface shows the next step into Draft", () => {
  const html = renderSurface({});

  assert.match(html, /workbench\.contextNextTitle/);
  assert.match(html, /workbench\.contextNextNodeDraft/);
  assert.match(html, /workbench\.openDraft/);
});

test("NodeContextSurface keeps local provenance visible on source cards", () => {
  const html = renderSurface({});

  assert.match(html, /workbench\.sourcesTitle/);
  assert.match(html, /workbench\.sourcesBody/);
  assert.match(html, /detail\.sourcesSection/);
  assert.match(html, /sourceImport\.pathLabel/);
  assert.match(html, /\/fixtures\/source\.md/);
  assert.match(html, /detail\.importedAt/);
});
