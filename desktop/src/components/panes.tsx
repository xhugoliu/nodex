import {
  buildAiDraftNextSteps,
  buildAiRunNextSteps,
  describePatchOperation,
  formatAiRunStatusLabel,
  formatPatchDraftOriginMeta,
  formatPatchDraftOriginTitle,
  type ConsoleTone,
  type PatchDraftState,
  type Translator,
} from "../app-helpers";
import type {
  AiRunRecord,
  DesktopAiStatus,
  NodeDetail,
  ParentCandidate,
  PatchDraftOrigin,
  SourceDetail,
  TreeNode,
  WorkspaceOverview,
} from "../types";
import {
  cardClass,
  CardHeader,
  dangerButtonClass,
  EmptyBox,
  EmptyState,
  ghostButtonClass,
  inputClass,
  LabeledField,
  panelClass,
  PatchDraftBanner,
  patchTextareaClass,
  primaryButtonClass,
  SectionHeader,
  secondaryButtonClass,
  textareaClass,
} from "./common";

export function TreePane(props: {
  workspaceOverview: WorkspaceOverview | null;
  treeSummary: string;
  treeQuery: string;
  query: string;
  filteredTree: TreeNode | null;
  selectedNodeId: string | null;
  t: Translator;
  onQueryChange: (value: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <section className={`${panelClass} flex min-h-0 flex-col overflow-hidden`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[color:var(--text)]">
          {props.t("sidebar.tree")}
        </div>
        <div className="text-xs text-[color:var(--muted)]">{props.treeSummary}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {props.workspaceOverview ? (
          <>
            <input
              className={`${inputClass} mb-3`}
              value={props.treeQuery}
              placeholder={props.t("navigator.searchPlaceholder")}
              onChange={(event) => props.onQueryChange(event.target.value)}
            />
            {props.filteredTree ? (
              <div className="scroll-panel min-h-0 flex-1 overflow-auto px-1">
                <TreeBranch
                  treeNode={props.filteredTree}
                  depth={0}
                  query={props.query}
                  selectedNodeId={props.selectedNodeId}
                  onSelect={props.onSelectNode}
                />
              </div>
            ) : (
              <EmptyBox>{props.t("navigator.searchEmpty")}</EmptyBox>
            )}
          </>
        ) : (
          <EmptyState
            title={props.t("sidebar.treeEmptyTitle")}
            body={props.t("sidebar.treeEmptyBody")}
          />
        )}
      </div>
    </section>
  );
}

export function WorkspaceStartPane(props: {
  message: string;
  tone: ConsoleTone | null;
  showStatus: boolean;
  t: Translator;
  onOpenWorkspace: () => void;
}) {
  return (
    <section className={`${panelClass} flex min-h-0 flex-1 items-center justify-center`}>
      <div className="w-full space-y-5 text-center">
        <div className="space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
            {props.t("workspace.workspace")}
          </div>
          <h1
            className="text-3xl font-semibold text-[color:var(--text)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {props.t("workspace.startTitle")}
          </h1>
          <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--muted)]">
            {props.t("workspace.startBody")}
          </p>
        </div>

        <div className="flex justify-center">
          <button className={primaryButtonClass} onClick={props.onOpenWorkspace}>
            {props.t("workspace.chooseFolder")}
          </button>
        </div>

        {props.showStatus ? (
          <div
            className={[
              "rounded-2xl border px-4 py-3 text-left text-sm leading-6",
              props.tone === "error"
                ? "border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)] text-[color:var(--danger)]"
                : props.tone === "success"
                  ? "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)] text-[color:var(--text)]"
                  : "border-[color:var(--line)] bg-white/70 text-[color:var(--muted)]",
            ].join(" ")}
          >
            {props.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function InspectorPane(props: {
  hasWorkspace: boolean;
  desktopAiStatus: DesktopAiStatus | null;
  selectedNodeDetail: NodeDetail | null;
  selectedNodeAiRuns: AiRunRecord[];
  patchDraftOrigin: PatchDraftOrigin | null;
  selectedSourceDetail: SourceDetail | null;
  contextNodeId: string | null;
  contextSourceId: string | null;
  consoleMessage: string;
  consoleTone: ConsoleTone | null;
  showConsoleDetails: boolean;
  t: Translator;
  onToggleConsoleDetails: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectSource: (sourceId: string) => void;
  onLoadAiRunPatch: (runId: string) => void;
  onShowAiRunTrace: (run: AiRunRecord) => void;
  onShowAiRunArtifact: (runId: string, kind: "request" | "response" | "metadata") => void;
  onDraftCiteChunk: (chunkId: string) => void;
  onDraftUnciteChunk: (chunkId: string) => void;
}) {
  const consoleLabel =
    props.consoleTone === "error"
      ? props.t("console.error")
      : props.consoleTone === "success"
        ? props.t("console.success")
        : props.t("console.status");
  const consoleSummary = summarizeConsoleMessage(props.consoleMessage);

  return (
    <section className={`${panelClass} flex min-h-0 flex-col overflow-hidden`}>
      <SectionHeader title={props.t("detail.title")} />

      <div className="grid min-h-0 flex-1 gap-3 grid-rows-[minmax(0,1fr)_auto]">
        <div className={`${cardClass} scroll-panel min-h-0 overflow-auto`}>
          {props.selectedNodeDetail ? (
            <CompactNodeDetail
              detail={props.selectedNodeDetail}
              aiRuns={props.selectedNodeAiRuns}
              desktopAiStatus={props.desktopAiStatus}
              patchDraftOrigin={props.patchDraftOrigin}
              contextSourceId={props.contextSourceId}
              t={props.t}
              onSelectSource={props.onSelectSource}
              onLoadAiRunPatch={props.onLoadAiRunPatch}
              onShowAiRunTrace={props.onShowAiRunTrace}
              onShowAiRunArtifact={props.onShowAiRunArtifact}
            />
          ) : props.selectedSourceDetail ? (
            <CompactSourceDetail
              detail={props.selectedSourceDetail}
              contextNodeId={props.contextNodeId}
              t={props.t}
              onSelectNode={props.onSelectNode}
              onDraftCiteChunk={props.onDraftCiteChunk}
              onDraftUnciteChunk={props.onDraftUnciteChunk}
            />
          ) : (
            <EmptyState
              title={props.t(
                props.hasWorkspace
                  ? "detail.emptyMeta"
                  : "detail.workspaceEmptyMeta",
              )}
              body={props.t(
                props.hasWorkspace
                  ? "detail.emptyBody"
                  : "detail.workspaceEmptyBody",
              )}
            />
          )}
        </div>

        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                {props.t("console.title")}
              </div>
              <span
                className={[
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                  props.consoleTone === "error"
                    ? "border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)] text-[color:var(--danger)]"
                    : props.consoleTone === "success"
                      ? "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)] text-[color:var(--text)]"
                      : "border-[color:var(--line)] bg-white/70 text-[color:var(--muted)]",
                ].join(" ")}
              >
                {consoleLabel}
              </span>
            </div>
            <button className={ghostButtonClass} onClick={props.onToggleConsoleDetails}>
              {props.showConsoleDetails
                ? props.t("console.hideDetails")
                : props.t("console.showDetails")}
            </button>
          </div>
          <div
            className={[
              "mt-3 rounded-md px-3 py-2 text-sm",
              props.consoleTone === "success"
                ? "bg-[rgba(17,24,39,0.04)]"
                : props.consoleTone === "error"
                  ? "bg-[rgba(180,35,24,0.08)]"
                  : "bg-[rgba(17,24,39,0.03)]",
            ].join(" ")}
          >
            <div className="truncate text-[color:var(--text)]">{consoleSummary}</div>
            {props.showConsoleDetails ? (
              <div className="scroll-panel mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-[color:var(--muted)]">
                {props.consoleMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EditorPane(props: {
  hasWorkspace: boolean;
  desktopAiStatus: DesktopAiStatus | null;
  selectedNodeDetail: NodeDetail | null;
  updateNodeTitle: string;
  updateNodeKind: string;
  updateNodeBody: string;
  addChildTitle: string;
  addChildKind: string;
  addChildBody: string;
  moveNodeParent: string;
  moveParentOptions: ParentCandidate[];
  patchEditor: string;
  patchDraftOrigin: PatchDraftOrigin | null;
  showAdvancedPatchEditor: boolean;
  canRunStructureActions: boolean;
  patchDraftState: PatchDraftState;
  t: Translator;
  onTitleChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onAddChildTitleChange: (value: string) => void;
  onAddChildKindChange: (value: string) => void;
  onAddChildBodyChange: (value: string) => void;
  onParentChange: (value: string) => void;
  onPatchEditorChange: (value: string) => void;
  onToggleAdvancedPatchEditor: () => void;
  onClearPatchEditor: () => void;
  onDraftUpdate: () => void;
  onDraftAiExpand: () => void;
  onDraftAiExplore: (by: "risk" | "question" | "action" | "evidence") => void;
  onDraftAddChild: () => void;
  onDraftMove: () => void;
  onDraftDelete: () => void;
  onPreviewPatch: () => void;
  onApplyPatch: () => void;
  onShowDraftOrigin: () => void;
}) {
  const draftLines =
    props.patchDraftState.state === "ready"
      ? props.patchDraftState.ops.map((op) => describePatchOperation(op, props.t))
      : [];
  const isRootNode = props.selectedNodeDetail?.node.parent_id === null;
  const isRootStartState =
    isRootNode && (props.selectedNodeDetail?.children.length ?? 0) === 0;
  const showStructureSection = props.canRunStructureActions || !isRootNode;
  const showNodeKindBadge =
    props.selectedNodeDetail?.node.kind &&
    props.selectedNodeDetail.node.kind !== "topic";

  return (
    <section className={`${panelClass} flex min-h-0 flex-col overflow-hidden`}>
      <SectionHeader
        title={props.t("actions.title")}
        subtitle={props.t("actions.subtitle")}
      />

      <div className={`${cardClass} flex min-h-0 flex-1 flex-col`}>
        <CardHeader title={props.t("nodeEditing.title")} />
        <div className="space-y-5">
          {props.desktopAiStatus ? (
            <AiDraftStatusCard status={props.desktopAiStatus} t={props.t} />
          ) : null}

          {props.selectedNodeDetail ? (
            <>
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[color:var(--line-soft)] pb-4">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold text-[color:var(--text)]">
                  {props.selectedNodeDetail.node.title}
                </div>
                {showNodeKindBadge ? (
                  <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
                    {props.selectedNodeDetail.node.kind}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-5">
              {isRootStartState ? (
                <div className="rounded-xl border border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)] px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                    {props.t("nodeEditing.startTitle")}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[color:var(--text)]">
                    {props.t("nodeEditing.startBody")}
                  </div>
                </div>
              ) : null}

              <section className="space-y-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                  {props.t("nodeEditing.aiExpand")}
                </div>
                <div className="mb-3 text-sm text-[color:var(--muted)]">
                  {props.t("nodeEditing.aiExpandMeta", {
                    title: props.selectedNodeDetail.node.title,
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={ghostButtonClass} onClick={props.onDraftAiExpand}>
                    {props.t("nodeEditing.draftAiExpand")}
                  </button>
                </div>
                <div className="pt-2 text-sm text-[color:var(--muted)]">
                  {props.t("nodeEditing.aiExploreMeta", {
                    title: props.selectedNodeDetail.node.title,
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={ghostButtonClass}
                    onClick={() => props.onDraftAiExplore("risk")}
                  >
                    {props.t("nodeEditing.draftAiExploreRisk")}
                  </button>
                  <button
                    className={ghostButtonClass}
                    onClick={() => props.onDraftAiExplore("question")}
                  >
                    {props.t("nodeEditing.draftAiExploreQuestion")}
                  </button>
                  <button
                    className={ghostButtonClass}
                    onClick={() => props.onDraftAiExplore("action")}
                  >
                    {props.t("nodeEditing.draftAiExploreAction")}
                  </button>
                  <button
                    className={ghostButtonClass}
                    onClick={() => props.onDraftAiExplore("evidence")}
                  >
                    {props.t("nodeEditing.draftAiExploreEvidence")}
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                  {props.t(
                    isRootStartState ? "nodeEditing.firstBranch" : "nodeEditing.addChild",
                  )}
                </div>
                <div className="mb-3 text-sm text-[color:var(--muted)]">
                  {props.t(
                    isRootStartState
                      ? "nodeEditing.firstBranchMeta"
                      : "nodeEditing.addChildMeta",
                    {
                      title: props.selectedNodeDetail.node.title,
                    },
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabeledField label={props.t("fields.title")}>
                    <input
                      className={inputClass}
                      value={props.addChildTitle}
                      placeholder={props.t("nodeEditing.addChildTitlePlaceholder")}
                      onChange={(event) =>
                        props.onAddChildTitleChange(event.target.value)
                      }
                    />
                  </LabeledField>
                  <LabeledField label={props.t("fields.kind")}>
                    <input
                      className={inputClass}
                      value={props.addChildKind}
                      placeholder={props.t("nodeEditing.kindPlaceholder")}
                      onChange={(event) =>
                        props.onAddChildKindChange(event.target.value)
                      }
                    />
                  </LabeledField>
                </div>

                <LabeledField label={props.t("fields.body")} className="mt-3">
                  <textarea
                    className={`${textareaClass} min-h-[7rem]`}
                    value={props.addChildBody}
                    spellCheck={false}
                    onChange={(event) => props.onAddChildBodyChange(event.target.value)}
                  />
                </LabeledField>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={secondaryButtonClass} onClick={props.onDraftAddChild}>
                    {props.t("nodeEditing.draftAddChild")}
                  </button>
                </div>
              </section>

              <section className="space-y-3 border-t border-[color:var(--line-soft)] pt-4">
                <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                  {props.t("nodeEditing.updateNode")}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabeledField label={props.t("fields.title")}>
                    <input
                      className={inputClass}
                      value={props.updateNodeTitle}
                      onChange={(event) => props.onTitleChange(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label={props.t("fields.kind")}>
                    <input
                      className={inputClass}
                      value={props.updateNodeKind}
                      onChange={(event) => props.onKindChange(event.target.value)}
                    />
                  </LabeledField>
                </div>

                <LabeledField label={props.t("fields.body")} className="mt-3">
                  <textarea
                    className={`${textareaClass} min-h-[8rem]`}
                    value={props.updateNodeBody}
                    spellCheck={false}
                    onChange={(event) => props.onBodyChange(event.target.value)}
                  />
                </LabeledField>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={primaryButtonClass} onClick={props.onDraftUpdate}>
                    {props.t("nodeEditing.draftUpdate")}
                  </button>
                </div>
              </section>

              {showStructureSection ? (
                <section className="space-y-3 border-t border-[color:var(--line-soft)] pt-4">
                  <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                    {props.t("nodeEditing.structureActions")}
                  </div>
                  {props.canRunStructureActions ? (
                    <>
                      <LabeledField label={props.t("nodeEditing.newParentId")}>
                        <select
                          className={inputClass}
                          value={props.moveNodeParent}
                          onChange={(event) => props.onParentChange(event.target.value)}
                        >
                          {props.moveParentOptions.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label}
                            </option>
                          ))}
                        </select>
                      </LabeledField>

                      <div className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                        {props.t("nodeEditing.moveAppendHint")}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className={ghostButtonClass} onClick={props.onDraftMove}>
                          {props.t("nodeEditing.draftMove")}
                        </button>
                        <button className={dangerButtonClass} onClick={props.onDraftDelete}>
                          {props.t("nodeEditing.draftDelete")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm leading-6 text-[color:var(--muted)]">
                      {props.t("nodeEditing.rootStructureLocked")}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
            </>
          ) : (
            <EmptyState
              title={props.t(
                props.hasWorkspace
                  ? "nodeEditing.emptyMeta"
                  : "nodeEditing.workspaceEmptyMeta",
              )}
              body={props.t(
                props.hasWorkspace
                  ? "nodeEditing.emptyBody"
                  : "nodeEditing.workspaceEmptyBody",
              )}
            />
          )}
        </div>

        <div className="mt-5 border-t border-[color:var(--line-soft)] pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[color:var(--text)]">
                {props.t("composer.previewTitle")}
              </div>
              <div className="text-xs text-[color:var(--muted)]">
                {props.t("actions.subtitle")}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {props.patchEditor.trim() ? (
                <button className={ghostButtonClass} onClick={props.onClearPatchEditor}>
                  {props.t("patchEditor.clear")}
                </button>
              ) : null}
              {props.patchEditor.trim() ? (
                <button
                  className={ghostButtonClass}
                  onClick={props.onToggleAdvancedPatchEditor}
                >
                  {props.showAdvancedPatchEditor
                    ? props.t("composer.hideAdvanced")
                    : props.t("composer.showAdvanced")}
                </button>
              ) : null}
            </div>
          </div>

          {props.patchDraftOrigin ? (
            <div className="mb-4">
              <PatchDraftBanner
                title={formatPatchDraftOriginTitle(props.patchDraftOrigin, props.t)}
                meta={formatPatchDraftOriginMeta(props.patchDraftOrigin, props.t)}
                ops={props.patchDraftState.opTypes}
                onOpen={props.onShowDraftOrigin}
                openLabel={props.t("composer.showOriginTrace")}
                tone="neutral"
              />
            </div>
          ) : null}

          {props.patchDraftState.state === "ready" ? (
            <div className="rounded-2xl border border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)] p-4">
              <div className="font-medium text-[color:var(--text)]">
                {props.patchDraftState.summary || props.t("history.noSummary")}
              </div>
              <div className="mt-1 text-sm text-[color:var(--muted)]">
                {props.t("composer.patchOps", {
                  count: props.patchDraftState.opCount,
                })}
              </div>
              {draftLines.length ? (
                <div className="mt-3 space-y-2 text-sm leading-6 text-[color:var(--text)]">
                  {draftLines.map((line, index) => (
                    <div
                      key={`${index}-${line}`}
                      className="rounded-xl border border-[color:var(--line)] bg-white/80 px-3 py-2"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : props.patchDraftState.state === "invalid" ? (
            <div className="rounded-2xl border border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)] p-4">
              <div className="font-medium text-[color:var(--text)]">
                {props.t("composer.invalidPatch")}
              </div>
              <div className="mt-1 text-sm leading-6 text-[color:var(--danger)]">
                {props.patchDraftState.error || props.t("console.empty")}
              </div>
            </div>
          ) : (
            <EmptyState
              title={props.t("composer.emptyTitle")}
              body={props.t("composer.emptyBody")}
            />
          )}

          {props.showAdvancedPatchEditor ? (
            <LabeledField label={props.t("patchEditor.label")} className="mt-4 flex-1">
              <textarea
                className={`${patchTextareaClass} min-h-[16rem]`}
                value={props.patchEditor}
                spellCheck={false}
                onChange={(event) => props.onPatchEditorChange(event.target.value)}
              />
            </LabeledField>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className={primaryButtonClass}
              disabled={
                !props.patchEditor.trim() ||
                props.patchDraftState.state === "invalid"
              }
              onClick={props.onPreviewPatch}
            >
              {props.t("patchEditor.preview")}
            </button>
            <button
              className={ghostButtonClass}
              disabled={
                !props.patchEditor.trim() ||
                props.patchDraftState.state === "invalid"
              }
              onClick={props.onApplyPatch}
            >
              {props.t("patchEditor.apply")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AiDraftStatusCard(props: {
  status: DesktopAiStatus;
  t: Translator;
}) {
  const nextSteps = buildAiDraftNextSteps(props.status, props.t);
  const toneClass =
    props.status.status_error || props.status.has_auth === false
      ? "border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)]"
      : "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)]";
  const sourceLabel =
    props.status.command_source === "override"
      ? props.t("nodeEditing.aiDraftSourceOverride")
      : props.t("nodeEditing.aiDraftSourceDefault");
  const authLabel =
    props.status.has_auth === true
      ? props.t("nodeEditing.aiDraftAuthReady")
      : props.status.has_auth === false
        ? props.t("nodeEditing.aiDraftAuthMissing")
        : props.t("nodeEditing.aiDraftUnknown");
  const processEnvLabel =
    props.status.has_process_env_conflict === true
      ? props.t("nodeEditing.aiDraftEnvDetected")
      : props.status.has_process_env_conflict === false
        ? props.t("nodeEditing.aiDraftEnvClean")
        : props.t("nodeEditing.aiDraftUnknown");
  const shellEnvLabel =
    props.status.has_shell_env_conflict === true
      ? props.t("nodeEditing.aiDraftEnvDetected")
      : props.status.has_shell_env_conflict === false
        ? props.t("nodeEditing.aiDraftEnvClean")
        : props.t("nodeEditing.aiDraftUnknown");

  return (
    <section className={`rounded-xl border px-4 py-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
            {props.t("nodeEditing.aiDraftRoute")}
          </div>
          <div className="text-sm leading-6 text-[color:var(--text)]">
            {props.t("nodeEditing.aiDraftRouteMeta")}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <span className="rounded-full border border-[color:var(--line)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
            {sourceLabel}
          </span>
          {props.status.uses_provider_defaults ? (
            <span className="rounded-full border border-[color:var(--line)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
              {props.t("nodeEditing.aiDraftUsesProviderDefaults")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <StatusField
          label={props.t("nodeEditing.aiDraftProvider")}
          value={props.status.provider || props.t("nodeEditing.aiDraftUnknown")}
        />
        <StatusField
          label={props.t("nodeEditing.aiDraftRunner")}
          value={
            props.status.runner === "custom"
              ? props.t("nodeEditing.aiDraftCustomRunner")
              : props.status.runner
          }
        />
        <StatusField
          label={props.t("nodeEditing.aiDraftModel")}
          value={props.status.model || props.t("nodeEditing.aiDraftUnknown")}
        />
        <StatusField
          label={props.t("nodeEditing.aiDraftReasoning")}
          value={
            props.status.reasoning_effort || props.t("nodeEditing.aiDraftUnknown")
          }
        />
        <StatusField
          label={props.t("nodeEditing.aiDraftAuth")}
          value={authLabel}
        />
        <StatusField
          label={props.t("nodeEditing.aiDraftProcessEnv")}
          value={processEnvLabel}
        />
        <StatusField
          label={props.t("nodeEditing.aiDraftShellEnv")}
          value={shellEnvLabel}
        />
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("nodeEditing.aiDraftCommand")}
        </div>
        <div className="mt-2 break-all rounded-xl border border-[color:var(--line)] bg-white/85 px-3 py-2 text-xs leading-6 text-[color:var(--text)]">
          {props.status.command || props.t("nodeEditing.aiDraftUnknown")}
        </div>
      </div>

      {nextSteps.length ? (
        <div className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
            {props.t("nodeEditing.aiDraftNextTitle")}
          </div>
          <div className="mt-2 space-y-2">
            {nextSteps.map((step) => (
              <div
                key={step}
                className="rounded-xl border border-[color:var(--line)] bg-white/85 px-3 py-2 text-sm leading-6 text-[color:var(--text)]"
              >
                {step}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.status.status_error ? (
        <div className="mt-4 rounded-xl border border-[rgba(180,35,24,0.18)] bg-white/70 px-3 py-2 text-sm leading-6 text-[color:var(--danger)]">
          <div className="font-medium text-[color:var(--text)]">
            {props.t("nodeEditing.aiDraftStatusCheck")}
          </div>
          <div className="mt-1 whitespace-pre-wrap">
            {props.status.status_error}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatusField(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--line-soft)] bg-white/70 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
        {props.label}
      </div>
      <div className="mt-1 text-sm leading-6 text-[color:var(--text)]">
        {props.value}
      </div>
    </div>
  );
}

function TreeBranch(props: {
  treeNode: TreeNode;
  depth: number;
  query: string;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const active = props.selectedNodeId === props.treeNode.node.id;
  const paddingLeft = `${props.depth * 0.85}rem`;
  const showKindBadge = props.treeNode.node.kind !== "topic";

  return (
    <div className="space-y-2">
      <button
        className={[
          "block w-full rounded-xl border px-3 py-2.5 text-left transition",
          active
            ? "border-[rgba(17,24,39,0.14)] bg-white shadow-[0_6px_18px_rgba(15,23,42,0.06)]"
            : "border-transparent bg-transparent hover:border-[color:var(--line-soft)] hover:bg-white/80",
        ].join(" ")}
        style={{ paddingLeft: `calc(${paddingLeft} + 0.75rem)` }}
        onClick={() => props.onSelect(props.treeNode.node.id)}
      >
        <div className="flex items-start gap-3">
          <span
            className={[
              "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border",
              active
                ? "border-[color:var(--accent)] bg-[color:var(--accent)]"
                : "border-[color:var(--line)] bg-white/90",
            ].join(" ")}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className={[
                  "min-w-0 truncate font-medium",
                  active ? "text-[color:var(--accent)]" : "text-[color:var(--text)]",
                ].join(" ")}
              >
                <HighlightedText text={props.treeNode.node.title} query={props.query} />
              </div>
              {showKindBadge ? (
                <span
                  className={[
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                    active
                      ? "border-[rgba(17,24,39,0.14)] bg-[rgba(17,24,39,0.06)] text-[color:var(--accent)]"
                      : "border-[color:var(--line)] bg-white/80 text-[color:var(--muted)]",
                  ].join(" ")}
                >
                  {props.treeNode.node.kind}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </button>

      {props.treeNode.children.length ? (
        <div className="space-y-2">
          {props.treeNode.children.map((child) => (
            <TreeBranch
              key={child.node.id}
              treeNode={child}
              depth={props.depth + 1}
              query={props.query}
              selectedNodeId={props.selectedNodeId}
              onSelect={props.onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HighlightedText(props: { text: string; query: string }) {
  const query = props.query.trim();
  if (!query) {
    return props.text;
  }

  const lowerText = props.text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const start = lowerText.indexOf(lowerQuery);
  if (start === -1) {
    return props.text;
  }

  const end = start + query.length;
  return (
    <>
      {props.text.slice(0, start)}
      <mark className="rounded bg-[rgba(201,140,39,0.24)] px-1 text-inherit">
        {props.text.slice(start, end)}
      </mark>
      {props.text.slice(end)}
    </>
  );
}

function summarizeConsoleMessage(message: string): string {
  const normalized = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return normalized ?? message;
}

function summarizeChunkLabels(
  chunks: NodeDetail["sources"][number]["chunks"],
  t: Translator,
): string {
  const labels = chunks
    .map((chunk) => chunk.label?.trim())
    .filter((label): label is string => Boolean(label))
    .slice(0, 2);

  if (labels.length) {
    return labels.join(" · ");
  }

  return `${t("detail.chunksSection")}: ${chunks.length}`;
}

function CompactNodeDetail(props: {
  detail: NodeDetail;
  aiRuns: AiRunRecord[];
  desktopAiStatus: DesktopAiStatus | null;
  patchDraftOrigin: PatchDraftOrigin | null;
  contextSourceId: string | null;
  t: Translator;
  onSelectSource: (sourceId: string) => void;
  onLoadAiRunPatch: (runId: string) => void;
  onShowAiRunTrace: (run: AiRunRecord) => void;
  onShowAiRunArtifact: (runId: string, kind: "request" | "response" | "metadata") => void;
}) {
  const showKindBadge = props.detail.node.kind !== "topic";
  const childrenSummary = props.detail.children.length
    ? props.detail.children
        .slice(0, 6)
        .map((child) => child.title)
        .join(", ")
    : props.t("detail.none");

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.nodeSection")}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xl font-semibold text-[color:var(--text)]">
            {props.detail.node.title}
          </div>
          {showKindBadge ? (
            <span className="rounded-full border border-[color:var(--line)] bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
              {props.detail.node.kind}
            </span>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("fields.body")}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
          {props.detail.node.body || props.t("detail.noBody")}
        </div>
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.sourcesSection")}
        </div>
        {props.detail.sources.length ? (
          <div className="space-y-2">
            {props.detail.sources.slice(0, 4).map((sourceDetail) => (
              <button
                key={sourceDetail.source.id}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  props.contextSourceId === sourceDetail.source.id
                    ? "border-[rgba(17,24,39,0.18)] bg-white shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
                    : "border-[color:var(--line)] bg-white hover:border-[rgba(17,24,39,0.18)] hover:bg-white/90",
                ].join(" ")}
                onClick={() => props.onSelectSource(sourceDetail.source.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-[color:var(--text)]">
                        {sourceDetail.source.original_name}
                      </div>
                      <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
                        {sourceDetail.source.format}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted)]">
                      {sourceDetail.chunks.length ? (
                        <>
                          {props.t("detail.chunksSection")}: {sourceDetail.chunks.length}
                        </>
                      ) : (
                        props.t("detail.sourceLevelOnly")
                      )}
                    </div>
                    {sourceDetail.chunks.length ? (
                      <div className="mt-2 text-sm leading-6 text-[color:var(--text)]">
                        {summarizeChunkLabels(sourceDetail.chunks, props.t)}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                    {props.t("detail.openSource")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm leading-6 text-[color:var(--muted)]">
            {props.t("detail.noSourceLinks")}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.evidenceSection")}
        </div>
        {props.detail.evidence.length ? (
          <div className="space-y-2">
            {props.detail.evidence.slice(0, 4).map((evidenceDetail) => (
              <button
                key={evidenceDetail.source.id}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  props.contextSourceId === evidenceDetail.source.id
                    ? "border-[rgba(17,24,39,0.18)] bg-white shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
                    : "border-[color:var(--line)] bg-white hover:border-[rgba(17,24,39,0.18)] hover:bg-white/90",
                ].join(" ")}
                onClick={() => props.onSelectSource(evidenceDetail.source.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-[color:var(--text)]">
                        {evidenceDetail.source.original_name}
                      </div>
                      <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
                        {evidenceDetail.source.format}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted)]">
                      {props.t("detail.citedChunks", {
                        count: evidenceDetail.chunks.length,
                      })}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[color:var(--text)]">
                      {summarizeChunkLabels(evidenceDetail.chunks, props.t)}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                    {props.t("detail.openSource")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm leading-6 text-[color:var(--muted)]">
            {props.t("detail.noEvidenceLinks")}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.relationsSection")}
        </div>
        <div className="space-y-1 text-sm leading-6 text-[color:var(--text)]">
          <div>
            {props.t("detail.parent", {
              value: props.detail.parent?.title || props.t("detail.none"),
            })}
          </div>
          <div>
            {props.t("detail.children", {
              value: childrenSummary,
            })}
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.aiRunsSection")}
        </div>
        {props.aiRuns.length ? (
          <div className="space-y-2">
            {props.aiRuns.slice(0, 5).map((run) => {
              const isCurrentDraft = props.patchDraftOrigin?.run_id === run.id;
              const hasAppliedPatch = Boolean(run.patch_run_id);
              const nextSteps = buildAiRunNextSteps(
                run,
                props.desktopAiStatus,
                props.t,
              );
              const statusLabel = formatAiRunStatusLabel(run.status, props.t);
              const statusToneClass =
                run.status === "failed"
                  ? "border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)] text-[color:var(--danger)]"
                  : hasAppliedPatch
                    ? "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)] text-[color:var(--text)]"
                    : "border-[color:var(--line-soft)] bg-white text-[color:var(--muted)]";

              return (
              <div
                key={run.id}
                className={[
                  "rounded-xl border bg-white/80 px-3 py-3",
                  isCurrentDraft
                    ? "border-[rgba(17,24,39,0.18)] shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
                    : "border-[color:var(--line)]",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-[color:var(--text)]">
                        {run.capability}
                        {run.explore_by ? ` / ${run.explore_by}` : ""}
                      </div>
                      <span
                        className={[
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                          statusToneClass,
                        ].join(" ")}
                      >
                        {statusLabel}
                      </span>
                      {isCurrentDraft ? (
                        <span className="rounded-full border border-[rgba(17,24,39,0.18)] bg-[rgba(17,24,39,0.06)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--accent)]">
                          {props.t("detail.currentDraft")}
                        </span>
                      ) : null}
                      {hasAppliedPatch ? (
                        <span className="rounded-full border border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--text)]">
                          {props.t("detail.appliedPatch")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted)]">
                      {formatTimestamp(run.started_at)}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[color:var(--text)]">
                      {run.patch_summary ||
                        run.last_error_message ||
                        props.t("detail.none")}
                    </div>
                    <div className="mt-2 space-y-1 text-xs leading-5 text-[color:var(--muted)]">
                      <div>
                        {run.provider || props.t("detail.none")}
                        {run.model ? ` / ${run.model}` : ""}
                      </div>
                      <div>
                        {props.t("detail.aiRunRetryCount", {
                          count: run.retry_count,
                        })}
                      </div>
                      {hasAppliedPatch ? (
                        <div>
                          {props.t("detail.aiRunLinkedPatch", {
                            value: run.patch_run_id!,
                          })}
                        </div>
                      ) : (
                        <div>{props.t("detail.aiRunPatchPending")}</div>
                      )}
                      {run.last_error_category ? (
                        <div>
                          {props.t("detail.aiRunErrorCategory", {
                            value: run.last_error_category,
                          })}
                        </div>
                      ) : null}
                    </div>
                    {nextSteps.length ? (
                      <div className="mt-3 rounded-lg border border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.06)] px-3 py-3">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
                          {props.t("detail.aiRunNextSteps")}
                        </div>
                        <div className="mt-2 space-y-1 text-sm leading-6 text-[color:var(--text)]">
                          {nextSteps.map((step) => (
                            <div key={`${run.id}-${step}`}>- {step}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--muted)]">
                      {run.dry_run
                        ? props.t("detail.aiRunDryRun")
                        : props.t("detail.aiRunApplied")}
                    </div>
                    <button
                      className={ghostButtonClass}
                      onClick={() => props.onShowAiRunTrace(run)}
                    >
                      {props.t("detail.showAiRunTrace")}
                    </button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className={ghostButtonClass}
                        onClick={() => props.onShowAiRunArtifact(run.id, "request")}
                      >
                        {props.t("detail.showAiRunRequest")}
                      </button>
                      <button
                        className={ghostButtonClass}
                        onClick={() => props.onShowAiRunArtifact(run.id, "response")}
                      >
                        {props.t("detail.showAiRunResponse")}
                      </button>
                      <button
                        className={ghostButtonClass}
                        onClick={() => props.onShowAiRunArtifact(run.id, "metadata")}
                      >
                        {props.t("detail.showAiRunMetadata")}
                      </button>
                    </div>
                    {run.status !== "failed" ? (
                      <button
                        className={ghostButtonClass}
                        onClick={() => props.onLoadAiRunPatch(run.id)}
                      >
                        {hasAppliedPatch
                          ? props.t("detail.loadAppliedPatch")
                          : props.t("detail.loadAiRunPatch")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )})}
          </div>
        ) : (
          <div className="text-sm leading-6 text-[color:var(--muted)]">
            {props.t("detail.noAiRuns")}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[color:var(--line-soft)] bg-white/70 p-3 space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.metaSection")}
        </div>
        <div className="text-sm leading-6 text-[color:var(--muted)]">
          {props.t("detail.nodeMeta", { id: props.detail.node.id })}
        </div>
        <div className="text-sm leading-6 text-[color:var(--muted)]">
          {props.t("detail.createdAt", {
            value: formatTimestamp(props.detail.node.created_at),
          })}
        </div>
        <div className="text-sm leading-6 text-[color:var(--muted)]">
          {props.t("detail.updatedAt", {
            value: formatTimestamp(props.detail.node.updated_at),
          })}
        </div>
      </section>
    </div>
  );
}

function CompactSourceDetail(props: {
  detail: SourceDetail;
  contextNodeId: string | null;
  t: Translator;
  onSelectNode: (nodeId: string) => void;
  onDraftCiteChunk: (chunkId: string) => void;
  onDraftUnciteChunk: (chunkId: string) => void;
}) {
  const linkedNodes = Array.from(
    new Map(
      props.detail.chunks
        .flatMap((chunk) => chunk.linked_nodes)
        .map((node) => [node.id, node]),
    ).values(),
  );
  const evidenceNodes = Array.from(
    new Map(
      props.detail.chunks
        .flatMap((chunk) => chunk.evidence_nodes)
        .map((node) => [node.id, node]),
    ).values(),
  );
  const previewChunks = props.detail.chunks.slice(0, 3);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.sourceSection")}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xl font-semibold text-[color:var(--text)]">
            {props.detail.source.original_name}
          </div>
          <span className="rounded-full border border-[color:var(--line)] bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
            {props.detail.source.format}
          </span>
        </div>
        <div className="break-all text-sm leading-6 text-[color:var(--muted)]">
          {props.detail.source.original_path}
        </div>
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.relationsSection")}
        </div>
        <div className="space-y-1 text-sm leading-6 text-[color:var(--text)]">
          <div>{props.t("detail.chunksSection")}: {props.detail.chunks.length}</div>
          <div>{props.t("detail.nodes", { value: linkedNodes.length })}</div>
          <div>{props.t("detail.evidenceNodes", { value: evidenceNodes.length })}</div>
        </div>
        <div className="text-sm leading-6 text-[color:var(--muted)]">
          {props.contextNodeId
            ? props.t("detail.citationContextReady", { nodeId: props.contextNodeId })
            : props.t("detail.citationContextMissing")}
        </div>
        {linkedNodes.length ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {linkedNodes.slice(0, 6).map((node) => (
              <button
                key={node.id}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition",
                  props.contextNodeId === node.id
                    ? "border-[rgba(17,24,39,0.18)] bg-white text-[color:var(--accent)] shadow-[0_4px_12px_rgba(15,23,42,0.05)]"
                    : "border-[color:var(--line)] bg-white text-[color:var(--text)] hover:border-[rgba(17,24,39,0.18)] hover:bg-white/90",
                ].join(" ")}
                onClick={() => props.onSelectNode(node.id)}
              >
                {node.title}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.chunksSection")}
        </div>
        {previewChunks.length ? (
          <div className="space-y-3">
            {previewChunks.map((chunkDetail) => (
              <div
                key={chunkDetail.chunk.id}
                className="rounded-lg border border-[color:var(--line-soft)] bg-white/75 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[color:var(--text)]">
                      {chunkDetail.chunk.label || props.t("detail.noLabel")}
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                      {props.t("detail.chunkMeta", {
                        ordinal: chunkDetail.chunk.ordinal + 1,
                        start: chunkDetail.chunk.start_line,
                        end: chunkDetail.chunk.end_line,
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <span className="rounded-full border border-[color:var(--line-soft)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
                      {props.t("detail.nodes", {
                        value: chunkDetail.linked_nodes.length,
                      })}
                    </span>
                    <span className="rounded-full border border-[color:var(--line-soft)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
                      {props.t("detail.evidenceNodes", {
                        value: chunkDetail.evidence_nodes.length,
                      })}
                    </span>
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                  {excerptText(chunkDetail.chunk.text, 160)}
                </div>
                {props.contextNodeId ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {chunkDetail.evidence_nodes.some(
                      (node) => node.id === props.contextNodeId,
                    ) ? (
                      <button
                        className={ghostButtonClass}
                        onClick={() => props.onDraftUnciteChunk(chunkDetail.chunk.id)}
                      >
                        {props.t("detail.draftUncite")}
                      </button>
                    ) : (
                      <button
                        className={secondaryButtonClass}
                        onClick={() => props.onDraftCiteChunk(chunkDetail.chunk.id)}
                      >
                        {props.t("detail.draftCite")}
                      </button>
                    )}
                  </div>
                ) : null}
                {chunkDetail.linked_nodes.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {chunkDetail.linked_nodes.slice(0, 3).map((node) => (
                      <button
                        key={node.id}
                        className={[
                          "rounded-full border px-3 py-1 text-xs transition",
                          props.contextNodeId === node.id
                            ? "border-[rgba(17,24,39,0.18)] bg-white text-[color:var(--accent)] shadow-[0_4px_12px_rgba(15,23,42,0.05)]"
                            : "border-[color:var(--line-soft)] bg-white/85 text-[color:var(--muted)] hover:border-[rgba(17,24,39,0.18)] hover:bg-white",
                        ].join(" ")}
                        onClick={() => props.onSelectNode(node.id)}
                      >
                        {node.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {props.detail.chunks.length > previewChunks.length ? (
              <div className="text-xs text-[color:var(--muted)]">
                {props.t("detail.moreChunks", {
                  count: props.detail.chunks.length - previewChunks.length,
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm leading-6 text-[color:var(--muted)]">
            {props.t("detail.noChunks")}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[color:var(--line-soft)] bg-white/70 p-3 space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("detail.metaSection")}
        </div>
        <div className="text-sm leading-6 text-[color:var(--muted)]">
          {props.t("detail.sourceMeta", { id: props.detail.source.id })}
        </div>
        <div className="text-sm leading-6 text-[color:var(--muted)]">
          {props.t("detail.importedAt", {
            value: formatTimestamp(props.detail.source.imported_at),
          })}
        </div>
      </section>
    </div>
  );
}

function excerptText(text: string, limit = 220): string {
  const normalized = text.trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit).trimEnd()}...`;
}

function formatTimestamp(timestampSeconds: number): string {
  const value = new Date(timestampSeconds * 1000);
  if (Number.isNaN(value.getTime())) {
    return String(timestampSeconds);
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
