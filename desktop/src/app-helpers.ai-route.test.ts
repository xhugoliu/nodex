import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveClearedDraftReviewState,
  deriveClearedTransientReviewState,
  deriveContextSelectionDecision,
  buildAiDraftNextSteps,
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
    command: "python3 scripts/provider_runner.py --provider anthropic --use-default-args",
    command_source: "default",
    provider: "anthropic",
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

test("buildAiDraftNextSteps suggests auth setup when auth is missing", () => {
  const steps = buildAiDraftNextSteps(
    makeStatus({
      provider: "anthropic",
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

test("source import with preferred node hit resolves focus and clears transient review state", () => {
  const decision = deriveOverviewFocusDecision(
    makeTree(),
    { nodeId: "root", sourceId: null },
    "child-1",
  );

  assert.equal(decision.nextNodeId, "child-1");
  assert.equal(decision.shouldClearTransientReviewState, true);
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
