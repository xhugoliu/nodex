import {
  describePatchOperation,
  type ConsoleTone,
  type PatchDraftState,
  type Translator,
} from "../app-helpers";
import type {
  NodeDetail,
  ParentCandidate,
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
  selectedNodeDetail: NodeDetail | null;
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
              contextSourceId={props.contextSourceId}
              t={props.t}
              onSelectSource={props.onSelectSource}
            />
          ) : props.selectedSourceDetail ? (
            <CompactSourceDetail
              detail={props.selectedSourceDetail}
              contextNodeId={props.contextNodeId}
              t={props.t}
              onSelectNode={props.onSelectNode}
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
  onDraftAddChild: () => void;
  onDraftMove: () => void;
  onDraftDelete: () => void;
  onPreviewPatch: () => void;
  onApplyPatch: () => void;
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
  contextSourceId: string | null;
  t: Translator;
  onSelectSource: (sourceId: string) => void;
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
}) {
  const linkedNodes = Array.from(
    new Map(
      props.detail.chunks
        .flatMap((chunk) => chunk.linked_nodes)
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
                  <span className="shrink-0 rounded-full border border-[color:var(--line-soft)] bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]">
                    {props.t("detail.nodes", {
                      value: chunkDetail.linked_nodes.length,
                    })}
                  </span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                  {excerptText(chunkDetail.chunk.text, 160)}
                </div>
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
