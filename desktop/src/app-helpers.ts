import type {
  ApplyPatchReport,
  ExternalRunnerReport,
  ParentCandidate,
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

export function renderExternalRunnerReport(
  result: ExternalRunnerReport,
  t: Translator,
) {
  return [
    t("reports.aiDraftReady"),
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
