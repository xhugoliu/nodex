import type {
  ApplyPatchReport,
  AiRunArtifact,
  AiRunRecord,
  AiRunReplayReport,
  DesktopAiStatus,
  ExternalRunnerReport,
  ParentCandidate,
  PatchDraftOrigin,
  PatchOperation,
  TreeNode,
} from "./types";

export type ConsoleTone = "success" | "error";
export type Translator = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export interface PatchOpSummary {
  type: string;
  count: number;
}

export interface PatchDraftState {
  state: "empty" | "ready" | "invalid";
  summary: string | null;
  opCount: number;
  opTypes: PatchOpSummary[];
  ops: PatchOperation[];
  error: string | null;
}

export function renderPatchReport(
  report: ApplyPatchReport,
  dryRun: boolean,
  t: Translator,
  draftOrigin?: PatchDraftOrigin | null,
) {
  return [
    dryRun ? t("reports.patchPreviewSucceeded") : t("reports.patchApplied"),
    report.summary ? t("reports.summary", { value: report.summary }) : null,
    ...(draftOrigin ? renderPatchDraftOriginLines(draftOrigin, t) : []),
    ...report.preview.map((line) => `- ${line}`),
    report.run_id ? t("reports.runId", { id: report.run_id }) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderExternalRunnerReport(
  result: ExternalRunnerReport,
  t: Translator,
) {
  return [
    t("reports.aiDraftReady"),
    t("reports.capability", { value: result.metadata.capability }),
    result.metadata.explore_by
      ? t("reports.exploreBy", { value: result.metadata.explore_by })
      : null,
    result.metadata.provider
      ? t("reports.provider", { value: result.metadata.provider })
      : null,
    result.metadata.model
      ? t("reports.model", { value: result.metadata.model })
      : null,
    result.metadata.provider_run_id
      ? t("reports.providerRunId", { value: result.metadata.provider_run_id })
      : null,
    t("reports.retryCount", { count: result.metadata.retry_count }),
    t("reports.requestFile", { value: result.request_path }),
    t("reports.responseFile", { value: result.response_path }),
    t("reports.metaFile", { value: result.metadata_path }),
    t("reports.rationale", { value: result.explanation.rationale_summary }),
    result.explanation.direct_evidence.length
      ? t("reports.directEvidenceCount", {
          count: result.explanation.direct_evidence.length,
        })
      : t("reports.directEvidenceNone"),
    ...result.explanation.direct_evidence.map((item) =>
      `- ${t("reports.evidenceItem", {
        source: item.source_name,
        start: item.start_line,
        end: item.end_line,
        why: item.why_it_matters,
      })}`,
    ),
    result.explanation.inferred_suggestions.length
      ? t("reports.inferredSuggestionCount", {
          count: result.explanation.inferred_suggestions.length,
        })
      : t("reports.inferredSuggestionNone"),
    ...result.explanation.inferred_suggestions.map(
      (item) => `- ${t("reports.inferredSuggestion", { value: item })}`,
    ),
    ...result.notes.map((note) => `- ${t("reports.note", { value: note })}`),
    ...result.report.preview.map((line) => `- ${line}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export function countNodes(tree: TreeNode): number {
  return 1 + tree.children.reduce((count, child) => count + countNodes(child), 0);
}

export function countMatchingNodes(tree: TreeNode, query: string): number {
  if (!query.trim()) {
    return countNodes(tree);
  }

  const matchedSelf = nodeMatchesQuery(tree.node, query) ? 1 : 0;
  return (
    matchedSelf +
    tree.children.reduce(
      (count, child) => count + countMatchingNodes(child, query),
      0,
    )
  );
}

export function filterTree(tree: TreeNode, query: string): TreeNode | null {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return tree;
  }

  if (nodeMatchesQuery(tree.node, normalizedQuery)) {
    return tree;
  }

  const children = tree.children
    .map((child) => filterTree(child, normalizedQuery))
    .filter((child): child is TreeNode => child !== null);

  if (!children.length) {
    return null;
  }

  return {
    ...tree,
    children,
  };
}

export function nodeMatchesQuery(treeNode: TreeNode["node"], query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  if (normalizedQuery.startsWith("id:")) {
    const idQuery = normalizedQuery.slice(3).trim();
    return idQuery ? treeNode.id.toLowerCase().includes(idQuery) : false;
  }

  return [treeNode.title, treeNode.kind].some((field) =>
    field.toLowerCase().includes(normalizedQuery),
  );
}

export function findNodeById(tree: TreeNode, nodeId: string): TreeNode | null {
  if (tree.node.id === nodeId) {
    return tree;
  }

  for (const child of tree.children) {
    const match = findNodeById(child, nodeId);
    if (match) {
      return match;
    }
  }

  return null;
}

export interface SelectionContext {
  nodeId: string | null;
  sourceId: string | null;
}

export type SelectionPanelTab = "context" | "draft" | "review";

export interface OverviewFocusDecision {
  nextNodeId: string | null;
  shouldClearTransientReviewState: boolean;
}

export interface ContextSelectionDecision {
  nextSelectionPanelTab: SelectionPanelTab;
  shouldClearTransientReviewState: boolean;
}

export interface ContextSelectionDecisionOptions {
  clearTransientReviewState?: boolean;
  preservePanelTab?: boolean;
  currentSelectionPanelTab?: SelectionPanelTab;
}

export interface ReturnToNodeContextState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
> {
  patchEditor: string;
  patchDraftOrigin: TPatchDraftOrigin | null;
  reviewDraft: TReviewDraft | null;
  applyResult: TApplyResult | null;
}

export interface TransientReviewState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
> {
  currentSelection: SelectionContext;
  patchEditor: string;
  patchDraftOrigin: TPatchDraftOrigin | null;
  reviewDraft: TReviewDraft | null;
  applyResult: TApplyResult | null;
}

export interface ReturnToNodeContextResult<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
> {
  nextSelectionPanelTab: SelectionPanelTab;
  shouldClearTransientReviewState: boolean;
  nextSelectedSourceId: null;
  nextSelectedSourceDetail: null;
  nextPatchEditor: string;
  nextPatchDraftOrigin: TPatchDraftOrigin | null;
  nextReviewDraft: TReviewDraft | null;
  nextApplyResult: TApplyResult | null;
}

export interface ContextTransitionState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
> extends ReturnToNodeContextState<
    TPatchDraftOrigin,
    TReviewDraft,
    TApplyResult
  > {
  currentSelection: SelectionContext;
  currentSelectionPanelTab: SelectionPanelTab;
}

export interface ContextTransitionResult<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
> {
  nextSelectionPanelTab: SelectionPanelTab;
  shouldClearTransientReviewState: boolean;
  nextPatchEditor: string;
  nextPatchDraftOrigin: TPatchDraftOrigin | null;
  nextReviewDraft: TReviewDraft | null;
  nextApplyResult: TApplyResult | null;
}

export function deriveClearedDraftReviewState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
>(
  state: TransientReviewState<TPatchDraftOrigin, TReviewDraft, TApplyResult>,
): TransientReviewState<TPatchDraftOrigin, TReviewDraft, TApplyResult> {
  return {
    ...state,
    patchEditor: "",
    patchDraftOrigin: null,
    reviewDraft: null,
  };
}

export function deriveClearedTransientReviewState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
>(
  state: TransientReviewState<TPatchDraftOrigin, TReviewDraft, TApplyResult>,
): TransientReviewState<TPatchDraftOrigin, TReviewDraft, TApplyResult> {
  return {
    ...deriveClearedDraftReviewState(state),
    applyResult: null,
  };
}

export function resolveOverviewFocusNodeId(
  tree: TreeNode,
  preferredNodeId?: string | null,
): string | null {
  if (preferredNodeId && findNodeById(tree, preferredNodeId)) {
    return preferredNodeId;
  }

  return tree.node.id || findNodeById(tree, "root")?.node.id || null;
}

export function shouldClearTransientReviewState(
  previous: SelectionContext,
  next: SelectionContext,
): boolean {
  return previous.nodeId !== next.nodeId || previous.sourceId !== next.sourceId;
}

export function deriveContextSelectionDecision(
  previous: SelectionContext,
  next: SelectionContext,
  options: ContextSelectionDecisionOptions = {},
): ContextSelectionDecision {
  const shouldResetTransientReviewState =
    options.clearTransientReviewState ??
    shouldClearTransientReviewState(previous, next);

  return {
    nextSelectionPanelTab:
      !shouldResetTransientReviewState &&
      options.preservePanelTab &&
      options.currentSelectionPanelTab
        ? options.currentSelectionPanelTab
        : "context",
    shouldClearTransientReviewState: shouldResetTransientReviewState,
  };
}

export function deriveContextTransitionState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
>(
  state: ContextTransitionState<TPatchDraftOrigin, TReviewDraft, TApplyResult>,
  nextSelection: SelectionContext,
  options: ContextSelectionDecisionOptions = {},
): ContextTransitionResult<TPatchDraftOrigin, TReviewDraft, TApplyResult> {
  const selectionDecision = deriveContextSelectionDecision(
    state.currentSelection,
    nextSelection,
    {
      ...options,
      currentSelectionPanelTab:
        options.currentSelectionPanelTab ?? state.currentSelectionPanelTab,
    },
  );
  const shouldClearTransientReviewState =
    selectionDecision.shouldClearTransientReviewState;
  const nextTransientState = shouldClearTransientReviewState
    ? deriveClearedTransientReviewState({
        currentSelection: state.currentSelection,
        patchEditor: state.patchEditor,
        patchDraftOrigin: state.patchDraftOrigin,
        reviewDraft: state.reviewDraft,
        applyResult: state.applyResult,
      })
    : {
        currentSelection: state.currentSelection,
        patchEditor: state.patchEditor,
        patchDraftOrigin: state.patchDraftOrigin,
        reviewDraft: state.reviewDraft,
        applyResult: state.applyResult,
      };

  return {
    nextSelectionPanelTab: selectionDecision.nextSelectionPanelTab,
    shouldClearTransientReviewState,
    nextPatchEditor: nextTransientState.patchEditor,
    nextPatchDraftOrigin: nextTransientState.patchDraftOrigin,
    nextReviewDraft: nextTransientState.reviewDraft,
    nextApplyResult: nextTransientState.applyResult,
  };
}

export function deriveReturnToNodeContextState<
  TPatchDraftOrigin = unknown,
  TReviewDraft = unknown,
  TApplyResult = unknown,
>(
  state: {
    currentSelection: SelectionContext;
    currentSelectionPanelTab: SelectionPanelTab;
  } & ReturnToNodeContextState<TPatchDraftOrigin, TReviewDraft, TApplyResult>,
  options: ContextSelectionDecisionOptions = {},
): ReturnToNodeContextResult<
  TPatchDraftOrigin,
  TReviewDraft,
  TApplyResult
> {
  const transitionState = deriveContextTransitionState(
    state,
    {
      nodeId: state.currentSelection.nodeId,
      sourceId: null,
    },
    options,
  );

  return {
    nextSelectionPanelTab: transitionState.nextSelectionPanelTab,
    shouldClearTransientReviewState:
      transitionState.shouldClearTransientReviewState,
    nextSelectedSourceId: null,
    nextSelectedSourceDetail: null,
    nextPatchEditor: transitionState.nextPatchEditor,
    nextPatchDraftOrigin: transitionState.nextPatchDraftOrigin,
    nextReviewDraft: transitionState.nextReviewDraft,
    nextApplyResult: transitionState.nextApplyResult,
  };
}

export function deriveOverviewFocusDecision(
  tree: TreeNode,
  current: SelectionContext,
  preferredNodeId?: string | null,
): OverviewFocusDecision {
  const hasPreferredNode =
    typeof preferredNodeId === "string" &&
    preferredNodeId.length > 0 &&
    Boolean(findNodeById(tree, preferredNodeId));
  const hasCurrentNode =
    typeof current.nodeId === "string" &&
    current.nodeId.length > 0 &&
    Boolean(findNodeById(tree, current.nodeId));
  const nextNodeId = hasPreferredNode
    ? preferredNodeId!
    : hasCurrentNode
      ? current.nodeId
      : resolveOverviewFocusNodeId(tree);
  const nextSelection: SelectionContext = {
    nodeId: nextNodeId,
    sourceId: null,
  };

  return {
    nextNodeId,
    shouldClearTransientReviewState: shouldClearTransientReviewState(
      current,
      nextSelection,
    ),
  };
}

export function listParentCandidates(
  tree: TreeNode,
  excludedNodeId: string | null,
): ParentCandidate[] {
  const excludedIds = excludedNodeId ? collectSubtreeIds(tree, excludedNodeId) : new Set();
  const candidates = new Array<ParentCandidate>();

  const visit = (current: TreeNode, path: string[]) => {
    if (!excludedIds.has(current.node.id)) {
      const nextPath = [...path, current.node.title];
      candidates.push({
        id: current.node.id,
        label: nextPath.join(" / "),
      });

      for (const child of current.children) {
        visit(child, nextPath);
      }
    }
  };

  visit(tree, []);
  return candidates;
}

export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function inspectPatchDraft(text: string): PatchDraftState {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      state: "empty",
      summary: null,
      opCount: 0,
      opTypes: [],
      ops: [],
      error: null,
    };
  }

  try {
    const patch = JSON.parse(trimmed) as {
      summary?: unknown;
      ops?: unknown;
    };
    const ops = Array.isArray(patch.ops)
      ? patch.ops.filter(
          (op): op is PatchOperation => Boolean(op) && typeof op === "object",
        )
      : [];
    const counts = new Map<string, number>();

    for (const op of ops) {
      const type = typeof op.type === "string" ? op.type : "op";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return {
      state: "ready",
      summary: typeof patch.summary === "string" ? patch.summary : null,
      opCount: ops.length,
      opTypes: Array.from(counts, ([type, count]) => ({ type, count })),
      ops,
      error: null,
    };
  } catch (error) {
    return {
      state: "invalid",
      summary: null,
      opCount: 0,
      opTypes: [],
      ops: [],
      error: formatError(error),
    };
  }
}

export function describePatchOperation(op: PatchOperation, t: Translator): string {
  const type = typeof op.type === "string" ? op.type : "op";

  switch (type) {
    case "add_node": {
      const title = stringValue(op.title, t("composer.untitledNode"));
      const parent = stringValue(op.parent_id, "root");
      const position = integerValue(op.position);
      return position === null
        ? t("composer.opAddNode", { title, parent })
        : t("composer.opAddNodeAt", { title, parent, position });
    }
    case "update_node": {
      const node = stringValue(op.id, "node");
      const fields = changedFieldLabels(op, t);
      return fields.length
        ? t("composer.opUpdateNodeFields", {
            node,
            fields: fields.join(", "),
          })
        : t("composer.opUpdateNode", { node });
    }
    case "move_node": {
      const node = stringValue(op.id, "node");
      const parent = stringValue(op.parent_id, "root");
      const position = integerValue(op.position);
      return position === null
        ? t("composer.opMoveNode", { node, parent })
        : t("composer.opMoveNodeAt", { node, parent, position });
    }
    case "delete_node":
      return t("composer.opDeleteNode", {
        node: stringValue(op.id, "node"),
      });
    case "attach_source":
      return t("composer.opAttachSource", {
        source: stringValue(op.source_id, "source"),
        node: stringValue(op.node_id, "node"),
      });
    case "attach_source_chunk":
      return t("composer.opAttachSourceChunk", {
        chunk: stringValue(op.chunk_id, "chunk"),
        node: stringValue(op.node_id, "node"),
      });
    case "cite_source_chunk":
      return t("composer.opCiteSourceChunk", {
        chunk: stringValue(op.chunk_id, "chunk"),
        node: stringValue(op.node_id, "node"),
      });
    case "detach_source":
      return t("composer.opDetachSource", {
        source: stringValue(op.source_id, "source"),
        node: stringValue(op.node_id, "node"),
      });
    case "detach_source_chunk":
      return t("composer.opDetachSourceChunk", {
        chunk: stringValue(op.chunk_id, "chunk"),
        node: stringValue(op.node_id, "node"),
      });
    case "uncite_source_chunk":
      return t("composer.opUnciteSourceChunk", {
        chunk: stringValue(op.chunk_id, "chunk"),
        node: stringValue(op.node_id, "node"),
      });
    default:
      return type;
  }
}

export function parseOptionalInteger(value: string, t: Translator): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(t("messages.invalidInteger", { value: trimmed }));
  }

  return parsed;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
}

export function buildAiDraftNextSteps(
  status: DesktopAiStatus | null,
  t: Translator,
  error?: unknown,
): string[] {
  if (!status) {
    return [];
  }

  const detail = [formatError(error ?? ""), status.status_error ?? "", status.command]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const provider = status.provider ?? t("nodeEditing.aiDraftUnknown");
  const actions = new Array<string>();

  if (status.command_source === "override" && status.provider === null) {
    actions.push(t("messages.aiDraftNextCustomOverride"));
  }

  if (status.has_auth === false) {
    actions.push(t("messages.aiDraftNextSetupAuth", { provider }));
  }

  if (
    status.provider === "codex" &&
    (status.has_process_env_conflict || status.has_shell_env_conflict)
  ) {
    actions.push(t("messages.aiDraftNextCheckCodexEnv"));
  }

  if (detail.includes("[rate_limit]") || detail.includes("rate limit")) {
    actions.push(t("messages.aiDraftNextRateLimit"));
  }

  if (detail.includes("502") || detail.includes("bad gateway")) {
    actions.push(t("messages.aiDraftNextRelay502"));
  }

  if (
    detail.includes("[network]") ||
    detail.includes("[timeout]") ||
    detail.includes("timeout")
  ) {
    actions.push(t("messages.aiDraftNextNetwork"));
  }

  if (detail.includes("[schema_error]") || detail.includes("schema_error")) {
    actions.push(t("messages.aiDraftNextSchema"));
  }

  if (
    detail.includes("[parse_error]") ||
    detail.includes("parse_error") ||
    detail.includes("did not return valid json") ||
    detail.includes("returned non-object json")
  ) {
    actions.push(t("messages.aiDraftNextParse"));
  }

  if (!actions.length && status.provider) {
    actions.push(t("messages.aiDraftNextRunDoctor", { provider: status.provider }));
  }

  return Array.from(new Set(actions));
}

export function buildAiRunNextSteps(
  run: AiRunRecord,
  status: DesktopAiStatus | null,
  t: Translator,
): string[] {
  if (
    run.status !== "failed" &&
    !run.last_error_category &&
    !run.last_error_message
  ) {
    return [];
  }

  const provider = run.provider ?? status?.provider ?? null;
  const effectiveStatus = provider
    ? {
        command: status?.command ?? run.command,
        command_source: status?.command_source ?? "default",
        provider,
        runner: status?.runner ?? "custom",
        model: run.model ?? status?.model ?? null,
        reasoning_effort: status?.reasoning_effort ?? null,
        has_auth: status?.has_auth ?? null,
        has_process_env_conflict: status?.has_process_env_conflict ?? null,
        has_shell_env_conflict: status?.has_shell_env_conflict ?? null,
        uses_provider_defaults: status?.uses_provider_defaults ?? false,
        status_error: status?.status_error ?? null,
      }
    : status;
  const errorDetail = [
    run.last_error_category ? `[${run.last_error_category}]` : "",
    run.last_error_message ?? "",
    run.status,
  ]
    .filter(Boolean)
    .join(" ");

  return buildAiDraftNextSteps(effectiveStatus, t, errorDetail);
}

export function formatAiRunStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "dry_run_succeeded":
      return t("detail.aiRunDraftReadyStatus");
    case "applied":
      return t("detail.aiRunAppliedStatus");
    case "failed":
      return t("detail.aiRunFailedStatus");
    default:
      return status;
  }
}

export function renderAiDraftFailure(
  error: unknown,
  status: DesktopAiStatus | null,
  t: Translator,
): string {
  const detail = formatError(error);
  const nextSteps = buildAiDraftNextSteps(status, t, error);
  if (!nextSteps.length) {
    return detail;
  }

  return [
    detail,
    "",
    t("nodeEditing.aiDraftNextTitle"),
    ...nextSteps.map((step) => `- ${step}`),
  ].join("\n");
}

export function renderAiRunTrace(run: AiRunRecord, t: Translator): string {
  const metadataPath = deriveAiRunMetadataPath(run.response_path);
  const lines = [
    t("detail.aiRunTraceTitle"),
    t("reports.capability", { value: run.capability }),
    run.explore_by ? t("reports.exploreBy", { value: run.explore_by }) : null,
    t("detail.aiRunStatus", { value: formatAiRunStatusLabel(run.status, t) }),
    t("detail.aiRunMode", {
      value: run.dry_run ? t("detail.aiRunDryRun") : t("detail.aiRunApplied"),
    }),
    t("detail.aiRunStartedAt", { value: formatTimestamp(run.started_at) }),
    run.provider ? t("reports.provider", { value: run.provider }) : null,
    run.model ? t("reports.model", { value: run.model }) : null,
    t("detail.aiRunCommand", { value: run.command }),
    t("detail.aiRunRequest", { value: run.request_path }),
    t("detail.aiRunResponse", { value: run.response_path }),
    metadataPath ? t("detail.aiRunMetadata", { value: metadataPath }) : null,
    run.patch_run_id ? t("detail.aiRunPatchRun", { value: run.patch_run_id }) : null,
    run.patch_summary ? t("detail.aiRunPatchSummary", { value: run.patch_summary }) : null,
    run.last_error_category
      ? t("detail.aiRunErrorCategory", { value: run.last_error_category })
      : null,
    run.last_error_message
      ? t("detail.aiRunErrorMessage", { value: run.last_error_message })
      : null,
  ];

  return lines.filter(Boolean).join("\n");
}

export function renderAiRunArtifact(
  artifact: AiRunArtifact,
  t: Translator,
): string {
  const title =
    artifact.kind === "request"
      ? t("detail.showAiRunRequest")
      : artifact.kind === "response"
        ? t("detail.showAiRunResponse")
        : t("detail.showAiRunMetadata");

  return [
    title,
    t("detail.aiRunArtifactPath", { value: artifact.path }),
    "",
    artifact.content,
  ].join("\n");
}

export function renderAiRunReplayReport(
  replay: AiRunReplayReport,
  t: Translator,
): string {
  return [
    t("reports.aiRunReplayReady", { runId: replay.source_run.id }),
    t("reports.aiRunReplayMode", {
      value: replay.dry_run ? t("detail.aiRunDryRun") : t("detail.aiRunApplied"),
    }),
    t("reports.aiRunReplayPatchSource", { value: replay.patch_source }),
    replay.source_patch_run_id
      ? t("reports.aiRunReplaySourcePatchRun", {
          value: replay.source_patch_run_id,
        })
      : null,
    replay.report.summary ? t("reports.summary", { value: replay.report.summary }) : null,
    ...replay.report.preview.map((line) => `- ${line}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPatchDraftOriginTitle(
  origin: PatchDraftOrigin,
  t: Translator,
): string {
  return t("composer.aiRunOriginTitle", { id: origin.run_id });
}

export function formatPatchDraftOriginMeta(
  origin: PatchDraftOrigin,
  t: Translator,
): string {
  const parts = [
    origin.explore_by
      ? t("reports.exploreBy", { value: origin.explore_by })
      : t("reports.capability", { value: origin.capability }),
    origin.provider ? t("reports.provider", { value: origin.provider }) : null,
    origin.model ? t("reports.model", { value: origin.model }) : null,
    origin.patch_run_id
      ? t("composer.aiRunOriginPatchRun", { id: origin.patch_run_id })
      : null,
  ];

  return parts.filter(Boolean).join(" · ");
}

function changedFieldLabels(op: PatchOperation, t: Translator): string[] {
  const fields = new Array<string>();

  if (typeof op.title === "string") {
    fields.push(t("fields.title"));
  }

  if (typeof op.kind === "string") {
    fields.push(t("fields.kind"));
  }

  if (typeof op.body === "string") {
    fields.push(t("fields.body"));
  }

  return fields;
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return fallback;
}

function integerValue(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function deriveAiRunMetadataPath(responsePath: string): string | null {
  const trimmed = responsePath.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.endsWith(".response.json")) {
    return `${trimmed.slice(0, -".response.json".length)}.meta.json`;
  }

  return null;
}

function renderPatchDraftOriginLines(
  origin: PatchDraftOrigin,
  t: Translator,
): string[] {
  return [
    t("reports.sourceAiRun", { id: origin.run_id }),
    origin.explore_by
      ? t("reports.sourceCapability", {
          value: `${origin.capability} / ${origin.explore_by}`,
        })
      : t("reports.sourceCapability", { value: origin.capability }),
    origin.provider ? t("reports.provider", { value: origin.provider }) : null,
    origin.model ? t("reports.model", { value: origin.model }) : null,
    origin.patch_run_id
      ? t("reports.sourcePatchRun", { id: origin.patch_run_id })
      : null,
  ].filter(Boolean) as string[];
}

function formatTimestamp(timestampSeconds: number): string {
  if (!Number.isFinite(timestampSeconds)) {
    return String(timestampSeconds);
  }

  return new Date(timestampSeconds * 1000).toLocaleString();
}

function collectSubtreeIds(tree: TreeNode, nodeId: string): Set<string> {
  if (tree.node.id === nodeId) {
    return new Set(flattenTreeIds(tree));
  }

  for (const child of tree.children) {
    const childResult = collectSubtreeIds(child, nodeId);
    if (childResult.size) {
      return childResult;
    }
  }

  return new Set();
}

function flattenTreeIds(tree: TreeNode): string[] {
  return [
    tree.node.id,
    ...tree.children.flatMap((child) => flattenTreeIds(child)),
  ];
}
