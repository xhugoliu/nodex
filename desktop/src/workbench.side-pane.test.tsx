import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { deriveReturnToNodeContextState } from "./app-helpers";
import { WorkbenchSidePane } from "./components/workbench";
import type {
  ApplyPatchReport,
  DesktopAiStatus,
  DraftReviewPayload,
  NodeWorkspaceContext,
  SourceDetail,
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
      children: [{ id: "node-child-1", title: "Existing child" }],
      sources: [],
      evidence: [],
    },
  };
}

function makeSourceDetail(): SourceDetail {
  return {
    source: {
      id: "source-1",
      original_path: "/fixtures/source.md",
      original_name: "source.md",
      stored_name: "source.md",
      format: "md",
      imported_at: 1710000000,
    },
    chunks: [
      {
        chunk: {
          id: "chunk-1",
          source_id: "source-1",
          ordinal: 0,
          label: "Provider Authentication Flow",
          text: "Anthropic-compatible auth setup and model routing details.",
          start_line: 5,
          end_line: 11,
        },
        linked_nodes: [{ id: "node-linked-1", title: "Provider Setup" }],
        evidence_nodes: [],
        evidence_links: [],
      },
    ],
  };
}

function makeApplyResult(): ApplyPatchReport {
  return {
    run_id: "run-1",
    summary: "Applied patch summary",
    preview: ["Added child node"],
    created_nodes: [{ id: "node-created-1", title: "Follow-up branch" }],
  };
}

function makeDesktopAiStatus(): DesktopAiStatus {
  return {
    command:
      "python3 scripts/provider_runner.py --provider anthropic --use-default-args",
    command_source: "default",
    provider: "anthropic",
    runner: "provider_runner.py",
    model: "claude-sonnet",
    reasoning_effort: null,
    has_auth: true,
    has_process_env_conflict: false,
    has_shell_env_conflict: false,
    uses_provider_defaults: true,
    status_error: null,
  };
}

function makeReviewDraft(): DraftReviewPayload {
  return {
    run: {
      id: "run-1",
      capability: "expand",
      explore_by: null,
      node_id: "node-1",
      command: "python3 scripts/provider_runner.py",
      dry_run: true,
      status: "completed",
      started_at: 1710000000,
      finished_at: 1710000001,
      request_path: "/tmp/request.json",
      response_path: "/tmp/response.json",
      exit_code: 0,
      provider: "anthropic",
      model: "claude-sonnet",
      provider_run_id: null,
      retry_count: 0,
      used_plain_json_fallback: false,
      normalization_notes: [],
      last_error_category: null,
      last_error_message: null,
      last_status_code: null,
      patch_run_id: null,
      patch_summary: "Draft summary",
    },
    explanation: {
      rationale_summary: "Explore the node through one focused angle.",
      direct_evidence: [],
      inferred_suggestions: [],
    },
    response_notes: [],
    patch: {
      version: 1,
      summary: "Draft patch summary",
      ops: [{ type: "add_node", title: "Follow-up branch" }],
    },
    patch_preview: ["Add a focused follow-up branch"],
    report: makeApplyResult(),
  };
}

function renderSidePane(options: {
  selectionTab: "context" | "draft" | "review";
  selectedSourceDetail?: SourceDetail | null;
  applyResult?: ApplyPatchReport | null;
  reviewDraft?: DraftReviewPayload | null;
  aiDraftStatus?: DesktopAiStatus | null;
  aiDraftError?: string | null;
}) {
  return renderToStaticMarkup(
    <WorkbenchSidePane
      aiDraftError={options.aiDraftError ?? null}
      aiDraftStatus={options.aiDraftStatus ?? makeDesktopAiStatus()}
      aiDraftStatusLoading={false}
      applyResult={options.applyResult ?? null}
      nodeContext={makeNodeContext()}
      onApplyPatch={() => {}}
      onBackToNodeContext={() => {}}
      onBodyChange={() => {}}
      onDraftAiExpand={() => {}}
      onDraftAiExplore={() => {}}
      onDraftCiteChunk={() => {}}
      onDraftUnciteChunk={() => {}}
      onDraftUpdate={() => {}}
      onOpenCreatedNode={() => {}}
      onOpenLinkedNode={() => {}}
      onOpenSource={() => {}}
      onPreviewPatch={() => {}}
      onRefreshAiDraftStatus={() => {}}
      onSelectSelectionTab={() => {}}
      onTitleChange={() => {}}
      patchDraftState={{
        state: "ready",
        summary: "Draft patch summary",
        opCount: 1,
        opTypes: [{ type: "add_node", count: 1 }],
        ops: [{ type: "add_node", title: "Follow-up branch" }],
        error: null,
      }}
      reviewDraft={options.reviewDraft ?? makeReviewDraft()}
      selectedSourceChunkId={null}
      selectedSourceDetail={
        options.selectedSourceDetail === undefined
          ? makeSourceDetail()
          : options.selectedSourceDetail
      }
      selectionTab={options.selectionTab}
      t={t}
      updateNodeBody="Current auth routing notes"
      updateNodeTitle="Authentication"
    />
  );
}

test("WorkbenchSidePane keeps Review visible across source-context state when review tab is selected", () => {
  const html = renderSidePane({
    selectionTab: "review",
  });

  assert.match(html, /workbench\.focusScopeTitle/);
  assert.match(html, /workbench\.focusScopeNodeLabel/);
  assert.match(html, /workbench\.focusScopeSourceLabel/);
  assert.match(html, /Authentication/);
  assert.match(html, /source\.md/);
  assert.match(html, /patchEditor\.preview/);
  assert.match(html, /patchEditor\.apply/);
  assert.doesNotMatch(html, /run-1/);
  assert.doesNotMatch(html, /\/tmp\/request\.json/);
  assert.doesNotMatch(html, /\/tmp\/response\.json/);
  assert.doesNotMatch(html, /detail\.sourceContextSummaryTitle/);
  assert.doesNotMatch(html, /workbench\.applyResultTitle/);
});

test("WorkbenchSidePane renders Draft as a node-scoped assistant workspace without switching into review or apply surfaces", () => {
  const html = renderSidePane({
    selectionTab: "draft",
  });

  assert.match(html, /workbench\.focusScopeTitle/);
  assert.match(html, /workbench\.focusScopeNodeLabel/);
  assert.match(html, /workbench\.draftScopeTitle/);
  assert.match(html, /Authentication/);
  assert.match(html, /nodeEditing\.aiDraftRoute/);
  assert.match(html, /nodeEditing\.draftAiExpand/);
  assert.match(html, /detail\.currentDraft/);
  assert.match(html, /workbench\.draftReadyOps \{&quot;count&quot;:1\}/);
  assert.doesNotMatch(html, /source\.md/);
  assert.doesNotMatch(html, /detail\.sourceContextStatCited/);
  assert.doesNotMatch(html, /patchEditor\.preview/);
  assert.doesNotMatch(html, /workbench\.applyResultTitle/);
  assert.doesNotMatch(html, /detail\.sourceContextSummaryTitle/);
  assert.doesNotMatch(html, /workbench\.focusScopeSourceLabel/);
});

test("WorkbenchSidePane returns to source context when the context tab is selected with a source open", () => {
  const html = renderSidePane({
    selectionTab: "context",
  });

  assert.match(html, /workbench\.focusScopeTitle/);
  assert.match(html, /workbench\.focusScopeNodeLabel/);
  assert.match(html, /workbench\.focusScopeSourceLabel/);
  assert.match(html, /Authentication/);
  assert.match(html, /source\.md/);
  assert.match(html, /detail\.sourceContextSummaryTitle/);
  assert.match(html, /Provider Authentication Flow/);
  assert.doesNotMatch(html, /patchEditor\.preview/);
  assert.doesNotMatch(html, /workbench\.applyResultTitle/);
});

test("WorkbenchSidePane falls back to node context apply results when no source detail is selected", () => {
  const html = renderSidePane({
    selectionTab: "context",
    selectedSourceDetail: null,
    applyResult: makeApplyResult(),
  });

  assert.match(html, /workbench\.focusScopeTitle/);
  assert.match(html, /workbench\.focusScopeNodeLabel/);
  assert.match(html, /Authentication/);
  assert.match(html, /workbench\.applyResultTitle/);
  assert.match(html, /Applied patch summary/);
  assert.doesNotMatch(html, /detail\.sourceContextSummaryTitle/);
  assert.doesNotMatch(html, /patchEditor\.preview/);
  assert.doesNotMatch(html, /workbench\.focusScopeSourceLabel/);
});

test("source-detail handoff clears stale review/apply state before node context renders", () => {
  const nextState = deriveReturnToNodeContextState({
    currentSelection: { nodeId: "node-1", sourceId: "source-1" },
    currentSelectionPanelTab: "review",
    patchEditor: "{\"summary\":\"Draft patch summary\"}",
    patchDraftOrigin: { kind: "manual" },
    reviewDraft: makeReviewDraft(),
    applyResult: makeApplyResult(),
  });

  const html = renderSidePane({
    selectionTab: nextState.nextSelectionPanelTab,
    selectedSourceDetail: nextState.nextSelectedSourceDetail,
    applyResult: nextState.nextApplyResult,
    reviewDraft: nextState.nextReviewDraft,
  });

  assert.equal(nextState.shouldClearTransientReviewState, true);
  assert.doesNotMatch(html, /detail\.sourceContextSummaryTitle/);
  assert.doesNotMatch(html, /workbench\.applyResultTitle/);
  assert.doesNotMatch(html, /patchEditor\.preview/);
  assert.match(html, /Authentication/);
});
