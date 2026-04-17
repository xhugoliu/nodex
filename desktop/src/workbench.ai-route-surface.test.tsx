import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AiDraftRouteSurface } from "./components/workbench";
import type { DesktopAiStatus } from "./types";

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

function makeStatus(overrides: Partial<DesktopAiStatus>): DesktopAiStatus {
  return {
    command: "python3 scripts/provider_runner.py --provider openai --use-default-args",
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
    ...overrides,
  };
}

function renderSurface(options: {
  status: DesktopAiStatus | null;
  loading?: boolean;
  draftError?: string | null;
}) {
  return renderToStaticMarkup(
    <AiDraftRouteSurface
      draftError={options.draftError ?? null}
      loading={options.loading ?? false}
      onRefresh={() => {}}
      status={options.status}
      t={t}
    />,
  );
}

test("AiDraftRouteSurface renders unavailable state and next steps for unknown override command", () => {
  const html = renderSurface({
    status: makeStatus({
      command: "python3 scripts/custom_runner.py",
      command_source: "override",
      provider: null,
      runner: "custom",
      uses_provider_defaults: false,
      status_error:
        "NODEX_DESKTOP_AI_COMMAND does not map to a known provider runner.",
    }),
  });

  assert.match(html, /nodeEditing\.aiDraftUnavailable/);
  assert.match(html, /nodeEditing\.aiDraftSourceOverride/);
  assert.match(html, /nodeEditing\.aiDraftCommand/);
  assert.match(html, /python3 scripts\/custom_runner\.py/);
  assert.match(html, /messages\.aiDraftNextCustomOverride/);
});

test("AiDraftRouteSurface renders needs-attention state when auth is missing", () => {
  const html = renderSurface({
    status: makeStatus({
      has_auth: false,
    }),
  });

  assert.match(html, /nodeEditing\.aiDraftNeedsAttention/);
  assert.match(html, /nodeEditing\.aiDraftAuth: nodeEditing\.aiDraftAuthMissing/);
  assert.match(html, /messages\.aiDraftNextSetupAuth/);
});

test("AiDraftRouteSurface keeps command hidden for healthy default route", () => {
  const html = renderSurface({
    status: makeStatus({}),
  });

  assert.match(html, /nodeEditing\.aiDraftReady/);
  assert.match(html, /nodeEditing\.aiDraftSourceDefault/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftAuth:/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftProcessEnv:/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftCommand/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftNextTitle/);
});

test("AiDraftRouteSurface keeps a neutral checking state while status is still loading", () => {
  const html = renderSurface({
    status: null,
    loading: true,
  });

  assert.match(html, /nodeEditing\.aiDraftChecking/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftUnavailable/);
  assert.doesNotMatch(html, /nodeEditing\.aiDraftNextTitle/);
});
