import type { ConsoleTone, PatchDraftState, Translator } from "../app-helpers";
import type { NodeDetail, SourceDetail, TreeNode, WorkspaceOverview } from "../types";
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
          <EmptyBox>{props.t("sidebar.treeEmpty")}</EmptyBox>
        )}
      </div>
    </section>
  );
}

export function InspectorPane(props: {
  selectedNodeDetail: NodeDetail | null;
  selectedSourceDetail: SourceDetail | null;
  contextNodeId: string | null;
  contextSourceId: string | null;
  consoleMessage: string;
  consoleTone: ConsoleTone | null;
  t: Translator;
  onSelectNode: (nodeId: string) => void;
  onSelectSource: (sourceId: string) => void;
}) {
  return (
    <section className={`${panelClass} flex min-h-0 flex-col overflow-hidden`}>
      <SectionHeader title={props.t("detail.title")} />

      <div className="grid min-h-0 flex-1 gap-3 grid-rows-[minmax(0,1fr)_160px]">
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
              title={props.t("detail.emptyMeta")}
              body={props.t("detail.emptyBody")}
            />
          )}
        </div>

        <div className={cardClass}>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
            {props.t("console.title")}
          </div>
          <div
            className={[
              "scroll-panel h-[calc(100%-1.75rem)] overflow-auto rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
              props.consoleTone === "success"
                ? "bg-[rgba(17,24,39,0.04)]"
                : props.consoleTone === "error"
                  ? "bg-[rgba(180,35,24,0.08)]"
                  : "bg-[rgba(17,24,39,0.03)]",
            ].join(" ")}
          >
            {props.consoleMessage}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EditorPane(props: {
  selectedNodeDetail: NodeDetail | null;
  nodeEditMeta: string;
  updateNodeTitle: string;
  updateNodeKind: string;
  updateNodeBody: string;
  moveNodeParent: string;
  moveNodePosition: string;
  patchEditor: string;
  patchDraftState: PatchDraftState;
  t: Translator;
  onTitleChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onParentChange: (value: string) => void;
  onPositionChange: (value: string) => void;
  onPatchEditorChange: (value: string) => void;
  onClearPatchEditor: () => void;
  onDraftUpdate: () => void;
  onDraftAddChild: () => void;
  onDraftMove: () => void;
  onDraftDelete: () => void;
  onPreviewPatch: () => void;
  onApplyPatch: () => void;
}) {
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[color:var(--text)]">
                  {props.selectedNodeDetail.node.title}
                </div>
                <div className="text-[11px] text-[color:var(--muted)]">
                  {props.selectedNodeDetail.node.id}
                </div>
              </div>
              <button className={ghostButtonClass} onClick={props.onClearPatchEditor}>
                {props.t("patchEditor.clear")}
              </button>
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

            <div className="mt-4 border-t border-[color:var(--line-soft)] pt-4">
              <div className="flex flex-wrap gap-2">
                <button className={primaryButtonClass} onClick={props.onDraftUpdate}>
                  {props.t("nodeEditing.draftUpdate")}
                </button>
                <button className={secondaryButtonClass} onClick={props.onDraftAddChild}>
                  {props.t("nodeEditing.draftAddChild")}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <LabeledField label={props.t("nodeEditing.newParentId")}>
                <input
                  className={inputClass}
                  value={props.moveNodeParent}
                  placeholder={props.t("nodeEditing.moveParentPlaceholder")}
                  onChange={(event) => props.onParentChange(event.target.value)}
                />
              </LabeledField>
              <LabeledField label={props.t("nodeEditing.position")}>
                <input
                  className={inputClass}
                  value={props.moveNodePosition}
                  placeholder={props.t("nodeEditing.positionPlaceholder")}
                  onChange={(event) => props.onPositionChange(event.target.value)}
                />
              </LabeledField>
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
          <EmptyBox>{props.nodeEditMeta}</EmptyBox>
        )}

        <div className="mt-4">
          {props.patchDraftState.state === "ready" ? (
            <PatchDraftBanner
              title={props.patchDraftState.summary || props.t("history.noSummary")}
              meta={props.t("composer.patchOps", {
                count: props.patchDraftState.opCount,
              })}
              ops={props.patchDraftState.opTypes}
              tone="success"
            />
          ) : props.patchDraftState.state === "invalid" ? (
            <PatchDraftBanner
              title={props.t("composer.invalidPatch")}
              meta={props.patchDraftState.error || props.t("console.empty")}
              ops={[]}
              tone="error"
            />
          ) : null}
        </div>

        <LabeledField label={props.t("patchEditor.label")} className="mt-4 flex-1">
          <textarea
            className={`${patchTextareaClass} min-h-0 flex-1`}
            value={props.patchEditor}
            spellCheck={false}
            onChange={(event) => props.onPatchEditorChange(event.target.value)}
          />
        </LabeledField>

        <div className="mt-3 border-t border-[color:var(--line-soft)] pt-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
            {props.t("patchEditor.title")}
          </div>
          <div className="flex flex-wrap gap-2">
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
            <div
              className={[
                "truncate font-medium",
                active ? "text-[color:var(--accent)]" : "text-[color:var(--text)]",
              ].join(" ")}
            >
              <HighlightedText text={props.treeNode.node.title} query={props.query} />
            </div>
            <div className="truncate text-xs text-[color:var(--muted)]">
              {props.treeNode.node.kind} · {props.treeNode.node.id}
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

function CompactNodeDetail(props: {
  detail: NodeDetail;
  contextSourceId: string | null;
  t: Translator;
  onSelectSource: (sourceId: string) => void;
}) {
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
          {props.detail.node.id} · {props.detail.node.kind}
        </div>
        <div className="text-xl font-semibold text-[color:var(--text)]">
          {props.detail.node.title}
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
          {props.t("detail.sourcesSection")}
        </div>
        {props.detail.sources.length ? (
          <div className="flex flex-wrap gap-2">
            {props.detail.sources.slice(0, 4).map((sourceDetail) => (
              <button
                key={sourceDetail.source.id}
                className={[
                  "rounded-xl border px-3 py-2 text-left transition",
                  props.contextSourceId === sourceDetail.source.id
                    ? "border-[rgba(17,24,39,0.18)] bg-white shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
                    : "border-[color:var(--line)] bg-white hover:border-[rgba(17,24,39,0.18)] hover:bg-white/90",
                ].join(" ")}
                onClick={() => props.onSelectSource(sourceDetail.source.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[color:var(--text)]">
                      {sourceDetail.source.original_name}
                    </div>
                    <div className="text-xs text-[color:var(--muted)]">
                      {sourceDetail.chunks.length
                        ? props.t("detail.chunksSection") +
                          ": " +
                          String(sourceDetail.chunks.length)
                        : props.t("detail.sourceLevelOnly")}
                    </div>
                  </div>
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
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
          {props.detail.source.id} · {props.detail.source.format}
        </div>
        <div className="text-xl font-semibold text-[color:var(--text)]">
          {props.detail.source.original_name}
        </div>
      </section>

      <section className="rounded-lg bg-[rgba(17,24,39,0.03)] p-3 space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {props.t("fields.body")}
        </div>
        <div className="break-all text-sm leading-6 text-[color:var(--text)]">
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
                <div className="text-sm font-medium text-[color:var(--text)]">
                  {chunkDetail.chunk.label || props.t("detail.noLabel")}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                  {props.t("detail.chunkMeta", {
                    ordinal: chunkDetail.chunk.ordinal + 1,
                    start: chunkDetail.chunk.start_line,
                    end: chunkDetail.chunk.end_line,
                  })}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                  {excerptText(chunkDetail.chunk.text)}
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
