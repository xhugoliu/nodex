import type { ApplyPatchReport, TreeNode } from "./types";

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
  error: string | null;
}

export function renderPatchReport(
  report: ApplyPatchReport,
  dryRun: boolean,
  t: Translator,
) {
  return [
    dryRun ? t("reports.patchPreviewSucceeded") : t("reports.patchApplied"),
    report.summary ? t("reports.summary", { value: report.summary }) : null,
    ...report.preview.map((line) => `- ${line}`),
    report.run_id ? t("reports.runId", { id: report.run_id }) : null,
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
  return [
    treeNode.id,
    treeNode.title,
    treeNode.kind,
    treeNode.body ?? "",
  ].some((field) => field.toLowerCase().includes(normalizedQuery));
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
      error: null,
    };
  }

  try {
    const patch = JSON.parse(trimmed) as {
      summary?: unknown;
      ops?: unknown;
    };
    const ops = Array.isArray(patch.ops) ? patch.ops : [];
    const counts = new Map<string, number>();

    for (const op of ops) {
      const type =
        op &&
        typeof op === "object" &&
        "type" in op &&
        typeof op.type === "string"
          ? op.type
          : "op";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return {
      state: "ready",
      summary: typeof patch.summary === "string" ? patch.summary : null,
      opCount: ops.length,
      opTypes: Array.from(counts, ([type, count]) => ({ type, count })),
      error: null,
    };
  } catch (error) {
    return {
      state: "invalid",
      summary: null,
      opCount: 0,
      opTypes: [],
      error: formatError(error),
    };
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
