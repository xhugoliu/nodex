import { useEffect, useState } from "react";

import {
  describePatchOperation,
  type PatchDraftState,
  type Translator,
} from "../app-helpers";
import type {
  ApplyPatchReport,
  DraftReviewPayload,
  NodeEvidenceDetail,
  NodeSourceDetail,
  NodeWorkspaceContext,
  SourceChunkRecord,
  SourceChunkDetail,
  SourceDetail,
  TreeNode,
} from "../types";
import {
  cardClass,
  EmptyBox,
  EmptyState,
  ghostButtonClass,
  inputClass,
  LabeledField,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
} from "./common";
import { NodeCanvas } from "./node-canvas";

export function WorkbenchMainPane(props: {
  tree: TreeNode | null;
  selectedNodeId: string | null;
  canvasViewport: {
    x: number;
    y: number;
    zoom: number;
  };
  canvasFollowSelection: boolean;
  canvasFocusMode: "all" | "selection";
  collapsedNodeIds: string[];
  addChildTitle: string;
  t: Translator;
  onAddChildTitleChange: (value: string) => void;
  onCanvasViewportChange: (viewport: {
    x: number;
    y: number;
    zoom: number;
  }) => void;
  onCanvasFollowSelectionChange: (followSelection: boolean) => void;
  onCanvasFocusModeChange: (focusMode: "all" | "selection") => void;
  onCanvasToggleCollapse: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onDraftAiExpand: () => void;
  onDraftAiExplore: (by: "risk" | "question" | "action" | "evidence") => void;
  onDraftAddChild: () => void;
}) {
  if (!props.tree) {
    return (
      <section className={`${panelClass} flex min-h-0 flex-col`}>
        <EmptyState
          title={props.t("workbench.nodeEmptyTitle")}
          body={props.t("workbench.nodeEmptyBody")}
        />
      </section>
    );
  }

  return (
    <section className={`${panelClass} min-h-0 overflow-hidden p-3`}>
      <div className="h-full overflow-hidden rounded-[1.25rem] border border-[color:var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,244,246,0.96))]">
        <NodeCanvas
          tree={props.tree}
          selectedNodeId={props.selectedNodeId}
          viewport={props.canvasViewport}
          followSelection={props.canvasFollowSelection}
          focusMode={props.canvasFocusMode}
          collapsedNodeIds={props.collapsedNodeIds}
          addChildTitle={props.addChildTitle}
          addChildPlaceholder={props.t("nodeEditing.addChildTitlePlaceholder")}
          draftAddChildLabel={props.t("nodeEditing.draftAddChild")}
          draftAiExpandLabel={props.t("nodeEditing.draftAiExpand")}
          draftAiExploreQuestionLabel={props.t("nodeEditing.draftAiExploreQuestion")}
          draftAiExploreRiskLabel={props.t("nodeEditing.draftAiExploreRisk")}
          draftAiExploreActionLabel={props.t("nodeEditing.draftAiExploreAction")}
          draftAiExploreEvidenceLabel={props.t("nodeEditing.draftAiExploreEvidence")}
          collapseNodeLabel={props.t("workbench.collapseNode")}
          expandNodeLabel={props.t("workbench.expandNode")}
          focusAllLabel={props.t("workbench.canvasFocusAll")}
          focusSelectionLabel={props.t("workbench.canvasFocusSelection")}
          followSelectionLabel={props.t("workbench.canvasFollowSelection")}
          resetViewLabel={props.t("workbench.canvasResetView")}
          onSelectNode={props.onSelectNode}
          onAddChildTitleChange={props.onAddChildTitleChange}
          onViewportChange={props.onCanvasViewportChange}
          onFollowSelectionChange={props.onCanvasFollowSelectionChange}
          onFocusModeChange={props.onCanvasFocusModeChange}
          onToggleCollapse={props.onCanvasToggleCollapse}
          onDraftAddChild={props.onDraftAddChild}
          onDraftAiExpand={props.onDraftAiExpand}
          onDraftAiExplore={props.onDraftAiExplore}
        />
      </div>
    </section>
  );
}

export function WorkbenchSidePane(props: {
  selectionTab: "context" | "review";
  nodeContext: NodeWorkspaceContext | null;
  applyResult: ApplyPatchReport | null;
  updateNodeTitle: string;
  updateNodeBody: string;
  selectedSourceDetail: SourceDetail | null;
  selectedSourceChunkId: string | null;
  reviewDraft: DraftReviewPayload | null;
  patchDraftState: PatchDraftState;
  t: Translator;
  onSelectSelectionTab: (tab: "context" | "review") => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onOpenSource: (sourceId: string) => void;
  onOpenCreatedNode: (nodeId: string) => void;
  onBackToNodeContext: () => void;
  onDraftUpdate: () => void;
  onPreviewPatch: () => void;
  onApplyPatch: () => void;
}) {
  return (
    <section className={`${panelClass} min-h-0 overflow-hidden`}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-4 flex gap-2">
          <button
            className={tabButtonClass(props.selectionTab === "context")}
            onClick={() => props.onSelectSelectionTab("context")}
          >
            {props.t("workbench.contextTab")}
          </button>
          <button
            className={tabButtonClass(props.selectionTab === "review")}
            onClick={() => props.onSelectSelectionTab("review")}
          >
            {props.t("workbench.reviewTab")}
          </button>
        </div>

        <div className="scroll-panel min-h-0 flex-1 overflow-auto">
          {props.selectionTab === "review" ? (
            <ReviewSurface
              reviewDraft={props.reviewDraft}
              patchDraftState={props.patchDraftState}
              t={props.t}
              onPreviewPatch={props.onPreviewPatch}
              onApplyPatch={props.onApplyPatch}
            />
          ) : props.selectedSourceDetail ? (
            <SourceContextSurface
              detail={props.selectedSourceDetail}
              selectedSourceChunkId={props.selectedSourceChunkId}
              t={props.t}
              onBackToNodeContext={props.onBackToNodeContext}
            />
          ) : (
            <NodeContextSurface
              applyResult={props.applyResult}
              nodeContext={props.nodeContext}
              updateNodeTitle={props.updateNodeTitle}
              updateNodeBody={props.updateNodeBody}
              t={props.t}
              onTitleChange={props.onTitleChange}
              onBodyChange={props.onBodyChange}
              onOpenSource={props.onOpenSource}
              onOpenCreatedNode={props.onOpenCreatedNode}
              onDraftUpdate={props.onDraftUpdate}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function NodeContextSurface(props: {
  applyResult: ApplyPatchReport | null;
  nodeContext: NodeWorkspaceContext | null;
  updateNodeTitle: string;
  updateNodeBody: string;
  t: Translator;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onOpenSource: (sourceId: string) => void;
  onOpenCreatedNode: (nodeId: string) => void;
  onDraftUpdate: () => void;
}) {
  const [isEditOpen, setIsEditOpen] = useState(false);

  useEffect(() => {
    setIsEditOpen(false);
  }, [props.nodeContext?.node_detail.node.id]);

  if (!props.nodeContext) {
    return (
      <EmptyState
        title={props.t("workbench.contextEmptyTitle")}
        body={props.t("workbench.contextEmptyBody")}
      />
    );
  }

  const detail = props.nodeContext.node_detail;
  const applyPreviewLines = props.applyResult?.preview.length
    ? props.applyResult.preview
    : [props.applyResult?.summary || props.t("reports.patchApplied")];
  const visibleApplyPreviewLines = applyPreviewLines.slice(0, 3);
  const hiddenApplyPreviewCount = Math.max(
    applyPreviewLines.length - visibleApplyPreviewLines.length,
    0,
  );
  const focusMovedToCreatedNode = Boolean(
    props.applyResult?.created_nodes.some((node) => node.id === detail.node.id),
  );
  const nextActionKey = props.applyResult?.created_nodes.length
    ? "workbench.applyResultNextCreated"
    : detail.sources.length || detail.evidence.length
      ? "workbench.applyResultNextWithSources"
      : detail.children.length
        ? "workbench.applyResultNextWithChildren"
        : "workbench.applyResultNextDefault";

  return (
    <div className="space-y-4">
      {props.applyResult ? (
        <section className="rounded-[1.5rem] border border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.06)] px-4 py-4">
          <div className="space-y-4">
            <div className="text-sm font-medium text-[color:var(--text)]">
              {props.t("workbench.applyResultTitle")}
            </div>
            <div className="text-sm leading-6 text-[color:var(--text)]">
              {props.applyResult.summary || props.t("reports.patchApplied")}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted)]">
                {props.t("workbench.applyResultChangedLabel")}
              </div>
              <div className="space-y-2">
                {visibleApplyPreviewLines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className="rounded-xl border border-[rgba(15,118,110,0.14)] bg-white/85 px-3 py-3 text-sm leading-6 text-[color:var(--text)]"
                  >
                    {line}
                  </div>
                ))}
                {hiddenApplyPreviewCount ? (
                  <div className="text-xs text-[color:var(--muted)]">
                    {props.t("workbench.applyResultMoreChanges", {
                      count: hiddenApplyPreviewCount,
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            {props.applyResult.created_nodes.length ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  {props.t("workbench.applyResultCreatedNodesLabel")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {props.applyResult.created_nodes.map((node) => (
                    <button
                      key={node.id}
                      className={ghostButtonClass}
                      onClick={() => props.onOpenCreatedNode(node.id)}
                    >
                      {node.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted)]">
                {props.t("workbench.applyResultFocusLabel")}
              </div>
              <div className="text-sm leading-6 text-[color:var(--text)]">
                {focusMovedToCreatedNode
                  ? props.t("workbench.applyResultFocusNewNode", {
                      title: detail.node.title,
                    })
                  : props.t("workbench.applyResultFocusCurrentNode", {
                      title: detail.node.title,
                    })}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted)]">
                {props.t("workbench.applyResultNextLabel")}
              </div>
              <div className="text-sm leading-6 text-[color:var(--text)]">
                {props.t(nextActionKey)}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={`${cardClass} space-y-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div
              className="text-xl font-semibold text-[color:var(--text)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {detail.node.title}
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-[color:var(--muted)]">
              <span className="rounded-full bg-[color:var(--bg-warm)] px-2.5 py-1">
                {detail.node.kind}
              </span>
              <span className="rounded-full bg-[color:var(--bg-warm)] px-2.5 py-1">
                {props.t("workbench.childrenStat", {
                  count: detail.children.length,
                })}
              </span>
              <span className="rounded-full bg-[color:var(--bg-warm)] px-2.5 py-1">
                {props.t("workbench.sourcesStat", {
                  count: detail.sources.length + detail.evidence.length,
                })}
              </span>
            </div>
          </div>
          <button
            className={ghostButtonClass}
            onClick={() => setIsEditOpen((current) => !current)}
          >
            {isEditOpen
              ? props.t("workbench.editNodeClose")
              : props.t("workbench.editNodeOpen")}
          </button>
        </div>
        <p className="text-sm leading-7 text-[color:var(--text)]">
          {detail.node.body
            ? clipText(detail.node.body, 220)
            : props.t("detail.noBody")}
        </p>
      </section>

      {isEditOpen ? (
        <section className={`${cardClass} space-y-4`}>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {props.t("workbench.editNodeTitle")}
          </div>
          <LabeledField label={props.t("fields.title")}>
            <input
              className={inputClass}
              value={props.updateNodeTitle}
              onChange={(event) => props.onTitleChange(event.target.value)}
            />
          </LabeledField>
          <LabeledField label={props.t("fields.body")}>
            <textarea
              className={textareaClass}
              value={props.updateNodeBody}
              onChange={(event) => props.onBodyChange(event.target.value)}
            />
          </LabeledField>
          <button className={secondaryButtonClass} onClick={props.onDraftUpdate}>
            {props.t("nodeEditing.draftUpdate")}
          </button>
        </section>
      ) : null}

      {detail.sources.length ? (
        <section className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {props.t("detail.sourcesSection")}
          </div>
          <div className="space-y-2">
            {detail.sources.map((source) => (
              <SourceCard
                key={source.source.id}
                title={source.source.original_name}
                summary={summarizeSourceReason(source, props.t)}
                meta={summarizeChunkMeta(source.chunks, props.t)}
                onClick={() => props.onOpenSource(source.source.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {detail.evidence.length ? (
        <section className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {props.t("detail.evidenceSection")}
          </div>
          <div className="space-y-2">
            {detail.evidence.map((source) => (
              <SourceCard
                key={source.source.id}
                title={source.source.original_name}
                summary={summarizeEvidenceReason(source, props.t)}
                meta={summarizeChunkMeta(source.chunks, props.t)}
                tone="evidence"
                onClick={() => props.onOpenSource(source.source.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!detail.sources.length && !detail.evidence.length ? (
        <EmptyBox>{props.t("detail.noSourceLinks")}</EmptyBox>
      ) : null}
    </div>
  );
}

function SourceContextSurface(props: {
  detail: SourceDetail;
  selectedSourceChunkId: string | null;
  t: Translator;
  onBackToNodeContext: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className={`${cardClass} space-y-3`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-[color:var(--text)]">
            {props.detail.source.original_name}
          </div>
          <button className={ghostButtonClass} onClick={props.onBackToNodeContext}>
            {props.t("workbench.backToNode")}
          </button>
        </div>
      </section>

      {props.detail.chunks.length ? (
        <div className="space-y-3">
          {props.detail.chunks.map((chunk) => (
            <SourceChunkCard
              key={chunk.chunk.id}
              detail={chunk}
              selected={props.selectedSourceChunkId === chunk.chunk.id}
              t={props.t}
            />
          ))}
        </div>
      ) : (
        <EmptyBox>{props.t("detail.noChunks")}</EmptyBox>
      )}
    </div>
  );
}

function ReviewSurface(props: {
  reviewDraft: DraftReviewPayload | null;
  patchDraftState: PatchDraftState;
  t: Translator;
  onPreviewPatch: () => void;
  onApplyPatch: () => void;
}) {
  if (props.patchDraftState.state === "empty") {
    return (
      <EmptyState
        title={props.t("composer.emptyTitle")}
        body={props.t("composer.emptyBody")}
      />
    );
  }

  if (props.patchDraftState.state === "invalid") {
    return (
      <div className="rounded-2xl border border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)] px-4 py-4 text-sm leading-6 text-[color:var(--danger)]">
        {props.patchDraftState.error || props.t("composer.invalidPatch")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className={`${cardClass} space-y-3`}>
        <div className="flex gap-2">
          <button className={secondaryButtonClass} onClick={props.onPreviewPatch}>
            {props.t("patchEditor.preview")}
          </button>
          <button className={primaryButtonClass} onClick={props.onApplyPatch}>
            {props.t("patchEditor.apply")}
          </button>
        </div>
      </section>

      {props.reviewDraft?.explanation.rationale_summary ? (
        <section className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {props.t("detail.runInspectorRationale")}
          </div>
          <p className="text-sm leading-7 text-[color:var(--text)]">
            {props.reviewDraft.explanation.rationale_summary}
          </p>
        </section>
      ) : null}

      {props.reviewDraft?.explanation.direct_evidence.length ? (
        <section className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {props.t("detail.runInspectorDirectEvidence")}
          </div>
          <div className="space-y-2">
            {props.reviewDraft.explanation.direct_evidence.map((item) => (
              <div
                key={`${item.chunk_id}-${item.start_line}`}
                className="rounded-xl border border-[color:var(--line-soft)] bg-white/85 px-3 py-3"
              >
                <div className="text-sm font-medium text-[color:var(--text)]">
                  {item.source_name}
                </div>
                <div className="mt-1 text-xs text-[color:var(--muted)]">
                  {item.start_line}-{item.end_line}
                </div>
                <div className="mt-2 text-sm leading-6 text-[color:var(--text)]">
                  {item.why_it_matters}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={`${cardClass} space-y-3`}>
        <div className="text-sm font-medium text-[color:var(--text)]">
          {props.t("detail.runInspectorPatchPreview")}
        </div>
        <div className="space-y-2">
          {props.patchDraftState.ops.map((op, index) => (
            <div
              key={`${op.type ?? "op"}-${index}`}
              className="rounded-xl border border-[color:var(--line-soft)] bg-white/85 px-3 py-3 text-sm leading-6 text-[color:var(--text)]"
            >
              {describePatchOperation(op, props.t)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SourceCard(props: {
  title: string;
  summary: string;
  meta: string;
  tone?: "neutral" | "evidence";
  onClick: () => void;
}) {
  const toneClass =
    props.tone === "evidence"
      ? "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.06)]"
      : "border-[color:var(--line-soft)] bg-white/85";

  return (
    <button
      className={`w-full rounded-xl border px-3 py-3 text-left transition hover:border-[rgba(17,24,39,0.18)] ${toneClass}`}
      onClick={props.onClick}
    >
      <div className="text-sm font-medium text-[color:var(--text)]">{props.title}</div>
      <div className="mt-1 text-sm leading-6 text-[color:var(--text)]">{props.summary}</div>
      <div className="mt-2 text-xs text-[color:var(--muted)]">{props.meta}</div>
    </button>
  );
}

function SourceChunkCard(props: {
  detail: SourceChunkDetail;
  selected: boolean;
  t: Translator;
}) {
  return (
    <div
      className={[
        cardClass,
        props.selected
          ? "border-[rgba(17,24,39,0.18)] shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
          : "",
      ].join(" ")}
    >
      <div className="space-y-2">
        <div className="text-sm font-medium text-[color:var(--text)]">
          {props.detail.chunk.label || props.t("detail.noLabel")}
        </div>
        <div className="text-xs text-[color:var(--muted)]">
          {props.t("detail.chunkMeta", {
            ordinal: props.detail.chunk.ordinal + 1,
            start: props.detail.chunk.start_line,
            end: props.detail.chunk.end_line,
          })}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
          {clipText(props.detail.chunk.text, 360)}
        </div>
      </div>
    </div>
  );
}

function summarizeChunkMeta(
  chunks: Array<{ label: string | null; start_line: number; end_line: number }>,
  t: Translator,
): string {
  if (!chunks.length) {
    return t("detail.sourceLevelOnly");
  }

  return chunks
    .slice(0, 2)
    .map((chunk) => chunk.label || `${chunk.start_line}-${chunk.end_line}`)
    .join(" · ");
}

function summarizeSourceReason(detail: NodeSourceDetail, t: Translator): string {
  const chunk = pickRepresentativeChunk(detail.chunks);
  const label = chunk?.label?.trim() || "";
  const snippet = chunk ? summarizeChunkText(chunk.text) : "";
  const value =
    label && snippet && !snippet.toLowerCase().startsWith(label.toLowerCase())
      ? `${label}: ${snippet}`
      : snippet || label;

  return value
    ? t("detail.sourceWorthReading", { value })
    : t("detail.sourceWorthReadingFallback");
}

function summarizeEvidenceReason(detail: NodeEvidenceDetail, t: Translator): string {
  const rationale = detail.citations
    .map((citation) => citation.rationale?.trim() || "")
    .find(Boolean);

  if (rationale) {
    return t("detail.evidenceWorthReading", {
      value: clipText(normalizeInlineText(rationale), 150),
    });
  }

  const chunk = pickRepresentativeChunk(detail.chunks);
  const label = chunk?.label?.trim() || "";
  const snippet = chunk ? summarizeChunkText(chunk.text) : "";
  const value =
    label && snippet && !snippet.toLowerCase().startsWith(label.toLowerCase())
      ? `${label}: ${snippet}`
      : snippet || label;

  return value
    ? t("detail.evidenceWorthReading", { value })
    : t("detail.evidenceWorthReadingFallback");
}

function pickRepresentativeChunk(chunks: SourceChunkRecord[]): SourceChunkRecord | null {
  if (!chunks.length) {
    return null;
  }

  return (
    chunks.find((chunk) => summarizeChunkText(chunk.text).length >= 48) ||
    chunks.find((chunk) => normalizeInlineText(chunk.text)) ||
    chunks[0]
  );
}

function summarizeChunkText(text: string): string {
  const normalized = normalizeInlineText(text);
  if (!normalized) {
    return "";
  }

  const sentences = normalized.split(/(?<=[.!?。！？])\s+/);
  const candidate =
    sentences.find((sentence) => sentence.length >= 48) ||
    sentences[0] ||
    normalized;

  return clipText(candidate, 120);
}

function normalizeInlineText(text: string): string {
  return text
    .replace(/\r?\n+/g, " ")
    .replace(/^\s*[-*#>\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clipText(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit).trimEnd()}...`;
}

function tabButtonClass(active: boolean): string {
  return active ? primaryButtonClass : ghostButtonClass;
}
