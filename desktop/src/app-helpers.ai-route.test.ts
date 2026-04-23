import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveApplyFocusDecision,
  describePatchOperation,
  deriveClearedDraftReviewState,
  deriveClearedTransientReviewState,
  deriveContextSelectionDecision,
  deriveContextTransitionState,
  buildAiDraftNextSteps,
  deriveOpenDraftWorkspaceState,
  deriveOverviewFocusDecision,
  deriveReturnToNodeContextState,
  renderAiDraftFailure,
  resolveOverviewFocusNodeId,
  shouldClearTransientReviewState,
  type Translator,
} from "./app-helpers";
import type { DesktopAiStatus, TreeNode } from "./types";

const t: Translator = (key, vars) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

function makeStatus(overrides: Partial<DesktopAiStatus>): DesktopAiStatus {
  return {
    command: "python3 scripts/provider_runner.py --provider openai --use-default-args",
    command_source: "default",
    provider: "openai",
    runner: "provider_runner.py",
    model: null,
    reasoning_effort: null,
    has_auth: true,
    has_process_env_conflict: false,
    has_shell_env_conflict: false,
    uses_provider_defaults: true,
    status_error: null,
    ...overrides,
  };
}

function makeTree(): TreeNode {
  return {
    node: {
      id: "root",
      parent_id: null,
      title: "Root",
      body: null,
      kind: "topic",
      position: 0,
      created_at: 0,
      updated_at: 0,
    },
    children: [
      {
        node: {
          id: "child-1",
          parent_id: "root",
          title: "Child 1",
          body: null,
          kind: "note",
          position: 0,
          created_at: 0,
          updated_at: 0,
        },
        children: [],
      },
    ],
  };
}

function makeFocusContext(nodeId: string) {
  return {
    node_detail: {
      node: {
        id: nodeId,
      },
    },
  };
}

test("buildAiDraftNextSteps suggests auth setup when auth is missing", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      provider: "openai",
      has_auth: false,
    }),
    t,
  );

  assert.ok(
    steps.some((step) => step.startsWith("messages.aiDraftNextSetupAuth")),
  );
});

test("buildAiDraftNextSteps flags custom override for unknown command route", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      command: "python3 scripts/custom_runner.py",
      command_source: "override",
      provider: null,
      runner: "custom",
      uses_provider_defaults: false,
      status_error:
        "Desktop AI runner override uses an unknown command. Set NODEX_DESKTOP_AI_COMMAND to a known provider runner route.",
    }),
    t,
  );

  assert.ok(
    steps.includes("messages.aiDraftNextCustomOverride"),
    "custom override action should be included for unknown override commands",
  );
});

test("rate limit status error maps to retry guidance and is rendered in failure output", () => {
  const status = makeStatus({
    status_error: "[rate_limit] too many requests",
  });
  const steps = buildAiDraftNextSteps(status, t);

  assert.ok(steps.includes("messages.aiDraftNextRateLimit"));

  const message = renderAiDraftFailure(new Error("request failed"), status, t);
  assert.match(message, /nodeEditing\.aiDraftNextTitle/);
  assert.match(message, /messages\.aiDraftNextRateLimit/);
});

test("buildAiDraftNextSteps can infer timeout guidance even when desktop status is unavailable", () => {
  const steps = buildAiDraftNextSteps(
    null,
    t,
    new Error("[timeout] request exceeded local timeout"),
  );

  assert.ok(steps.includes("messages.aiDraftNextNetwork"));

  const message = renderAiDraftFailure(
    new Error("[timeout] request exceeded local timeout"),
    null,
    t,
  );
  assert.match(message, /nodeEditing\.aiDraftNextTitle/);
  assert.match(message, /messages\.aiDraftNextNetwork/);
});

test("buildAiDraftNextSteps surfaces auth-check guidance for explicit auth failures", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      has_auth: true,
    }),
    t,
    new Error("[auth] HTTP 401: invalid api key"),
  );

  assert.ok(steps.includes("messages.aiDraftNextCheckAuth"));
});

test("buildAiDraftNextSteps treats bracketed quota failures as the primary classifier", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      status_error: "[quota] HTTP 429: Insufficient balance while the provider still reports rate limit hints",
    }),
    t,
  );

  assert.ok(steps.includes("messages.aiDraftNextQuota"));
  assert.ok(!steps.includes("messages.aiDraftNextRateLimit"));
});

test("buildAiDraftNextSteps treats bracketed permission failures as the primary classifier", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      status_error: "[permission] HTTP 403: Access denied",
    }),
    t,
  );

  assert.ok(steps.includes("messages.aiDraftNextPermission"));
});

test("buildAiDraftNextSteps treats bracketed invalid-request failures as the primary classifier", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      status_error:
        "[invalid_request] HTTP 400: Request contract contains incompatible fields",
    }),
    t,
  );

  assert.ok(steps.includes("messages.aiDraftNextInvalidRequest"));
});

test("buildAiDraftNextSteps treats bracketed refusal failures as the primary classifier", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      status_error: "[refusal] model refused the request: safety policy refusal",
    }),
    t,
  );

  assert.ok(steps.includes("messages.aiDraftNextRefusal"));
});

test("buildAiDraftNextSteps treats bracketed runner errors as the primary classifier", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      status_error: "[runner_error] codex runner exited unexpectedly",
    }),
    t,
  );

  assert.ok(steps.includes("messages.aiDraftNextRunnerError"));
});

test("renderAiDraftFailure surfaces the new bracketed-category guidance", () => {
  const message = renderAiDraftFailure(
    new Error("[permission] HTTP 403: Access denied"),
    makeStatus({}),
    t,
  );

  assert.match(message, /nodeEditing\.aiDraftNextTitle/);
  assert.match(message, /messages\.aiDraftNextPermission/);
});

test("describePatchOperation treats cite_source_chunk as direct evidence by default", () => {
  const description = describePatchOperation(
    {
      type: "cite_source_chunk",
      chunk_id: "chunk-1",
      node_id: "node-1",
    },
    t,
  );

  assert.equal(
    description,
    'composer.opCiteSourceChunkAs {"chunk":"chunk-1","node":"node-1","citationKind":"detail.citationKindDirect"}',
  );
});

test("describePatchOperation keeps cite rationale visible when present", () => {
  const description = describePatchOperation(
    {
      type: "cite_source_chunk",
      chunk_id: "chunk-1",
      node_id: "node-1",
      citation_kind: "inferred",
      rationale: "This section still matters.",
    },
    t,
  );

  assert.equal(
    description,
    'composer.opCiteSourceChunkWithRationale {"chunk":"chunk-1","node":"node-1","citationKind":"detail.citationKindInferred","rationale":"This section still matters."}',
  );
});

test("source import with preferred node hit resolves focus and clears transient review state", () => {
  const decision = deriveOverviewFocusDecision(
    makeTree(),
    { nodeId: "root", sourceId: null },
    "child-1",
  );

  assert.equal(decision.nextNodeId, "child-1");
  assert.equal(decision.shouldClearTransientReviewState, true);
});

test("deriveApplyFocusDecision reuses provided focus context when it matches the preferred focus node", () => {
  const focusContext = makeFocusContext("generated-node");
  const decision = deriveApplyFocusDecision({
    preferredFocusNodeId: "generated-node",
    focusNodeContext: focusContext,
    currentNodeId: "node-a",
  });

  assert.equal(decision.nextNodeId, "generated-node");
  assert.equal(decision.nextNodeContext, focusContext);
});

test("deriveApplyFocusDecision keeps the preferred focus node but drops stale provided context when ids diverge", () => {
  const decision = deriveApplyFocusDecision({
    preferredFocusNodeId: "child-node",
    focusNodeContext: makeFocusContext("generated-node"),
    currentNodeId: "node-a",
  });

  assert.equal(decision.nextNodeId, "child-node");
  assert.equal(decision.nextNodeContext, null);
});

test("deriveApplyFocusDecision falls back to the current node when apply output does not provide focus hints", () => {
  const decision = deriveApplyFocusDecision({
    preferredFocusNodeId: null,
    focusNodeContext: null,
    currentNodeId: "node-a",
  });

  assert.equal(decision.nextNodeId, "node-a");
  assert.equal(decision.nextNodeContext, null);
});

test("same-node overview refresh keeps transient review state", () => {
  const decision = deriveOverviewFocusDecision(
    makeTree(),
    { nodeId: "child-1", sourceId: null },
    null,
  );

  assert.equal(decision.nextNodeId, "child-1");
  assert.equal(decision.shouldClearTransientReviewState, false);
});

test("switching source detail clears transient review state", () => {
  const shouldClear = shouldClearTransientReviewState(
    { nodeId: "node-a", sourceId: "source-1" },
    { nodeId: "node-a", sourceId: "source-2" },
  );
  assert.equal(shouldClear, true);
});

test("deriveContextSelectionDecision keeps review/apply state when returning to the same node context", () => {
  const decision = deriveContextSelectionDecision(
    { nodeId: "node-a", sourceId: null },
    { nodeId: "node-a", sourceId: null },
    {
      currentSelectionPanelTab: "review",
      preservePanelTab: true,
    },
  );

  assert.equal(decision.nextSelectionPanelTab, "review");
  assert.equal(decision.shouldClearTransientReviewState, false);
});

test("deriveContextSelectionDecision keeps the draft workspace visible when refreshing the same node context", () => {
  const decision = deriveContextSelectionDecision(
    { nodeId: "node-a", sourceId: null },
    { nodeId: "node-a", sourceId: null },
    {
      currentSelectionPanelTab: "draft",
      preservePanelTab: true,
    },
  );

  assert.equal(decision.nextSelectionPanelTab, "draft");
  assert.equal(decision.shouldClearTransientReviewState, false);
});

test("deriveContextSelectionDecision clears review/apply state when opening a different source", () => {
  const decision = deriveContextSelectionDecision(
    { nodeId: "node-a", sourceId: "source-1" },
    { nodeId: "node-a", sourceId: "source-2" },
    {
      currentSelectionPanelTab: "review",
      preservePanelTab: true,
    },
  );

  assert.equal(decision.nextSelectionPanelTab, "context");
  assert.equal(decision.shouldClearTransientReviewState, true);
});

test("deriveContextSelectionDecision clears review/apply state when closing the current source detail", () => {
  const decision = deriveContextSelectionDecision(
    { nodeId: "node-a", sourceId: "source-1" },
    { nodeId: "node-a", sourceId: null },
    {
      currentSelectionPanelTab: "review",
      preservePanelTab: true,
    },
  );

  assert.equal(decision.nextSelectionPanelTab, "context");
  assert.equal(decision.shouldClearTransientReviewState, true);
});

test("deriveReturnToNodeContextState clears transient review and apply state for source-detail handoff", () => {
  const nextState = deriveReturnToNodeContextState({
    currentSelection: { nodeId: "node-a", sourceId: "source-1" },
    currentSelectionPanelTab: "review",
    patchEditor: "{\"summary\":\"draft\"}",
    patchDraftOrigin: { kind: "manual" },
    reviewDraft: { kind: "review-draft" },
    applyResult: { kind: "apply-result" },
  });

  assert.equal(nextState.nextSelectionPanelTab, "context");
  assert.equal(nextState.shouldClearTransientReviewState, true);
  assert.equal(nextState.nextSelectedSourceId, null);
  assert.equal(nextState.nextSelectedSourceDetail, null);
  assert.equal(nextState.nextPatchEditor, "");
  assert.equal(nextState.nextPatchDraftOrigin, null);
  assert.equal(nextState.nextReviewDraft, null);
  assert.equal(nextState.nextApplyResult, null);
});

test("deriveOpenDraftWorkspaceState clears source detail before opening Draft", () => {
  const nextState = deriveOpenDraftWorkspaceState({
    currentSelection: { nodeId: "node-a", sourceId: "source-1" },
    currentSelectionPanelTab: "context",
    patchEditor: "{\"summary\":\"draft\"}",
    patchDraftOrigin: { kind: "manual" },
    reviewDraft: { kind: "review-draft" },
    applyResult: { kind: "apply-result" },
  });

  assert.equal(nextState.nextSelectionPanelTab, "draft");
  assert.equal(nextState.shouldClearTransientReviewState, true);
  assert.equal(nextState.nextSelectedSourceId, null);
  assert.equal(nextState.nextSelectedSourceDetail, null);
  assert.equal(nextState.nextPatchEditor, "");
  assert.equal(nextState.nextPatchDraftOrigin, null);
  assert.equal(nextState.nextReviewDraft, null);
  assert.equal(nextState.nextApplyResult, null);
});

test("deriveOpenDraftWorkspaceState preserves same-node draft state when no source detail is open", () => {
  const nextState = deriveOpenDraftWorkspaceState({
    currentSelection: { nodeId: "node-a", sourceId: null },
    currentSelectionPanelTab: "context",
    patchEditor: "{\"summary\":\"draft\"}",
    patchDraftOrigin: { kind: "manual" },
    reviewDraft: { kind: "review-draft" },
    applyResult: { kind: "apply-result" },
  });

  assert.equal(nextState.nextSelectionPanelTab, "draft");
  assert.equal(nextState.shouldClearTransientReviewState, false);
  assert.equal(nextState.nextPatchEditor, "{\"summary\":\"draft\"}");
  assert.deepEqual(nextState.nextPatchDraftOrigin, { kind: "manual" });
  assert.deepEqual(nextState.nextReviewDraft, { kind: "review-draft" });
  assert.deepEqual(nextState.nextApplyResult, { kind: "apply-result" });
});

test("deriveClearedDraftReviewState keeps apply result while clearing the draft payload", () => {
  const nextState = deriveClearedDraftReviewState({
    currentSelection: { nodeId: "node-a", sourceId: null },
    patchEditor: "{\"summary\":\"draft\"}",
    patchDraftOrigin: { kind: "manual" },
    reviewDraft: { kind: "review-draft" },
    applyResult: { kind: "apply-result" },
  });

  assert.equal(nextState.patchEditor, "");
  assert.equal(nextState.patchDraftOrigin, null);
  assert.equal(nextState.reviewDraft, null);
  assert.deepEqual(nextState.applyResult, { kind: "apply-result" });
});

test("deriveClearedTransientReviewState clears both draft payload and apply result", () => {
  const nextState = deriveClearedTransientReviewState({
    currentSelection: { nodeId: "node-a", sourceId: null },
    patchEditor: "{\"summary\":\"draft\"}",
    patchDraftOrigin: { kind: "manual" },
    reviewDraft: { kind: "review-draft" },
    applyResult: { kind: "apply-result" },
  });

  assert.equal(nextState.patchEditor, "");
  assert.equal(nextState.patchDraftOrigin, null);
  assert.equal(nextState.reviewDraft, null);
  assert.equal(nextState.applyResult, null);
});

test("deriveContextTransitionState clears transient state when switching to a different node", () => {
  const nextState = deriveContextTransitionState(
    {
      currentSelection: { nodeId: "node-a", sourceId: null },
      currentSelectionPanelTab: "review",
      patchEditor: "{\"summary\":\"draft\"}",
      patchDraftOrigin: { kind: "manual" },
      reviewDraft: { kind: "review-draft" },
      applyResult: { kind: "apply-result" },
    },
    { nodeId: "node-b", sourceId: null },
    {
      preservePanelTab: true,
    },
  );

  assert.equal(nextState.nextSelectionPanelTab, "context");
  assert.equal(nextState.shouldClearTransientReviewState, true);
  assert.equal(nextState.nextPatchEditor, "");
  assert.equal(nextState.nextPatchDraftOrigin, null);
  assert.equal(nextState.nextReviewDraft, null);
  assert.equal(nextState.nextApplyResult, null);
});

test("deriveContextTransitionState preserves review visibility on same source refresh", () => {
  const nextState = deriveContextTransitionState(
    {
      currentSelection: { nodeId: "node-a", sourceId: "source-1" },
      currentSelectionPanelTab: "review",
      patchEditor: "{\"summary\":\"draft\"}",
      patchDraftOrigin: { kind: "manual" },
      reviewDraft: { kind: "review-draft" },
      applyResult: { kind: "apply-result" },
    },
    { nodeId: "node-a", sourceId: "source-1" },
    {
      preservePanelTab: true,
    },
  );

  assert.equal(nextState.nextSelectionPanelTab, "review");
  assert.equal(nextState.shouldClearTransientReviewState, false);
  assert.equal(nextState.nextPatchEditor, "{\"summary\":\"draft\"}");
  assert.deepEqual(nextState.nextPatchDraftOrigin, { kind: "manual" });
  assert.deepEqual(nextState.nextReviewDraft, { kind: "review-draft" });
  assert.deepEqual(nextState.nextApplyResult, { kind: "apply-result" });
});

test("deriveContextSelectionDecision falls back to Context when panel preservation is not requested", () => {
  const decision = deriveContextSelectionDecision(
    { nodeId: "node-a", sourceId: null },
    { nodeId: "node-a", sourceId: null },
    {
      currentSelectionPanelTab: "review",
    },
  );

  assert.equal(decision.nextSelectionPanelTab, "context");
  assert.equal(decision.shouldClearTransientReviewState, false);
});

test("deriveContextSelectionDecision respects an explicit clear override", () => {
  const decision = deriveContextSelectionDecision(
    { nodeId: "node-a", sourceId: null },
    { nodeId: "node-a", sourceId: null },
    {
      clearTransientReviewState: true,
      currentSelectionPanelTab: "review",
      preservePanelTab: true,
    },
  );

  assert.equal(decision.nextSelectionPanelTab, "context");
  assert.equal(decision.shouldClearTransientReviewState, true);
});

test("resolveOverviewFocusNodeId still falls back to root when preferred node is missing", () => {
  const nodeId = resolveOverviewFocusNodeId(makeTree(), "missing");
  assert.equal(nodeId, "root");
});
