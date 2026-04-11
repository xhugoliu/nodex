import type { ConsoleTone, Translator } from "../app-helpers";
import type { TreeNode, WorkspaceOverview } from "../types";
import {
  EmptyBox,
  EmptyState,
  ghostButtonClass,
  inputClass,
  panelClass,
  primaryButtonClass,
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
