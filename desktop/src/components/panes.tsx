import { useState } from "react";

import { formatTimestamp, type ConsoleTone, type Translator } from "../app-helpers";
import type { TreeNode, WorkspaceOverview } from "../types";
import {
  EmptyBox,
  EmptyState,
  ghostButtonClass,
  inputClass,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./common";

export function TreePane(props: {
  isCollapsed: boolean;
  defaultRecoveryExpanded?: boolean;
  workspaceOverview: WorkspaceOverview | null;
  treeSummary: string;
  treeQuery: string;
  query: string;
  filteredTree: TreeNode | null;
  selectedNodeId: string | null;
  t: Translator;
  onToggleCollapse: () => void;
  onImportSource: () => void;
  onSaveSnapshot: () => void;
  onRestoreLatestSnapshot: () => void;
  onLoadPatchToReview: (runId: string) => void;
  onQueryChange: (value: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const latestSnapshot = latestWorkspaceSnapshot(props.workspaceOverview);
  const latestPatchRun = latestWorkspacePatchRun(props.workspaceOverview);
  const [isRecoveryExpanded, setIsRecoveryExpanded] = useState(
    props.defaultRecoveryExpanded ?? false,
  );

  if (props.isCollapsed) {
    return (
      <section className={`${panelClass} flex min-h-0 flex-col items-center gap-3 overflow-hidden px-2 py-3`}>
        <SidebarToggleButton
          direction="expand"
          label={props.t("sidebar.expand")}
          onClick={props.onToggleCollapse}
        />

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-2xl border border-[color:var(--line)] bg-white/70 p-3 text-[color:var(--text)] shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
            <TreeGlyph />
          </div>
          {props.workspaceOverview ? (
            <div className="space-y-2">
              <div className="text-xs text-[color:var(--muted)]">
                {props.treeSummary}
              </div>
              {props.selectedNodeId ? (
                <div className="mx-auto max-w-[3.5rem] rounded-xl bg-[color:var(--bg-warm)] px-2 py-2 text-[11px] leading-4 text-[color:var(--text)]">
                  {findSelectedNodeTitle(
                    props.workspaceOverview?.tree ?? null,
                    props.selectedNodeId,
                  ) ?? props.selectedNodeId}
                </div>
              ) : null}
            </div>
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

  return (
    <section className={`${panelClass} flex min-h-0 flex-col overflow-hidden`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[color:var(--text)]">
          {props.t("sidebar.tree")}
        </div>
        <div className="flex items-center gap-2">
          <button className={secondaryButtonClass} onClick={props.onImportSource} type="button">
            {props.t("workspace.importSource")}
          </button>
          <div className="text-xs text-[color:var(--muted)]">{props.treeSummary}</div>
          <SidebarToggleButton
            direction="collapse"
            label={props.t("sidebar.collapse")}
            onClick={props.onToggleCollapse}
          />
        </div>
      </div>

      {props.workspaceOverview ? (
        <div className="flex min-h-0 flex-1 flex-col">
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

          <div className="mt-3">
            {isRecoveryExpanded ? (
              <div className="space-y-3 rounded-2xl border border-[color:var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,244,246,0.86))] px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-[color:var(--text)]">
                    {props.t("sidebar.recovery")}
                  </div>
                  <button
                    className={ghostButtonClass}
                    onClick={() => setIsRecoveryExpanded(false)}
                    type="button"
                  >
                    {props.t("sidebar.recoveryCollapse")}
                  </button>
                </div>
                <div className="text-sm leading-6 text-[color:var(--muted)]">
                  {props.t("sidebar.recoveryBody")}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={secondaryButtonClass}
                    onClick={props.onSaveSnapshot}
                    type="button"
                  >
                    {props.t("sidebar.saveSnapshotButton")}
                  </button>
                  <button
                    className={ghostButtonClass}
                    disabled={!latestSnapshot}
                    onClick={props.onRestoreLatestSnapshot}
                    type="button"
                  >
                    {props.t("sidebar.restoreLatestSnapshot")}
                  </button>
                </div>
                <div className="text-xs leading-6 text-[color:var(--muted)]">
                  {props.t("sidebar.recoveryRestoreNote")}
                </div>

                {latestSnapshot ? (
                  <div className="space-y-3 rounded-xl border border-[color:var(--line-soft)] bg-white/80 px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      {props.t("sidebar.recoveryLatestSnapshot")}
                    </div>
                    <div className="rounded-xl border border-[color:var(--line-soft)] bg-[color:var(--bg-warm)]/55 px-3 py-3">
                      <div className="text-sm leading-6 text-[color:var(--text)]">
                        {latestSnapshot.label ?? props.t("history.noLabel")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--muted)]">
                        <span className="rounded-full bg-white/90 px-2.5 py-1">
                          {formatTimestamp(latestSnapshot.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyBox>{props.t("sidebar.recoveryEmpty")}</EmptyBox>
                )}

                {latestPatchRun ? (
                  <div className="space-y-3 rounded-xl border border-[color:var(--line-soft)] bg-white/80 px-3 py-3">
                    <div className="space-y-1">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted)]">
                        {props.t("sidebar.recoveryLatestPatch")}
                      </div>
                      <div className="text-sm leading-6 text-[color:var(--muted)]">
                        {props.t("sidebar.recoveryLatestPatchBody")}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[color:var(--line-soft)] bg-[color:var(--bg-warm)]/55 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-6 text-[color:var(--text)]">
                            {latestPatchRun.summary ?? latestPatchRun.id}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--muted)]">
                            <span className="rounded-full bg-white/90 px-2.5 py-1">
                              {props.t("detail.activityOrigin", {
                                value: latestPatchRun.origin,
                              })}
                            </span>
                            <span className="rounded-full bg-white/90 px-2.5 py-1">
                              {formatTimestamp(latestPatchRun.applied_at)}
                            </span>
                          </div>
                        </div>
                        <button
                          className={ghostButtonClass}
                          onClick={() => props.onLoadPatchToReview(latestPatchRun.id)}
                          type="button"
                        >
                          {props.t("sidebar.recoveryLoadPatchToReview")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                className={`${secondaryButtonClass} w-full`}
                onClick={() => setIsRecoveryExpanded(true)}
                type="button"
              >
                {props.t("sidebar.recoveryExpand")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          title={props.t("sidebar.treeEmptyTitle")}
          body={props.t("sidebar.treeEmptyBody")}
        />
      )}
    </section>
  );
}

function findSelectedNodeTitle(tree: TreeNode | null, nodeId: string): string | null {
  if (!tree) {
    return null;
  }

  if (tree.node.id === nodeId) {
    return tree.node.title;
  }

  for (const child of tree.children) {
    const title = findSelectedNodeTitle(child, nodeId);
    if (title) {
      return title;
    }
  }

  return null;
}

function latestWorkspaceSnapshot(workspaceOverview: WorkspaceOverview | null) {
  return workspaceOverview?.snapshots.reduce<
    WorkspaceOverview["snapshots"][number] | null
  >(
    (latest, snapshot) =>
      !latest || snapshot.created_at > latest.created_at ? snapshot : latest,
    null,
  ) ?? null;
}

function latestWorkspacePatchRun(workspaceOverview: WorkspaceOverview | null) {
  return workspaceOverview?.patch_history[0] ?? null;
}

function SidebarToggleButton(props: {
  direction: "expand" | "collapse";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={props.label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--line)] bg-white/80 text-[color:var(--text)] shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:bg-white hover:shadow-[0_10px_22px_rgba(15,23,42,0.08)]"
      onClick={props.onClick}
      title={props.label}
      type="button"
    >
      {props.direction === "collapse" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}

function TreeGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="M6 5h12M6 12h7m-7 7h12M6 5v14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="6" cy="5" fill="currentColor" r="1.4" />
      <circle cx="6" cy="12" fill="currentColor" r="1.4" />
      <circle cx="6" cy="19" fill="currentColor" r="1.4" />
      <circle cx="18" cy="5" fill="currentColor" r="1.4" />
      <circle cx="13" cy="12" fill="currentColor" r="1.4" />
      <circle cx="18" cy="19" fill="currentColor" r="1.4" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M9.75 3.5 5.25 8l4.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="m6.25 3.5 4.5 4.5-4.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
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
      <div className="w-full max-w-xl space-y-5 text-center">
        <div className="space-y-3">
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

function TreeBranch(props: {
  treeNode: TreeNode;
  depth: number;
  query: string;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const isSelected = props.selectedNodeId === props.treeNode.node.id;
  const hasChildren = props.treeNode.children.length > 0;

  return (
    <div className="space-y-1">
      <button
        className={[
          "flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition",
          isSelected
            ? "bg-[rgba(17,24,39,0.08)] text-[color:var(--text)]"
            : "text-[color:var(--muted)] hover:bg-white hover:text-[color:var(--text)]",
        ].join(" ")}
        style={{ paddingLeft: `${props.depth * 14 + 12}px` }}
        onClick={() => props.onSelect(props.treeNode.node.id)}
      >
        <span className="mt-1 text-[10px] uppercase tracking-[0.08em]">
          {hasChildren ? props.treeNode.children.length : "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {highlightQuery(props.treeNode.node.title, props.query)}
          </span>
        </span>
      </button>

      {hasChildren ? (
        <div className="space-y-1">
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

function highlightQuery(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return text;
  }

  const normalized = trimmed.toLowerCase();
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(normalized);
  if (index < 0) {
    return text;
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + trimmed.length);
  const after = text.slice(index + trimmed.length);

  return (
    <>
      {before}
      <span className="rounded bg-[rgba(17,24,39,0.08)] px-0.5 text-[color:var(--text)]">
        {match}
      </span>
      {after}
    </>
  );
}
