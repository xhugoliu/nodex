import {
  describePatchOperation,
  type PatchDraftState,
  type Translator,
} from "../app-helpers";
import type {
  ApplyPatchReport,
  DraftReviewPayload,
  NodeWorkspaceContext,
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
  nodeContext: NodeWorkspaceContext | null;
  applyResult: ApplyPatchReport | null;
  updateNodeTitle: string;
  updateNodeBody: string;
  addChildTitle: string;
  addChildBody: string;
  t: Translator;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onAddChildTitleChange: (value: string) => void;
  onAddChildBodyChange: (value: string) => void;
  onSelectNode: (nodeId: string) => void;
  onOpenCreatedNode: (nodeId: string) => void;
  onOpenSource: (sourceId: string) => void;
  onDraftAiExpand: () => void;
  onDraftAiExplore: (by: "risk" | "question" | "action" | "evidence") => void;
  onDraftAddChild: () => void;
  onDraftUpdate: () => void;
}) {
  if (!props.nodeContext) {
    return (
      <section className={`${panelClass} flex min-h-0 flex-col`}>
        <EmptyState
          title={props.t("workbench.nodeEmptyTitle")}
          body={props.t("workbench.nodeEmptyBody")}
        />
      </section>
    );
  }

  const detail = props.nodeContext.node_detail;

  return (
    <section className={`${panelClass} scroll-panel min-h-0 overflow-auto`}>
      <div className="space-y-5">
        {props.applyResult ? (
          <section className="rounded-[1.5rem] border border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.06)] px-5 py-4">
            <div className="space-y-3">
              <div className="text-sm font-medium text-[color:var(--text)]">
                {props.t("workbench.applyResultTitle")}
              </div>
              <div className="text-sm leading-6 text-[color:var(--text)]">
                {props.applyResult.summary || props.t("reports.patchApplied")}
              </div>
              {props.applyResult.created_nodes.length ? (
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
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="space-y-3 rounded-[1.5rem] border border-[color:var(--line-soft)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(249,250,251,0.88))] px-5 py-5">
          <div className="overflow-hidden rounded-[1.25rem] border border-[color:var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,244,246,0.96))]">
            <NodeCanvas
              tree={props.tree}
              selectedNodeId={props.selectedNodeId}
              addChildTitle={props.addChildTitle}
              addChildPlaceholder={props.t("nodeEditing.addChildTitlePlaceholder")}
              draftAddChildLabel={props.t("nodeEditing.draftAddChild")}
              draftAiExpandLabel={props.t("nodeEditing.draftAiExpand")}
              onSelectNode={props.onSelectNode}
              onAddChildTitleChange={props.onAddChildTitleChange}
              onDraftAddChild={props.onDraftAddChild}
              onDraftAiExpand={props.onDraftAiExpand}
            />
          </div>
        </section>

        <section className="space-y-3 rounded-[1.5rem] border border-[color:var(--line-soft)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(249,250,251,0.88))] px-5 py-5">
          <h2
            className="text-3xl font-semibold text-[color:var(--text)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {detail.node.title}
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--text)]">
            {detail.node.body || props.t("detail.noBody")}
          </p>
        </section>

        <section className={`${cardClass} space-y-3`}>
          <div className="flex flex-wrap gap-2">
            <button className={primaryButtonClass} onClick={props.onDraftAiExpand}>
              {props.t("nodeEditing.draftAiExpand")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => props.onDraftAiExplore("question")}
            >
              {props.t("nodeEditing.draftAiExploreQuestion")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => props.onDraftAiExplore("risk")}
            >
              {props.t("nodeEditing.draftAiExploreRisk")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => props.onDraftAiExplore("action")}
            >
              {props.t("nodeEditing.draftAiExploreAction")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => props.onDraftAiExplore("evidence")}
            >
              {props.t("nodeEditing.draftAiExploreEvidence")}
            </button>
          </div>
        </section>

        {detail.children.length ? (
          <section className={`${cardClass} space-y-3`}>
            <div className="text-sm font-medium text-[color:var(--text)]">
              {props.t("workbench.childrenTitle")}
            </div>
            <div className="grid gap-2">
              {detail.children.slice(0, 6).map((child) => (
                <button
                  key={child.id}
                  className="rounded-xl border border-[color:var(--line-soft)] bg-white/85 px-3 py-3 text-left transition hover:border-[rgba(17,24,39,0.18)]"
                  onClick={() => props.onSelectNode(child.id)}
                >
                  <div className="text-sm font-medium text-[color:var(--text)]">
                    {child.title}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-2">
          <div className={`${cardClass} space-y-4`}>
            <div className="text-sm font-medium text-[color:var(--text)]">
              {props.t("workbench.addChildTitle")}
            </div>
            <LabeledField label={props.t("fields.title")}>
              <input
                className={inputClass}
                value={props.addChildTitle}
                placeholder={props.t("nodeEditing.addChildTitlePlaceholder")}
                onChange={(event) => props.onAddChildTitleChange(event.target.value)}
              />
            </LabeledField>
            <LabeledField label={props.t("fields.body")}>
              <textarea
                className={textareaClass}
                value={props.addChildBody}
                onChange={(event) => props.onAddChildBodyChange(event.target.value)}
              />
            </LabeledField>
            <button className={primaryButtonClass} onClick={props.onDraftAddChild}>
              {props.t("nodeEditing.draftAddChild")}
            </button>
          </div>

          <div className={`${cardClass} space-y-4`}>
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
          </div>
        </section>

        <section className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {props.t("workbench.sourcesTitle")}
          </div>
          {detail.sources.length || detail.evidence.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {detail.sources.map((source) => (
                <SourceCard
                  key={`source-${source.source.id}`}
                  title={source.source.original_name}
                  summary={summarizeChunkLabels(source.chunks, props.t)}
                  onClick={() => props.onOpenSource(source.source.id)}
                />
              ))}
              {detail.evidence.map((source) => (
                <SourceCard
                  key={`evidence-${source.source.id}`}
                  title={source.source.original_name}
                  summary={summarizeChunkLabels(source.chunks, props.t)}
                  tone="evidence"
                  onClick={() => props.onOpenSource(source.source.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyBox>{props.t("detail.noSourceLinks")}</EmptyBox>
          )}
        </section>
      </div>
    </section>
  );
}

export function WorkbenchSidePane(props: {
  selectionTab: "context" | "review";
  nodeContext: NodeWorkspaceContext | null;
  selectedSourceDetail: SourceDetail | null;
  selectedSourceChunkId: string | null;
  reviewDraft: DraftReviewPayload | null;
  patchDraftState: PatchDraftState;
  t: Translator;
  onSelectSelectionTab: (tab: "context" | "review") => void;
  onOpenSource: (sourceId: string) => void;
  onBackToNodeContext: () => void;
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
              nodeContext={props.nodeContext}
              t={props.t}
              onOpenSource={props.onOpenSource}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function NodeContextSurface(props: {
  nodeContext: NodeWorkspaceContext | null;
  t: Translator;
  onOpenSource: (sourceId: string) => void;
}) {
  if (!props.nodeContext) {
    return (
      <EmptyState
        title={props.t("workbench.contextEmptyTitle")}
        body={props.t("workbench.contextEmptyBody")}
      />
    );
  }

  const detail = props.nodeContext.node_detail;

  return (
    <div className="space-y-4">
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
                summary={summarizeChunkLabels(source.chunks, props.t)}
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
                summary={summarizeChunkLabels(source.chunks, props.t)}
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
      <div className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
        {props.summary}
      </div>
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

function summarizeChunkLabels(
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
