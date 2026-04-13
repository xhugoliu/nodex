import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAiDraftNextSteps,
  renderAiDraftFailure,
  resolveOverviewFocusNodeId,
  shouldClearReviewApplyState,
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

test("resolveOverviewFocusNodeId prefers provided node when it exists", () => {
  const nodeId = resolveOverviewFocusNodeId(makeTree(), "child-1");
  assert.equal(nodeId, "child-1");
});

test("resolveOverviewFocusNodeId falls back to root when preferred node is missing", () => {
  const nodeId = resolveOverviewFocusNodeId(makeTree(), "missing");
  assert.equal(nodeId, "root");
});

test("shouldClearReviewApplyState clears state on node switch", () => {
  const shouldClear = shouldClearReviewApplyState(
    { nodeId: "node-a", sourceId: "source-1" },
    { nodeId: "node-b", sourceId: "source-1" },
  );
  assert.equal(shouldClear, true);
});

test("shouldClearReviewApplyState clears state on source switch", () => {
  const shouldClear = shouldClearReviewApplyState(
    { nodeId: "node-a", sourceId: "source-1" },
    { nodeId: "node-a", sourceId: "source-2" },
  );
  assert.equal(shouldClear, true);
});

test("shouldClearReviewApplyState keeps state on same-node refresh", () => {
  const shouldClear = shouldClearReviewApplyState(
    { nodeId: "node-a", sourceId: "source-1" },
    { nodeId: "node-a", sourceId: "source-1" },
  );
  assert.equal(shouldClear, false);
});
