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
  PatchDraftOrigin,
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

function makeNodeContextWithEvidence(): NodeWorkspaceContext {
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
        updated_at: 1710000001,
      },
      parent: { id: "root", title: "Root" },
      children: [{ id: "node-child-1", title: "Existing child" }],
      sources: [],
      evidence: [
        {
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
              id: "chunk-1",
              source_id: "source-1",
              ordinal: 0,
              label: "Provider Authentication Flow",
              text: "OpenAI-compatible auth setup and model routing details.",
              start_line: 5,
              end_line: 11,
            },
          ],
          citations: [
            {
              chunk: {
                id: "chunk-1",
                source_id: "source-1",
                ordinal: 0,
                label: "Provider Authentication Flow",
                text: "OpenAI-compatible auth setup and model routing details.",
                start_line: 5,
                end_line: 11,
              },
              citation_kind: "direct",
              rationale:
                "This section explains why the current node should reuse the default auth route.",
            },
          ],
        },
      ],
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
          text: "OpenAI-compatible auth setup and model routing details.",
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
      "python3 scripts/provider_runner.py --provider openai --use-default-args",
    command_source: "default",
    provider: "openai",
    runner: "provider_runner.py",
    model: "gpt-5.4-mini",
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

function makeDirectEvidenceReviewDraft(): DraftReviewPayload {
  return {
    ...makeReviewDraft(),
    explanation: {
      rationale_summary: "Use this source-backed citation patch to preserve the current auth evidence.",
      direct_evidence: [
        {
          source_id: "source-1",
          source_name: "source.md",
          chunk_id: "chunk-1",
          label: "Provider Authentication Flow",
          start_line: 5,
          end_line: 11,
          why_it_matters: "This chunk directly supports the citation patch.",
        },
      ],
      inferred_suggestions: [],
    },
    patch: {
      version: 1,
      summary: "Draft citation summary",
      ops: [
        {
          type: "cite_source_chunk",
          chunk_id: "chunk-1",
          node_id: "node-1",
          citation_kind: "direct",
          rationale:
            "This section explains why the current node should reuse the default auth route.",
        },
      ],
    },
  };
}

function makeDirectEvidenceReviewDraftWithoutCitationRationale(): DraftReviewPayload {
  const draft = makeDirectEvidenceReviewDraft();
  return {
    ...draft,
    patch: {
      ...draft.patch,
      ops: draft.patch.ops.map((op) =>
        op.type === "cite_source_chunk"
          ? {
              type: "cite_source_chunk",
              chunk_id: op.chunk_id,
              node_id: op.node_id,
              citation_kind: op.citation_kind,
            }
          : op,
      ),
    },
  };
}

function renderSidePane(options: {
  selectionTab: "context" | "draft" | "review";
  nodeContext?: NodeWorkspaceContext | null;
  selectedSourceDetail?: SourceDetail | null;
  applyResult?: ApplyPatchReport | null;
  reviewDraft?: DraftReviewPayload | null;
  aiDraftStatus?: DesktopAiStatus | null;
  aiDraftError?: string | null;
  patchDraftOrigin?: PatchDraftOrigin | null;
  patchDraftState?: {
    state: "ready";
    summary: string | null;
    opCount: number;
    opTypes: Array<{ type: string; count: number }>;
    ops: Array<Record<string, unknown> & { type: string; title?: string; id?: string }>;
    error: null;
  };
}) {
  return renderToStaticMarkup(
    <WorkbenchSidePane
      aiDraftError={options.aiDraftError ?? null}
      aiDraftStatus={options.aiDraftStatus ?? makeDesktopAiStatus()}
      aiDraftStatusLoading={false}
      applyResult={options.applyResult ?? null}
      nodeContext={options.nodeContext === undefined ? makeNodeContext() : options.nodeContext}
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
      patchDraftOrigin={options.patchDraftOrigin ?? null}
      patchDraftState={
        options.patchDraftState ?? {
          state: "ready",
          summary: "Draft patch summary",
          opCount: 1,
          opTypes: [{ type: "add_node", count: 1 }],
          ops: [{ type: "add_node", title: "Follow-up branch" }],
          error: null,
        }
      }
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
  assert.match(html, /detail\.currentDraft/);
  assert.match(html, /workbench\.draftReadyOps \{&quot;count&quot;:1\}/);
  assert.match(
    html,
    /workbench\.reviewFocusNewNode \{&quot;title&quot;:&quot;Follow-up branch&quot;\}/,
  );
  assert.match(html, /workbench\.reviewImpactTitle/);
  assert.match(html, /workbench\.reviewImpactAddNode \{&quot;count&quot;:1\}/);
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
  assert.match(html, /workbench\.defaultRoute/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftRouteMeta/);
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

test("WorkbenchSidePane Draft reuses contextualized source-backed op descriptions instead of raw ids", () => {
  const html = renderSidePane({
    selectionTab: "draft",
    nodeContext: makeNodeContextWithEvidence(),
    selectedSourceDetail: null,
    patchDraftState: {
      state: "ready",
      summary: "Source-backed draft summary",
      opCount: 2,
      opTypes: [
        { type: "attach_source", count: 1 },
        { type: "cite_source_chunk", count: 1 },
      ],
      ops: [
        { type: "attach_source", source_id: "source-1", node_id: "node-1" },
        {
          type: "cite_source_chunk",
          chunk_id: "chunk-1",
          node_id: "node-1",
          citation_kind: "direct",
        },
      ],
      error: null,
    },
    reviewDraft: null,
  });

  assert.match(html, /source\.md/);
  assert.match(html, /Provider Authentication Flow/);
  assert.match(html, /Authentication/);
  assert.doesNotMatch(html, /source-1/);
  assert.doesNotMatch(html, /chunk-1/);
  assert.doesNotMatch(html, /node-1/);
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

test("WorkbenchSidePane Review falls back to the current node when the draft does not create a new branch", () => {
  const html = renderSidePane({
    selectionTab: "review",
    patchDraftState: {
      state: "ready",
      summary: "Update draft summary",
      opCount: 1,
      opTypes: [{ type: "update_node", count: 1 }],
      ops: [
        {
          type: "update_node",
          id: "node-1",
          title: "Authentication Updated",
          body: "Current auth routing notes with one local revision",
        },
      ],
      error: null,
    },
    reviewDraft: {
      ...makeReviewDraft(),
      patch: {
        version: 1,
        summary: "Update draft summary",
        ops: [
          {
            type: "update_node",
            id: "node-1",
            title: "Authentication Updated",
            body: "Current auth routing notes with one local revision",
          },
        ],
      },
    },
  });

  assert.match(
    html,
    /workbench\.reviewFocusCurrentNode \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(html, /workbench\.reviewImpactUpdateNode \{&quot;count&quot;:1\}/);
  assert.match(html, /workbench\.reviewAffectedNodesTitle/);
  assert.match(html, /workbench\.reviewAffectedNodeUpdate/);
  assert.match(
    html,
    /workbench\.reviewAffectedFields \{&quot;fields&quot;:&quot;fields\.title, fields\.body&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewAffectedNextTitle \{&quot;title&quot;:&quot;Authentication Updated&quot;\}/,
  );
});

test("WorkbenchSidePane Review explains parent scope for add-node drafts", () => {
  const html = renderSidePane({
    selectionTab: "review",
    patchDraftOrigin: {
      kind: "manual",
      action: "add_child",
    },
    patchDraftState: {
      state: "ready",
      summary: "Add child draft summary",
      opCount: 1,
      opTypes: [{ type: "add_node", count: 1 }],
      ops: [
        {
          type: "add_node",
          title: "Authentication Child",
          parent_id: "node-1",
        },
      ],
      error: null,
    },
    reviewDraft: null,
  });

  assert.match(html, /workbench\.reviewAffectedNodesTitle/);
  assert.match(html, /workbench\.reviewAffectedNodeAdd/);
  assert.match(
    html,
    /workbench\.reviewAffectedParent \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
});

test("WorkbenchSidePane Review surfaces evidence-oriented impact summary when the draft changes citations", () => {
  const html = renderSidePane({
    selectionTab: "review",
    patchDraftState: {
      state: "ready",
      summary: "Draft citation summary",
      opCount: 1,
      opTypes: [{ type: "cite_source_chunk", count: 1 }],
      ops: [
        {
          type: "cite_source_chunk",
          chunk_id: "chunk-1",
          node_id: "node-1",
          citation_kind: "direct",
          rationale:
            "This section explains why the current node should reuse the default auth route.",
        },
      ],
      error: null,
    },
    reviewDraft: makeDirectEvidenceReviewDraft(),
  });

  assert.match(html, /workbench\.reviewImpactCiteSourceChunk \{&quot;count&quot;:1\}/);
  assert.match(html, /workbench\.reviewEvidenceCount \{&quot;count&quot;:1\}/);
  assert.match(html, /workbench\.reviewSourceFocusTitle/);
  assert.equal((html.match(/workbench\.reviewAffectedSourceCite/g) ?? []).length, 2);
  assert.match(
    html,
    /workbench\.reviewSourceFocusNode \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewSourceFocusSource \{&quot;title&quot;:&quot;source\.md&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewSourceFocusChunk \{&quot;title&quot;:&quot;Provider Authentication Flow&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewSourceFocusCitation \{&quot;kind&quot;:&quot;detail\.citationKindDirect&quot;\}/,
  );
  assert.match(html, /workbench\.reviewAffectedSourceTitle/);
  assert.match(
    html,
    /workbench\.reviewAffectedSourceNode \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(html, /detail\.citationKindDirect/);
  assert.match(
    html,
    /reports\.rationale \{&quot;value&quot;:&quot;This section explains why the current node should reuse the default auth route\.&quot;\}/,
  );
  assert.match(html, /source\.md/);
  assert.match(html, /Provider Authentication Flow/);
  assert.match(
    html,
    /detail\.chunkMeta \{&quot;ordinal&quot;:1,&quot;start&quot;:5,&quot;end&quot;:11\}/,
  );
  assert.match(
    html,
    /composer\.opCiteSourceChunkWithRationale \{&quot;chunk&quot;:&quot;Provider Authentication Flow&quot;,&quot;node&quot;:&quot;Authentication&quot;,&quot;citationKind&quot;:&quot;detail\.citationKindDirect&quot;,&quot;rationale&quot;:&quot;This section explains why the current node should reuse the default auth route\.&quot;\}/,
  );
});

test("WorkbenchSidePane Review surfaces source-backed focus cues for source removal drafts", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContextWithEvidence(),
    selectedSourceDetail: null,
    patchDraftOrigin: {
      kind: "patch_history",
      run_id: "patch-2",
      origin: "manual",
    },
    patchDraftState: {
      state: "ready",
      summary: "Loaded source removal patch from history",
      opCount: 3,
      opTypes: [
        { type: "uncite_source_chunk", count: 1 },
        { type: "detach_source_chunk", count: 1 },
        { type: "detach_source", count: 1 },
      ],
      ops: [
        { type: "uncite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" },
        { type: "detach_source_chunk", chunk_id: "chunk-1", node_id: "node-1" },
        { type: "detach_source", source_id: "source-1", node_id: "node-1" },
      ],
      error: null,
    },
    reviewDraft: null,
  });

  assert.match(html, /workbench\.reviewSourceFocusTitle/);
  assert.match(
    html,
    /workbench\.reviewSourceFocusNode \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewSourceFocusSource \{&quot;title&quot;:&quot;source\.md&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewSourceFocusChunk \{&quot;title&quot;:&quot;Provider Authentication Flow&quot;\}/,
  );
  assert.match(
    html,
    /workbench\.reviewSourceFocusCitation \{&quot;kind&quot;:&quot;detail\.citationKindDirect&quot;\}/,
  );
  assert.equal((html.match(/workbench\.reviewAffectedSourceUncite/g) ?? []).length, 2);
  assert.equal((html.match(/workbench\.reviewAffectedSourceDetachChunk/g) ?? []).length, 2);
  assert.equal((html.match(/workbench\.reviewAffectedSourceDetachSource/g) ?? []).length, 2);
  assert.equal((html.match(/workbench\.reviewHistoryOriginTitle/g) ?? []).length, 2);
  assert.match(html, /workbench\.reviewImpactUnciteSourceChunk \{&quot;count&quot;:1\}/);
  assert.match(html, /workbench\.reviewImpactDetachSourceChunk \{&quot;count&quot;:1\}/);
  assert.match(html, /workbench\.reviewImpactDetachSource \{&quot;count&quot;:1\}/);
});

test("WorkbenchSidePane Review keeps source and source-chunk ops humanized beyond cite and uncite", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContextWithEvidence(),
    selectedSourceDetail: null,
    patchDraftState: {
      state: "ready",
      summary: "Refresh source links",
      opCount: 2,
      opTypes: [
        { type: "attach_source", count: 1 },
        { type: "attach_source_chunk", count: 1 },
      ],
      ops: [
        { type: "attach_source", source_id: "source-1", node_id: "node-1" },
        { type: "attach_source_chunk", chunk_id: "chunk-1", node_id: "node-1" },
      ],
      error: null,
    },
    reviewDraft: null,
  });

  assert.match(html, /workbench\.reviewAffectedSourceTitle/);
  assert.equal((html.match(/workbench\.reviewAffectedSourceAttachSource/g) ?? []).length, 2);
  assert.equal((html.match(/workbench\.reviewAffectedSourceAttachChunk/g) ?? []).length, 2);
  assert.match(
    html,
    /workbench\.reviewAffectedSourceNode \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(html, /source\.md/);
  assert.match(html, /Provider Authentication Flow/);
  assert.match(
    html,
    /composer\.opAttachSource \{&quot;source&quot;:&quot;source\.md&quot;,&quot;node&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(
    html,
    /composer\.opAttachSourceChunk \{&quot;chunk&quot;:&quot;Provider Authentication Flow&quot;,&quot;node&quot;:&quot;Authentication&quot;\}/,
  );
  assert.doesNotMatch(html, /source-1/);
  assert.doesNotMatch(html, /chunk-1/);
  assert.doesNotMatch(html, /node-1/);
});

test("WorkbenchSidePane Review deduplicates repeated source-action focus cues", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContext(),
    selectedSourceDetail: makeSourceDetail(),
    patchDraftState: {
      state: "ready",
      summary: "Repeat cite same chunk",
      opCount: 2,
      opTypes: [{ type: "cite_source_chunk", count: 2 }],
      ops: [
        { type: "cite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" },
        { type: "cite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" },
      ],
      error: null,
    },
    reviewDraft: null,
  });

  assert.equal((html.match(/workbench\.reviewAffectedSourceCite/g) ?? []).length, 2);
});

test("WorkbenchSidePane Review keeps patch-history provenance visible for recovery-loaded drafts", () => {
  const html = renderSidePane({
    selectionTab: "review",
    patchDraftOrigin: {
      kind: "patch_history",
      run_id: "patch-2",
      origin: "manual",
    },
    patchDraftState: {
      state: "ready",
      summary: "Loaded patch from history",
      opCount: 1,
      opTypes: [{ type: "update_node", count: 1 }],
      ops: [{ type: "update_node", id: "node-1", body: "Recovered wording" }],
      error: null,
    },
    reviewDraft: null,
  });

  assert.equal((html.match(/workbench\.reviewHistoryOriginTitle/g) ?? []).length, 1);
  assert.doesNotMatch(html, /workbench\.reviewAffectedSourceAttachSource/);
  assert.doesNotMatch(html, /workbench\.reviewAffectedSourceAttachChunk/);
  assert.doesNotMatch(html, /workbench\.reviewAffectedSourceCite/);
  assert.doesNotMatch(html, /workbench\.reviewAffectedSourceUncite/);
  assert.match(html, /workbench\.reviewHistoryOriginTitle/);
  assert.match(
    html,
    /workbench\.reviewHistoryOriginBody \{&quot;runId&quot;:&quot;patch-2&quot;,&quot;origin&quot;:&quot;manual&quot;\}/,
  );
  assert.match(html, /workbench\.reviewAffectedNodesTitle/);
  assert.match(html, /workbench\.reviewAffectedNodeUpdate/);
  assert.match(
    html,
    /workbench\.reviewAffectedFields \{&quot;fields&quot;:&quot;fields\.body&quot;\}/,
  );
  assert.match(
    html,
    /composer\.opUpdateNodeFields \{&quot;node&quot;:&quot;Authentication&quot;,&quot;fields&quot;:&quot;fields\.body&quot;\}/,
  );
});

test("WorkbenchSidePane Review keeps AI draft provenance visible when the draft came from an AI run", () => {
  const html = renderSidePane({
    selectionTab: "review",
    patchDraftOrigin: {
      kind: "ai_run",
      run_id: "run-1",
      capability: "expand",
      explore_by: null,
      provider: "anthropic",
      model: "claude-sonnet",
      patch_run_id: null,
    },
  });

  assert.equal(
    (html.match(/composer\.aiRunOriginTitle \{&quot;id&quot;:&quot;run-1&quot;\}/g) ?? [])
      .length,
    1,
  );
  assert.match(html, /composer\.aiRunOriginTitle \{&quot;id&quot;:&quot;run-1&quot;\}/);
  assert.match(html, /reports\.capability \{&quot;value&quot;:&quot;expand&quot;\}/);
  assert.match(html, /reports\.provider \{&quot;value&quot;:&quot;anthropic&quot;\}/);
  assert.match(html, /reports\.model \{&quot;value&quot;:&quot;claude-sonnet&quot;\}/);
});

test("WorkbenchSidePane Review does not promote AI provenance into the top summary for source-backed drafts", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContextWithEvidence(),
    patchDraftOrigin: {
      kind: "ai_run",
      run_id: "run-1",
      capability: "expand",
      explore_by: null,
      provider: "anthropic",
      model: "claude-sonnet",
      patch_run_id: null,
    },
    patchDraftState: {
      state: "ready",
      summary: "AI source-backed draft",
      opCount: 1,
      opTypes: [{ type: "cite_source_chunk", count: 1 }],
      ops: [{ type: "cite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" }],
      error: null,
    },
    reviewDraft: null,
  });

  assert.equal(
    (html.match(/composer\.aiRunOriginTitle \{&quot;id&quot;:&quot;run-1&quot;\}/g) ?? [])
      .length,
    1,
  );
  assert.match(html, /workbench\.reviewSourceFocusTitle/);
  assert.match(
    html,
    /workbench\.reviewSourceFocusChunk \{&quot;title&quot;:&quot;Provider Authentication Flow&quot;\}/,
  );
});

test("WorkbenchSidePane Review does not promote manual provenance into the top summary for source-backed drafts", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContextWithEvidence(),
    patchDraftOrigin: {
      kind: "manual",
      action: "uncite_source_chunk",
    },
    patchDraftState: {
      state: "ready",
      summary: "Manual source-backed draft",
      opCount: 1,
      opTypes: [{ type: "uncite_source_chunk", count: 1 }],
      ops: [{ type: "uncite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" }],
      error: null,
    },
    reviewDraft: null,
  });

  assert.equal((html.match(/workbench\.reviewManualOriginTitle/g) ?? []).length, 1);
  assert.match(html, /workbench\.reviewSourceFocusTitle/);
  assert.match(
    html,
    /workbench\.reviewSourceFocusCitation \{&quot;kind&quot;:&quot;detail\.citationKindDirect&quot;\}/,
  );
});

test("WorkbenchSidePane Review keeps manual draft provenance visible for node edits", () => {

  const html = renderSidePane({
    selectionTab: "review",
    patchDraftOrigin: {
      kind: "manual",
      action: "update_node",
    },
  });

  assert.equal((html.match(/workbench\.reviewManualOriginTitle/g) ?? []).length, 1);
  assert.match(html, /workbench\.reviewManualOriginTitle/);
  assert.match(html, /workbench\.reviewManualOriginUpdateNode/);
});

test("WorkbenchSidePane Review keeps affected source context visible for uncite drafts", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContextWithEvidence(),
    patchDraftOrigin: {
      kind: "manual",
      action: "uncite_source_chunk",
    },
    patchDraftState: {
      state: "ready",
      summary: "Remove cited chunk",
      opCount: 1,
      opTypes: [{ type: "uncite_source_chunk", count: 1 }],
      ops: [{ type: "uncite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" }],
      error: null,
    },
    reviewDraft: null,
  });

  assert.match(html, /workbench\.reviewAffectedSourceTitle/);
  assert.match(html, /workbench\.reviewAffectedSourceUncite/);
  assert.match(
    html,
    /workbench\.reviewAffectedSourceNode \{&quot;title&quot;:&quot;Authentication&quot;\}/,
  );
  assert.match(html, /detail\.citationKindDirect/);
  assert.match(
    html,
    /reports\.rationale \{&quot;value&quot;:&quot;This section explains why the current node should reuse the default auth route\.&quot;\}/,
  );
  assert.match(html, /source\.md/);
  assert.match(html, /Provider Authentication Flow/);
  assert.match(
    html,
    /composer\.opUnciteSourceChunk \{&quot;chunk&quot;:&quot;Provider Authentication Flow&quot;,&quot;node&quot;:&quot;Authentication&quot;\}/,
  );
});

test("WorkbenchSidePane Review falls back to direct evidence why-it-matters for source-backed drafts without rationale", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContext(),
    selectedSourceDetail: makeSourceDetail(),
    patchDraftState: {
      state: "ready",
      summary: "Cite source-backed chunk",
      opCount: 1,
      opTypes: [{ type: "cite_source_chunk", count: 1 }],
      ops: [{ type: "cite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" }],
      error: null,
    },
    reviewDraft: makeDirectEvidenceReviewDraftWithoutCitationRationale(),
  });

  assert.match(html, /workbench\.reviewAffectedSourceTitle/);
  assert.match(html, /workbench\.reviewAffectedSourceCite/);
  assert.match(
    html,
    /reports\.rationale \{&quot;value&quot;:&quot;This chunk directly supports the citation patch\.&quot;\}/,
  );
  assert.match(html, /source\.md/);
  assert.match(html, /Provider Authentication Flow/);
  assert.doesNotMatch(html, /source-1/);
  assert.doesNotMatch(html, /chunk-1/);
  assert.doesNotMatch(html, /node-1/);
});

test("WorkbenchSidePane Review keeps stored citation rationale ahead of direct-evidence fallback", () => {
  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContextWithEvidence(),
    patchDraftState: {
      state: "ready",
      summary: "Remove cited chunk",
      opCount: 1,
      opTypes: [{ type: "uncite_source_chunk", count: 1 }],
      ops: [{ type: "uncite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" }],
      error: null,
    },
    reviewDraft: makeDirectEvidenceReviewDraftWithoutCitationRationale(),
  });

  assert.match(
    html,
    /reports\.rationale \{&quot;value&quot;:&quot;This section explains why the current node should reuse the default auth route\.&quot;\}/,
  );
});

test("WorkbenchSidePane Review ignores unmatched direct-evidence fallback entries", () => {
  const reviewDraft = makeDirectEvidenceReviewDraftWithoutCitationRationale();
  reviewDraft.explanation.direct_evidence = reviewDraft.explanation.direct_evidence.map((item) => ({
    ...item,
    chunk_id: "chunk-unmatched",
  }));

  const html = renderSidePane({
    selectionTab: "review",
    nodeContext: makeNodeContext(),
    selectedSourceDetail: makeSourceDetail(),
    patchDraftState: {
      state: "ready",
      summary: "Cite source-backed chunk",
      opCount: 1,
      opTypes: [{ type: "cite_source_chunk", count: 1 }],
      ops: [{ type: "cite_source_chunk", chunk_id: "chunk-1", node_id: "node-1" }],
      error: null,
    },
    reviewDraft,
  });

  assert.doesNotMatch(
    html,
    /reports\.rationale \{&quot;value&quot;:&quot;This chunk directly supports the citation patch\.&quot;\}/,
  );
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
