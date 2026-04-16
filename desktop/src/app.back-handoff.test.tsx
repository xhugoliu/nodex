import assert from "node:assert/strict";
import { test } from "node:test";

import { act } from "react";
import ReactDOM from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import App, { type AppBindings } from "./App";
import { WorkbenchSidePane } from "./components/workbench";
import type {
  ApplyReviewedPatchOutput,
  DesktopAiStatus,
  DraftReviewPayload,
  NodeWorkspaceContext,
  PatchDocument,
  SourceDetail,
  SourceImportOutput,
  WorkspaceOverview,
} from "./types";

type TreePaneProps = Parameters<AppBindings["TreePane"]>[0];
type MainPaneProps = Parameters<AppBindings["WorkbenchMainPane"]>[0];
type SidePaneProps = Parameters<AppBindings["WorkbenchSidePane"]>[0];

class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  ownerDocument: FakeDocument;
  nodeType: number;
  nodeName: string;

  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  appendChild(child: FakeNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode = this;
    if (!before) {
      this.childNodes.push(child);
      return child;
    }

    const index = this.childNodes.indexOf(before);
    if (index === -1) {
      this.childNodes.push(child);
      return child;
    }

    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: FakeNode) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) {
      this.appendChild(new FakeText(value, this.ownerDocument));
    }
  }
}

class FakeText extends FakeNode {
  data: string;

  constructor(data: string, ownerDocument: FakeDocument) {
    super(3, "#text", ownerDocument);
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }
}

class FakeComment extends FakeNode {
  data: string;

  constructor(data: string, ownerDocument: FakeDocument) {
    super(8, "#comment", ownerDocument);
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }
}

class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  namespaceURI = "http://www.w3.org/1999/xhtml";

  constructor(tagName: string, ownerDocument: FakeDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  setAttributeNS(_ns: string, name: string, value: string) {
    this.setAttribute(name, value);
  }

  removeAttributeNS(_ns: string, name: string) {
    this.removeAttribute(name);
  }

  addEventListener() {}

  removeEventListener() {}

  get tagName() {
    return this.nodeName;
  }
}

class FakeHtmlIFrameElement extends FakeElement {}

class FakeDocument extends FakeNode {
  documentElement: FakeElement;
  body: FakeElement;
  defaultView: FakeWindow | null = null;
  title = "";

  constructor() {
    super(9, "#document", null as never);
    this.ownerDocument = this;
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }

  createElementNS(_ns: string, tagName: string) {
    return new FakeElement(tagName, this);
  }

  createTextNode(data: string) {
    return new FakeText(data, this);
  }

  createComment(data: string) {
    return new FakeComment(data, this);
  }

  addEventListener() {}

  removeEventListener() {}
}

class FakeStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

class FakeWindow {
  document: FakeDocument;
  localStorage = new FakeStorage();
  __TAURI_INTERNALS__ = {};
  Element = FakeElement;
  HTMLElement = FakeElement;
  SVGElement = FakeElement;
  HTMLIFrameElement = FakeHtmlIFrameElement;
  Node = FakeNode;
  Document = FakeDocument;
  private listeners = new Map<string, Set<() => void>>();

  constructor(document: FakeDocument) {
    this.document = document;
  }

  addEventListener(name: string, listener: () => void) {
    const current = this.listeners.get(name) ?? new Set<() => void>();
    current.add(listener);
    this.listeners.set(name, current);
  }

  removeEventListener(name: string, listener: () => void) {
    this.listeners.get(name)?.delete(listener);
  }

  dispatchLanguageChange() {
    for (const listener of this.listeners.get("languagechange") ?? []) {
      listener();
    }
  }
}

function installFakeDom() {
  const document = new FakeDocument();
  const window = new FakeWindow(document);
  document.defaultView = window;

  Object.assign(globalThis, {
    window,
    document,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeElement,
    HTMLIFrameElement: FakeHtmlIFrameElement,
    Comment: FakeComment,
    Text: FakeText,
    Document: FakeDocument,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US" },
  });

  return {
    container: document.createElement("div"),
    cleanup() {
      delete (globalThis as Record<string, unknown>).window;
      delete (globalThis as Record<string, unknown>).document;
      delete (globalThis as Record<string, unknown>).navigator;
    },
  };
}

function makeOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "node-1",
            parent_id: "root",
            title: "Authentication",
            body: null,
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
        {
          node: {
            id: "node-2",
            parent_id: "root",
            title: "Operations",
            body: null,
            kind: "topic",
            position: 1,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeImportedOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "imported-root",
            parent_id: "root",
            title: "Imported Source Root",
            body: "Imported body",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeImportedNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "imported-root",
        parent_id: "root",
        title: "Imported Source Root",
        body: "Imported body",
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "root", title: "Root" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeGeneratedOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "imported-root",
            parent_id: "root",
            title: "Imported Source Root",
            body: "Imported body",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [
            {
              node: {
                id: "generated-node",
                parent_id: "imported-root",
                title: "Generated Follow-up Branch",
                body: "Generated body",
                kind: "action",
                position: 0,
                created_at: 1710000000,
                updated_at: 1710000000,
              },
              children: [],
            },
          ],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeGeneratedNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-node",
        parent_id: "imported-root",
        title: "Generated Follow-up Branch",
        body: "Generated body",
        kind: "action",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "imported-root", title: "Imported Source Root" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeNodeGeneratedOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "node-1",
            parent_id: "root",
            title: "Authentication",
            body: "Current auth routing notes",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [
            {
              node: {
                id: "generated-node",
                parent_id: "node-1",
                title: "Authentication Follow-up",
                body: "Generated follow-up body",
                kind: "action",
                position: 0,
                created_at: 1710000000,
                updated_at: 1710000000,
              },
              children: [],
            },
          ],
        },
        {
          node: {
            id: "node-2",
            parent_id: "root",
            title: "Operations",
            body: null,
            kind: "topic",
            position: 1,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeNodeGeneratedContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-node",
        parent_id: "node-1",
        title: "Authentication Follow-up",
        body: "Generated follow-up body",
        kind: "action",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "node-1", title: "Authentication" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeUpdatedNodeOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "node-1",
            parent_id: "root",
            title: "Authentication Updated",
            body: "Current auth routing notes with one local revision",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000001,
          },
          children: [],
        },
        {
          node: {
            id: "node-2",
            parent_id: "root",
            title: "Operations",
            body: null,
            kind: "topic",
            position: 1,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeUpdatedNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "node-1",
        parent_id: "root",
        title: "Authentication Updated",
        body: "Current auth routing notes with one local revision",
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000001,
      },
      parent: { id: "root", title: "Root" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeUpdateNodePatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Update Authentication title",
    ops: [
      {
        type: "update_node",
        id: "node-1",
        title: "Authentication Updated",
        body: "Current auth routing notes with one local revision",
        kind: null,
      },
    ],
  };
}

function makeUpdateNodeApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-update",
      summary: "Applied Authentication update",
      preview: ["Updated node-1 title and body"],
      created_nodes: [],
    },
    overview: makeUpdatedNodeOverview(),
    preferred_focus_node_id: "node-1",
    focus_node_context: makeUpdatedNodeContext(),
  };
}

function makeUpdatedGeneratedNodeOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "imported-root",
            parent_id: "root",
            title: "Imported Source Root",
            body: "Imported body",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [
            {
              node: {
                id: "generated-node",
                parent_id: "imported-root",
                title: "Generated Follow-up Branch Revised",
                body: "Generated body with one local revision",
                kind: "action",
                position: 0,
                created_at: 1710000000,
                updated_at: 1710000001,
              },
              children: [],
            },
          ],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeUpdatedGeneratedNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-node",
        parent_id: "imported-root",
        title: "Generated Follow-up Branch Revised",
        body: "Generated body with one local revision",
        kind: "action",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000001,
      },
      parent: { id: "imported-root", title: "Imported Source Root" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeUpdateGeneratedNodePatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Update Generated Follow-up Branch title",
    ops: [
      {
        type: "update_node",
        id: "generated-node",
        title: "Generated Follow-up Branch Revised",
        body: "Generated body with one local revision",
        kind: null,
      },
    ],
  };
}

function makeUpdateGeneratedNodeApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-update-generated",
      summary: "Applied generated branch update",
      preview: ["Updated generated-node title and body"],
      created_nodes: [],
    },
    overview: makeUpdatedGeneratedNodeOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeUpdatedGeneratedNodeContext(),
  };
}

function makeGeneratedNodeContextWithSource(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-node",
        parent_id: "imported-root",
        title: "Generated Follow-up Branch",
        body: "Generated body",
        kind: "action",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "imported-root", title: "Imported Source Root" },
      children: [],
      sources: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [],
        },
      ],
      evidence: [],
    },
  };
}

function makeGeneratedNodeContextWithEvidence(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-node",
        parent_id: "imported-root",
        title: "Generated Follow-up Branch",
        body: "Generated body",
        kind: "action",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000001,
      },
      parent: { id: "imported-root", title: "Imported Source Root" },
      children: [],
      sources: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [],
        },
      ],
      evidence: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [
            {
              id: "chunk-1",
              source_id: "source-1",
              ordinal: 0,
              label: "Provider Authentication Flow",
              text: "Anthropic-compatible auth setup and model routing details.",
              start_line: 5,
              end_line: 11,
            },
          ],
          citations: [
            {
              chunk: {
                id: "chunk-1",
                source_id: "source-1",
                ordinal: 0,
                label: "Provider Authentication Flow",
                text: "Anthropic-compatible auth setup and model routing details.",
                start_line: 5,
                end_line: 11,
              },
              citation_kind: "direct",
              rationale:
                "This generated branch still depends on the provider authentication flow.",
            },
          ],
        },
      ],
    },
  };
}

function makeGeneratedCiteChunkPatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Cite Generated Branch evidence",
    ops: [
      {
        type: "cite_source_chunk",
        node_id: "generated-node",
        chunk_id: "chunk-1",
        citation_kind: "direct",
        rationale:
          "This generated branch still depends on the provider authentication flow.",
      },
    ],
  };
}

function makeGeneratedCiteChunkApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-generated-cite",
      summary: "Applied generated branch evidence citation",
      preview: ["Cited chunk-1 as direct evidence for generated-node"],
      created_nodes: [],
    },
    overview: makeGeneratedOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeGeneratedNodeContextWithEvidence(),
  };
}

function makeGeneratedUnciteChunkPatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Uncite Generated Branch evidence",
    ops: [
      {
        type: "uncite_source_chunk",
        node_id: "generated-node",
        chunk_id: "chunk-1",
      },
    ],
  };
}

function makeGeneratedUnciteChunkApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-generated-uncite",
      summary: "Applied generated branch evidence removal",
      preview: ["Removed chunk-1 evidence citation from generated-node"],
      created_nodes: [],
    },
    overview: makeGeneratedOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeGeneratedNodeContextWithSource(),
  };
}

function makeApplyReviewedPatchOutputWithGeneratedSource(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-1",
      summary: "Applied generated follow-up branch",
      preview: ["Added Generated Follow-up Branch"],
      created_nodes: [
        { id: "generated-node", title: "Generated Follow-up Branch" },
      ],
    },
    overview: makeGeneratedOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeGeneratedNodeContextWithSource(),
  };
}

function makeApplyReviewedPatchOutputWithGeneratedEvidence(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-1",
      summary: "Applied generated follow-up branch",
      preview: ["Added Generated Follow-up Branch"],
      created_nodes: [
        { id: "generated-node", title: "Generated Follow-up Branch" },
      ],
    },
    overview: makeGeneratedOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeGeneratedNodeContextWithEvidence(),
  };
}

function makeGeneratedSecondBranchOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "imported-root",
            parent_id: "root",
            title: "Imported Source Root",
            body: "Imported body",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [
            {
              node: {
                id: "generated-node",
                parent_id: "imported-root",
                title: "Generated Follow-up Branch",
                body: "Generated body",
                kind: "action",
                position: 0,
                created_at: 1710000000,
                updated_at: 1710000000,
              },
              children: [
                {
                  node: {
                    id: "generated-deep-node-1",
                    parent_id: "generated-node",
                    title: "Generated Branch Follow-up",
                    body: "Second-level generated branch body",
                    kind: "action",
                    position: 0,
                    created_at: 1710000001,
                    updated_at: 1710000001,
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeGeneratedSecondBranchContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-deep-node-1",
        parent_id: "generated-node",
        title: "Generated Branch Follow-up",
        body: "Second-level generated branch body",
        kind: "action",
        position: 0,
        created_at: 1710000001,
        updated_at: 1710000001,
      },
      parent: { id: "generated-node", title: "Generated Follow-up Branch" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeGeneratedNodeDraftReviewPayload(): DraftReviewPayload {
  return {
    run: {
      id: "run-generated-node",
      capability: "expand",
      explore_by: null,
      node_id: "generated-node",
      command: "python3 scripts/provider_runner.py",
      dry_run: true,
      status: "completed",
      started_at: 1710000000,
      finished_at: 1710000001,
      request_path: "/tmp/request-generated.json",
      response_path: "/tmp/response-generated.json",
      exit_code: 0,
      provider: "anthropic",
      model: "claude-sonnet",
      provider_run_id: null,
      retry_count: 0,
      used_plain_json_fallback: false,
      normalization_notes: [],
      last_error_category: null,
      last_error_message: null,
      last_status_code: null,
      patch_run_id: null,
      patch_summary: "Generated branch follow-up",
    },
    explanation: {
      rationale_summary: "Deepen the generated branch into one next action node.",
      direct_evidence: [],
      inferred_suggestions: [],
    },
    response_notes: [],
    patch: {
      version: 1,
      summary: "Generated branch follow-up",
      ops: [
        {
          type: "add_node",
          parent_id: "generated-node",
          title: "Generated Branch Follow-up",
          kind: "action",
          body: "Second-level generated branch body",
        },
      ],
    },
    patch_preview: ["Add Generated Branch Follow-up under Generated Follow-up Branch"],
    report: {
      run_id: null,
      summary: "Generated branch follow-up",
      preview: ["Preview generated second-level branch"],
      created_nodes: [{ id: "generated-deep-node-1", title: "Generated Branch Follow-up" }],
    },
  };
}

function makeGeneratedNodeApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-generated-node",
      summary: "Applied generated branch follow-up",
      preview: ["Added Generated Branch Follow-up under Generated Follow-up Branch"],
      created_nodes: [
        { id: "generated-deep-node-1", title: "Generated Branch Follow-up" },
      ],
    },
    overview: makeGeneratedSecondBranchOverview(),
    preferred_focus_node_id: "generated-deep-node-1",
    focus_node_context: makeGeneratedSecondBranchContext(),
  };
}

function makeGeneratedChildOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "imported-root",
            parent_id: "root",
            title: "Imported Source Root",
            body: "Imported body",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [
            {
              node: {
                id: "generated-node",
                parent_id: "imported-root",
                title: "Generated Follow-up Branch",
                body: "Generated body",
                kind: "action",
                position: 0,
                created_at: 1710000000,
                updated_at: 1710000000,
              },
              children: [
                {
                  node: {
                    id: "generated-child-node-1",
                    parent_id: "generated-node",
                    title: "Generated Branch Child",
                    body: null,
                    kind: "topic",
                    position: 0,
                    created_at: 1710000001,
                    updated_at: 1710000001,
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeGeneratedChildContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "generated-child-node-1",
        parent_id: "generated-node",
        title: "Generated Branch Child",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000001,
        updated_at: 1710000001,
      },
      parent: { id: "generated-node", title: "Generated Follow-up Branch" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeAddGeneratedChildPatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Add Generated Branch Child",
    ops: [
      {
        type: "add_node",
        parent_id: "generated-node",
        title: "Generated Branch Child",
        kind: "topic",
        body: null,
        position: null,
      },
    ],
  };
}

function makeAddGeneratedChildApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-add-generated-child",
      summary: "Applied generated branch child",
      preview: ["Added Generated Branch Child under Generated Follow-up Branch"],
      created_nodes: [{ id: "generated-child-node-1", title: "Generated Branch Child" }],
    },
    overview: makeGeneratedChildOverview(),
    preferred_focus_node_id: "generated-child-node-1",
    focus_node_context: makeGeneratedChildContext(),
  };
}

function makeCiteChunkPatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Cite Authentication evidence",
    ops: [
      {
        type: "cite_source_chunk",
        node_id: "node-1",
        chunk_id: "chunk-1",
        citation_kind: "direct",
        rationale:
          "This section explains why the current node should reuse the default auth route.",
      },
    ],
  };
}

function makeCiteChunkApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-cite",
      summary: "Applied Authentication evidence citation",
      preview: ["Cited chunk-1 as direct evidence for node-1"],
      created_nodes: [],
    },
    overview: makeOverview(),
    preferred_focus_node_id: "node-1",
    focus_node_context: makeNodeContextWithEvidence(),
  };
}

function makeUnciteChunkPatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Uncite Authentication evidence",
    ops: [
      {
        type: "uncite_source_chunk",
        node_id: "node-1",
        chunk_id: "chunk-1",
      },
    ],
  };
}

function makeUnciteChunkApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-uncite",
      summary: "Applied Authentication evidence removal",
      preview: ["Removed chunk-1 evidence citation from node-1"],
      created_nodes: [],
    },
    overview: makeOverview(),
    preferred_focus_node_id: "node-1",
    focus_node_context: makeNodeContextWithSource(),
  };
}

function makeAddedChildOverview(): WorkspaceOverview {
  return {
    root_dir: "/workspace",
    workspace_name: "workspace",
    tree: {
      node: {
        id: "root",
        parent_id: null,
        title: "Root",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      children: [
        {
          node: {
            id: "node-1",
            parent_id: "root",
            title: "Authentication",
            body: "Current auth routing notes",
            kind: "topic",
            position: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [
            {
              node: {
                id: "child-node-1",
                parent_id: "node-1",
                title: "Authentication Child",
                body: null,
                kind: "topic",
                position: 0,
                created_at: 1710000001,
                updated_at: 1710000001,
              },
              children: [],
            },
          ],
        },
        {
          node: {
            id: "node-2",
            parent_id: "root",
            title: "Operations",
            body: null,
            kind: "topic",
            position: 1,
            created_at: 1710000000,
            updated_at: 1710000000,
          },
          children: [],
        },
      ],
    },
    sources: [],
    snapshots: [],
    patch_history: [],
  };
}

function makeAddedChildContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "child-node-1",
        parent_id: "node-1",
        title: "Authentication Child",
        body: null,
        kind: "topic",
        position: 0,
        created_at: 1710000001,
        updated_at: 1710000001,
      },
      parent: { id: "node-1", title: "Authentication" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeAddChildPatchDocument(): PatchDocument {
  return {
    version: 1,
    summary: "Add Authentication child",
    ops: [
      {
        type: "add_node",
        parent_id: "node-1",
        title: "Authentication Child",
        kind: "topic",
        body: null,
        position: null,
      },
    ],
  };
}

function makeAddChildApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-add-child",
      summary: "Applied Authentication child branch",
      preview: ["Added Authentication Child under Authentication"],
      created_nodes: [{ id: "child-node-1", title: "Authentication Child" }],
    },
    overview: makeAddedChildOverview(),
    preferred_focus_node_id: "child-node-1",
    focus_node_context: makeAddedChildContext(),
  };
}

function makeNodeApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-2",
      summary: "Applied Authentication follow-up branch",
      preview: ["Added Authentication Follow-up under Authentication"],
      created_nodes: [
        { id: "generated-node", title: "Authentication Follow-up" },
      ],
    },
    overview: makeNodeGeneratedOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeNodeGeneratedContext(),
  };
}

function makeDraftReviewPayload(nodeId: string): DraftReviewPayload {
  return {
    run: {
      id: "run-1",
      capability: "expand",
      explore_by: null,
      node_id: nodeId,
      command: "python3 scripts/provider_runner.py",
      dry_run: true,
      status: "completed",
      started_at: 1710000000,
      finished_at: 1710000001,
      request_path: "/tmp/request.json",
      response_path: "/tmp/response.json",
      exit_code: 0,
      provider: "anthropic",
      model: "claude-sonnet",
      provider_run_id: null,
      retry_count: 0,
      used_plain_json_fallback: false,
      normalization_notes: [],
      last_error_category: null,
      last_error_message: null,
      last_status_code: null,
      patch_run_id: null,
      patch_summary: "Generated follow-up branch",
    },
    explanation: {
      rationale_summary: "Expand the imported root into one next action branch.",
      direct_evidence: [],
      inferred_suggestions: [],
    },
    response_notes: [],
    patch: {
      version: 1,
      summary: "Generated follow-up branch",
      ops: [
        {
          type: "add_node",
          parent_id: nodeId,
          title: "Generated Follow-up Branch",
          kind: "action",
          body: "Generated body",
        },
      ],
    },
    patch_preview: ["Add Generated Follow-up Branch under the imported root"],
    report: {
      run_id: null,
      summary: "Generated follow-up branch",
      preview: ["Preview generated branch"],
      created_nodes: [{ id: "generated-node", title: "Generated Follow-up Branch" }],
    },
  };
}

function makeApplyReviewedPatchOutput(): ApplyReviewedPatchOutput {
  return {
    report: {
      run_id: "patch-run-1",
      summary: "Applied generated follow-up branch",
      preview: ["Added Generated Follow-up Branch"],
      created_nodes: [
        { id: "generated-node", title: "Generated Follow-up Branch" },
      ],
    },
    overview: makeGeneratedOverview(),
    preferred_focus_node_id: "generated-node",
    focus_node_context: makeGeneratedNodeContext(),
  };
}

function makeSourceImportOutput(): SourceImportOutput {
  return {
    report: {
      source_id: "source-2",
      original_name: "imported.md",
      stored_name: "imported.md",
      root_node_id: "imported-root",
      root_title: "Imported Source Root",
      node_count: 1,
      chunk_count: 1,
    },
    overview: makeImportedOverview(),
  };
}

function makeNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "node-1",
        parent_id: "root",
        title: "Authentication",
        body: "Current auth routing notes",
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "root", title: "Root" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeNodeContextWithSource(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "node-1",
        parent_id: "root",
        title: "Authentication",
        body: "Current auth routing notes",
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "root", title: "Root" },
      children: [],
      sources: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [],
        },
      ],
      evidence: [],
    },
  };
}

function makeNodeContextWithEvidence(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "node-1",
        parent_id: "root",
        title: "Authentication",
        body: "Current auth routing notes",
        kind: "topic",
        position: 0,
        created_at: 1710000000,
        updated_at: 1710000001,
      },
      parent: { id: "root", title: "Root" },
      children: [],
      sources: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [],
        },
      ],
      evidence: [
        {
          source: {
            id: "source-1",
            original_path: "/fixtures/source.md",
            original_name: "source.md",
            stored_name: "source.md",
            format: "md",
            imported_at: 1710000000,
          },
          chunks: [
            {
              id: "chunk-1",
              source_id: "source-1",
              ordinal: 0,
              label: "Provider Authentication Flow",
              text: "Anthropic-compatible auth setup and model routing details.",
              start_line: 5,
              end_line: 11,
            },
          ],
          citations: [
            {
              chunk: {
                id: "chunk-1",
                source_id: "source-1",
                ordinal: 0,
                label: "Provider Authentication Flow",
                text: "Anthropic-compatible auth setup and model routing details.",
                start_line: 5,
                end_line: 11,
              },
              citation_kind: "direct",
              rationale:
                "This section explains why the current node should reuse the default auth route.",
            },
          ],
        },
      ],
    },
  };
}

function makeSecondNodeContext(): NodeWorkspaceContext {
  return {
    node_detail: {
      node: {
        id: "node-2",
        parent_id: "root",
        title: "Operations",
        body: "Operational follow-up notes",
        kind: "topic",
        position: 1,
        created_at: 1710000000,
        updated_at: 1710000000,
      },
      parent: { id: "root", title: "Root" },
      children: [],
      sources: [],
      evidence: [],
    },
  };
}

function makeSourceDetail(): SourceDetail {
  return {
    source: {
      id: "source-1",
      original_path: "/fixtures/source.md",
      original_name: "source.md",
      stored_name: "source.md",
      format: "md",
      imported_at: 1710000000,
    },
    chunks: [],
  };
}

function makeDesktopAiStatus(): DesktopAiStatus {
  return {
    command: "python3 scripts/provider_runner.py --provider anthropic --use-default-args",
    command_source: "default",
    provider: "anthropic",
    runner: "provider_runner.py",
    model: null,
    reasoning_effort: null,
    has_auth: true,
    has_process_env_conflict: false,
    has_shell_env_conflict: false,
    uses_provider_defaults: true,
    status_error: null,
  };
}

async function flush(cycles = 1) {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ApplyContinuityExpectation {
  focusedNodeId: string;
  focusedNodeTitle: string;
  applySummary: string;
  reviewFocusNodeId: string;
  visibleSectionLabels?: string[];
  hiddenSectionLabels?: string[];
  expectedEvidenceChunkId?: string | null;
}

function assertApplyContinuityContract(options: {
  renderedText: string;
  invokeCalls: Array<{ command: string; args: Record<string, unknown> }>;
  treePaneProps: TreePaneProps;
  mainPaneProps: MainPaneProps;
  sidePaneProps: SidePaneProps;
  expectation: ApplyContinuityExpectation;
}) {
  const finalSidePaneHtml = renderToStaticMarkup(
    <WorkbenchSidePane {...options.sidePaneProps} />,
  );
  const hiddenSectionLabels = options.expectation.hiddenSectionLabels ?? [
    "Evidence",
    "Sources",
  ];

  assert.equal(
    options.treePaneProps.selectedNodeId,
    options.expectation.focusedNodeId,
  );
  assert.equal(
    options.mainPaneProps.selectedNodeId,
    options.expectation.focusedNodeId,
  );
  assert.equal(options.sidePaneProps.selectionTab, "context");
  assert.equal(options.sidePaneProps.patchDraftState.state, "empty");
  assert.equal(options.sidePaneProps.selectedSourceDetail, null);
  assert.equal(
    options.sidePaneProps.nodeContext?.node_detail.node.id,
    options.expectation.focusedNodeId,
  );
  assert.equal(
    options.sidePaneProps.applyResult?.summary,
    options.expectation.applySummary,
  );
  assert.match(options.renderedText, /Current focus/);
  assert.match(
    options.renderedText,
    new RegExp(escapeRegExp(options.expectation.applySummary)),
  );
  assert.doesNotMatch(options.renderedText, /Source in view:/);
  assert.match(
    finalSidePaneHtml,
    new RegExp(`Node: ${escapeRegExp(options.expectation.focusedNodeTitle)}`),
  );
  assert.doesNotMatch(finalSidePaneHtml, /Source in view/);

  for (const label of options.expectation.visibleSectionLabels ?? []) {
    assert.match(finalSidePaneHtml, new RegExp(`>${escapeRegExp(label)}<`));
  }

  for (const label of hiddenSectionLabels) {
    assert.doesNotMatch(finalSidePaneHtml, new RegExp(`>${escapeRegExp(label)}<`));
  }

  if (options.expectation.expectedEvidenceChunkId !== undefined) {
    assert.equal(
      options.sidePaneProps.nodeContext?.node_detail.evidence[0]?.citations[0]?.chunk.id ??
        null,
      options.expectation.expectedEvidenceChunkId,
    );
  }

  assert.ok(
    options.invokeCalls.some(
      (call) =>
        call.command === "apply_reviewed_patch" &&
        call.args.focus_node_id === options.expectation.reviewFocusNodeId,
    ),
    `apply should keep ${options.expectation.reviewFocusNodeId} as the review focus before the mounted panes settle`,
  );
}

test("App clears source detail draft state when returning to node context", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, _args: Record<string, unknown>) => {
      invokeCalls.push({
        command,
        args: _args,
      });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContext() as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  assert.ok(latestSidePaneProps, "side pane should render after workspace load");
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };
  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };

  assert.equal(requireTreePaneProps().selectedNodeId, "node-1");
  assert.equal(requireMainPaneProps().selectedNodeId, "node-1");
  assert.equal(requireSidePaneProps().selectionTab, "context");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(
    requireSidePaneProps().nodeContext?.node_detail.node.id,
    "node-1",
  );
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_node_workspace_context" &&
        call.args.node_id === "node-1",
    ),
    "focused node context should be loaded for the preferred node",
  );

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const patchEditor = eventHandlers.get("desktop://patch-editor");
  assert.ok(patchEditor, "patch-editor listener should be registered");

  await act(async () => {
    patchEditor?.({
      payload: {
        patch_json: JSON.stringify({
          version: 1,
          summary: "Draft summary",
          ops: [{ type: "add_node", title: "Follow-up branch" }],
        } satisfies PatchDocument),
        message: "draft ready",
        tone: "success",
      },
    });
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(
    requireSidePaneProps().patchDraftState.state,
    "ready",
  );
  assert.ok(requireSidePaneProps().selectedSourceDetail);

  await act(async () => {
    requireSidePaneProps().onBackToNodeContext();
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "context");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(
    requireSidePaneProps().patchDraftState.state,
    "empty",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App routes source detail into node-scoped Draft through the shared handoff seam", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContext() as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };
  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  assert.ok(requireSidePaneProps().selectedSourceDetail);
  const patchEditor = eventHandlers.get("desktop://patch-editor");
  assert.ok(patchEditor, "patch-editor listener should be registered");

  await act(async () => {
    patchEditor?.({
      payload: {
        patch_json: JSON.stringify({
          version: 1,
          summary: "Draft summary",
          ops: [{ type: "add_node", title: "Follow-up branch" }],
        } satisfies PatchDocument),
        message: "draft ready",
        tone: "success",
      },
    });
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");

  const nodeContextFetchCountBeforeDraft = invokeCalls.filter(
    (call) => call.command === "get_node_workspace_context",
  ).length;

  await act(async () => {
    requireSidePaneProps().onSelectSelectionTab("draft");
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "draft");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(requireSidePaneProps().patchDraftState.state, "empty");
  assert.equal(requireTreePaneProps().selectedNodeId, "node-1");
  assert.equal(requireMainPaneProps().selectedNodeId, "node-1");
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "node-1");
  assert.equal(
    invokeCalls.filter((call) => call.command === "get_node_workspace_context").length,
    nodeContextFetchCountBeforeDraft,
    "switching from source detail into Draft should reuse current node context instead of refetching it",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App clears transient draft review state when switching to a different node", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (args.node_id === "node-2"
          ? makeSecondNodeContext()
          : makeNodeContext()) as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireMainPaneProps().onDraftAiExpand();
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.ok(requireSidePaneProps().reviewDraft);

  await act(async () => {
    requireTreePaneProps().onSelectNode("node-2");
    await flush(2);
  });

  assert.equal(requireTreePaneProps().selectedNodeId, "node-2");
  assert.equal(requireMainPaneProps().selectedNodeId, "node-2");
  assert.equal(requireSidePaneProps().selectionTab, "context");
  assert.equal(requireSidePaneProps().patchDraftState.state, "empty");
  assert.equal(requireSidePaneProps().reviewDraft, null);
  assert.equal(requireSidePaneProps().applyResult, null);
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(
    requireSidePaneProps().nodeContext?.node_detail.node.id,
    "node-2",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App applies workspace-loaded focus_node_id across tree, canvas, and side pane", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContext() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  assert.equal(requireTreePaneProps().selectedNodeId, "node-1");
  assert.equal(requireMainPaneProps().selectedNodeId, "node-1");
  assert.equal(requireSidePaneProps().selectionTab, "context");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "node-1");
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_node_workspace_context" &&
        call.args.node_id === "node-1",
    ),
    "preferred node id should drive context loading",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App renders Context CTA and local provenance in the mounted right pane after workspace load", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContextWithSource() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: () => <div />,
    WorkbenchMainPane: () => <div />,
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const renderedText = dom.container.textContent;
  assert.match(renderedText, /Current focus/);
  assert.match(renderedText, /Node: Authentication/);
  assert.match(renderedText, /Open Draft/);
  assert.match(renderedText, /source\.md/);
  assert.match(renderedText, /Source file path: \/fixtures\/source\.md/);
  assert.match(renderedText, /Imported:/);
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_node_workspace_context" &&
        call.args.node_id === "node-1",
    ),
    "preferred node id should still drive the mounted context load",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps node and source focus cues visible when source context opens", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContextWithSource() as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: () => <div />,
    WorkbenchMainPane: () => <div />,
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const renderedText = dom.container.textContent;
  assert.match(renderedText, /Current focus/);
  assert.match(renderedText, /Node: Authentication/);
  assert.match(renderedText, /Source in view: source\.md/);
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_source_detail" &&
        call.args.source_id === "source-1",
    ),
    "opening a source should fetch its detail for the mounted side pane",
  );
  assert.equal(requireSidePaneProps().selectedSourceDetail?.source.id, "source-1");

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps node and source focus cues visible when source context transitions into review", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContextWithSource() as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: () => <div />,
    WorkbenchMainPane: () => <div />,
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const patchEditor = eventHandlers.get("desktop://patch-editor");
  assert.ok(patchEditor, "patch-editor listener should be registered");

  await act(async () => {
    patchEditor?.({
      payload: {
        patch_json: JSON.stringify({
          version: 1,
          summary: "Draft summary",
          ops: [{ type: "add_node", title: "Follow-up branch" }],
        } satisfies PatchDocument),
        message: "draft ready",
        tone: "success",
      },
    });
    await flush();
  });

  const renderedText = dom.container.textContent;
  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.equal(requireSidePaneProps().selectedSourceDetail?.source.id, "source-1");
  assert.match(renderedText, /Current focus/);
  assert.match(renderedText, /Node: Authentication/);
  assert.match(renderedText, /Source in view: source\.md/);
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_source_detail" &&
        call.args.source_id === "source-1",
    ),
    "review continuity should still come from a fetched source detail",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App refocuses tree, canvas, and right rail onto the applied node after review apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeNodeGeneratedContext()
            : makeNodeContextWithSource()
        ) as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeNodeApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const patchEditor = eventHandlers.get("desktop://patch-editor");
  assert.ok(patchEditor, "patch-editor listener should be registered");

  await act(async () => {
    patchEditor?.({
      payload: {
        patch_json: JSON.stringify({
          version: 1,
          summary: "Draft summary",
          ops: [{ type: "add_node", title: "Authentication Follow-up" }],
        } satisfies PatchDocument),
        message: "draft ready",
        tone: "success",
      },
    });
    await flush();
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Authentication Follow-up",
      applySummary: "Applied Authentication follow-up branch",
      reviewFocusNodeId: "node-1",
    },
  });

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tree, canvas, and right rail aligned on the updated node after manual patch apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (args.node_id === "node-1"
          ? makeNodeContext()
          : makeSecondNodeContext()) as T;
      }
      if (command === "draft_update_node_patch") {
        return makeUpdateNodePatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeUpdateNodeApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onTitleChange("Authentication Updated");
    requireSidePaneProps().onBodyChange(
      "Current auth routing notes with one local revision",
    );
    await flush();
  });

  await act(async () => {
    requireSidePaneProps().onDraftUpdate();
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "draft_update_node_patch" &&
        call.args.node_id === "node-1" &&
        call.args.title === "Authentication Updated",
    ),
    "manual draft update should use the current node and edited title",
  );

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "node-1",
      focusedNodeTitle: "Authentication Updated",
      applySummary: "Applied Authentication update",
      reviewFocusNodeId: "node-1",
    },
  });
  assert.equal(
    requireSidePaneProps().nodeContext?.node_detail.node.title,
    "Authentication Updated",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tree, canvas, and right rail aligned on the current node after cite patch apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContextWithSource() as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "draft_cite_source_chunk_patch") {
        return makeCiteChunkPatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeCiteChunkApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  await act(async () => {
    requireSidePaneProps().onDraftCiteChunk("chunk-1");
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "draft_cite_source_chunk_patch" &&
        call.args.node_id === "node-1" &&
        call.args.chunk_id === "chunk-1",
    ),
    "cite draft should use the selected node and source chunk",
  );

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "node-1",
      focusedNodeTitle: "Authentication",
      applySummary: "Applied Authentication evidence citation",
      reviewFocusNodeId: "node-1",
      visibleSectionLabels: ["Sources", "Evidence"],
      hiddenSectionLabels: [],
      expectedEvidenceChunkId: "chunk-1",
    },
  });
  assert.match(
    renderToStaticMarkup(<WorkbenchSidePane {...requireSidePaneProps()} />),
    /source\.md/,
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tree, canvas, and right rail aligned on the current node after uncite patch apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return makeNodeContextWithEvidence() as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "draft_uncite_source_chunk_patch") {
        return makeUnciteChunkPatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeUnciteChunkApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  await act(async () => {
    requireSidePaneProps().onDraftUnciteChunk("chunk-1");
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "draft_uncite_source_chunk_patch" &&
        call.args.node_id === "node-1" &&
        call.args.chunk_id === "chunk-1",
    ),
    "uncite draft should use the selected node and source chunk",
  );

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "node-1",
      focusedNodeTitle: "Authentication",
      applySummary: "Applied Authentication evidence removal",
      reviewFocusNodeId: "node-1",
      visibleSectionLabels: ["Sources"],
      hiddenSectionLabels: ["Evidence"],
      expectedEvidenceChunkId: null,
    },
  });
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.evidence.length, 0);

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App refocuses tree, canvas, and right rail onto the created child after add-child patch apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (args.node_id === "child-node-1"
          ? makeAddedChildContext()
          : makeNodeContext()) as T;
      }
      if (command === "draft_add_node_patch") {
        return makeAddChildPatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeAddChildApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => null,
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireMainPaneProps().onAddChildTitleChange("Authentication Child");
    await flush();
  });

  await act(async () => {
    requireMainPaneProps().onDraftAddChild();
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "draft_add_node_patch" &&
        call.args.parent_id === "node-1" &&
        call.args.title === "Authentication Child",
    ),
    "add-child draft should use the selected node as parent and the typed title",
  );

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "child-node-1",
      focusedNodeTitle: "Authentication Child",
      applySummary: "Applied Authentication child branch",
      reviewFocusNodeId: "node-1",
    },
  });

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App focuses the imported root across tree, canvas, and side pane after sidebar import", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (args.node_id === "imported-root"
          ? makeImportedNodeContext()
          : makeNodeContext()) as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  assert.equal(requireTreePaneProps().selectedNodeId, "imported-root");
  assert.equal(requireMainPaneProps().selectedNodeId, "imported-root");
  assert.equal(requireSidePaneProps().selectionTab, "context");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(
    requireSidePaneProps().nodeContext?.node_detail.node.id,
    "imported-root",
  );
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "import_source" &&
        call.args.source_path === "/tmp/imported.md",
    ),
    "sidebar import should call import_source with the chosen path",
  );
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_node_workspace_context" &&
        call.args.node_id === "imported-root",
    ),
    "imported root should drive the follow-up context load",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App drives source import through draft review and apply on the imported root", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeContext()
            : args.node_id === "imported-root"
              ? makeImportedNodeContext()
              : makeNodeContext()
        ) as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  assert.equal(requireMainPaneProps().selectedNodeId, "imported-root");
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "imported-root");

  await act(async () => {
    requireMainPaneProps().onDraftAiExpand();
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.ok(requireSidePaneProps().reviewDraft);
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "draft_node_expand" &&
        call.args.node_id === "imported-root",
    ),
    "AI expand should draft from the imported root",
  );

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(2);
  });

  assert.equal(requireTreePaneProps().selectedNodeId, "generated-node");
  assert.equal(requireMainPaneProps().selectedNodeId, "generated-node");
  assert.equal(requireSidePaneProps().selectionTab, "context");
  assert.equal(requireSidePaneProps().patchDraftState.state, "empty");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(
    requireSidePaneProps().nodeContext?.node_detail.node.id,
    "generated-node",
  );
  assert.equal(
    requireSidePaneProps().applyResult?.summary,
    "Applied generated follow-up branch",
  );
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "apply_reviewed_patch" &&
        call.args.focus_node_id === "imported-root",
    ),
    "apply should use the imported root as the review focus node",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App refocuses tree, canvas, and real right rail onto the generated node after imported-root apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeContext()
            : args.node_id === "imported-root"
              ? makeImportedNodeContext()
              : makeNodeContext()
        ) as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeApplyReviewedPatchOutput() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated follow-up branch",
      reviewFocusNodeId: "imported-root",
    },
  });

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tri-pane continuity through a second patch-first apply after imported-root apply lands on the generated node", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node" &&
          invokeCalls.some(
            (call) =>
              call.command === "apply_reviewed_patch" &&
              call.args.focus_node_id === "generated-node",
          )
            ? makeUpdatedGeneratedNodeContext()
            : args.node_id === "generated-node"
              ? makeGeneratedNodeContext()
              : args.node_id === "imported-root"
                ? makeImportedNodeContext()
                : makeNodeContext()
        ) as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "draft_update_node_patch") {
        return makeUpdateGeneratedNodePatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return (
          args.focus_node_id === "generated-node"
            ? makeUpdateGeneratedNodeApplyReviewedPatchOutput()
            : makeApplyReviewedPatchOutput()
        ) as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireMainPaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated follow-up branch",
      reviewFocusNodeId: "imported-root",
    },
  });

  await act(async () => {
    requireSidePaneProps().onTitleChange("Generated Follow-up Branch Revised");
    requireSidePaneProps().onBodyChange("Generated body with one local revision");
    await flush();
  });

  await act(async () => {
    requireSidePaneProps().onDraftUpdate();
    await flush(2);
  });

  const draftUpdateCalls = invokeCalls.filter(
    (call) => call.command === "draft_update_node_patch",
  );
  const latestDraftUpdateCall = draftUpdateCalls[draftUpdateCalls.length - 1];
  assert.ok(latestDraftUpdateCall, "generated node update should draft a patch");
  assert.equal(latestDraftUpdateCall.args.node_id, "generated-node");
  assert.equal(
    latestDraftUpdateCall.args.title,
    "Generated Follow-up Branch Revised",
  );
  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch Revised",
      applySummary: "Applied generated branch update",
      reviewFocusNodeId: "generated-node",
    },
  });
  assert.equal(
    requireSidePaneProps().nodeContext?.node_detail.node.body,
    "Generated body with one local revision",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tri-pane continuity when the generated node immediately branches into a child in the same mounted session", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-child-node-1"
            ? makeGeneratedChildContext()
            : args.node_id === "generated-node"
              ? makeGeneratedNodeContext()
              : args.node_id === "imported-root"
                ? makeImportedNodeContext()
                : makeNodeContext()
        ) as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "draft_add_node_patch") {
        return makeAddGeneratedChildPatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return (
          args.focus_node_id === "generated-node"
            ? makeAddGeneratedChildApplyReviewedPatchOutput()
            : makeApplyReviewedPatchOutput()
        ) as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireMainPaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated follow-up branch",
      reviewFocusNodeId: "imported-root",
    },
  });

  await act(async () => {
    requireMainPaneProps().onAddChildTitleChange("Generated Branch Child");
    await flush();
  });

  await act(async () => {
    requireMainPaneProps().onDraftAddChild();
    await flush(2);
  });

  const addChildCalls = invokeCalls.filter(
    (call) => call.command === "draft_add_node_patch",
  );
  const latestAddChildCall = addChildCalls[addChildCalls.length - 1];
  assert.ok(latestAddChildCall, "generated node should draft a child patch");
  assert.equal(latestAddChildCall.args.parent_id, "generated-node");
  assert.equal(latestAddChildCall.args.title, "Generated Branch Child");
  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-child-node-1",
      focusedNodeTitle: "Generated Branch Child",
      applySummary: "Applied generated branch child",
      reviewFocusNodeId: "generated-node",
    },
  });

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tri-pane continuity when the generated node immediately enters the source/evidence flow in the same mounted session", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeContextWithSource()
            : args.node_id === "imported-root"
              ? makeImportedNodeContext()
              : makeNodeContext()
        ) as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "draft_cite_source_chunk_patch") {
        return makeGeneratedCiteChunkPatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return (
          args.focus_node_id === "generated-node"
            ? makeGeneratedCiteChunkApplyReviewedPatchOutput()
            : makeApplyReviewedPatchOutputWithGeneratedSource()
        ) as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireMainPaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated follow-up branch",
      reviewFocusNodeId: "imported-root",
      visibleSectionLabels: ["Sources"],
      hiddenSectionLabels: ["Evidence"],
    },
  });
  assert.match(
    renderToStaticMarkup(<WorkbenchSidePane {...requireSidePaneProps()} />),
    /source\.md/,
  );

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  assert.equal(requireSidePaneProps().selectedSourceDetail?.source.id, "source-1");

  await act(async () => {
    requireSidePaneProps().onDraftCiteChunk("chunk-1");
    await flush(2);
  });

  const citeCalls = invokeCalls.filter(
    (call) => call.command === "draft_cite_source_chunk_patch",
  );
  const latestCiteCall = citeCalls[citeCalls.length - 1];
  assert.ok(latestCiteCall, "generated node should draft a cite patch");
  assert.equal(latestCiteCall.args.node_id, "generated-node");
  assert.equal(latestCiteCall.args.chunk_id, "chunk-1");
  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated branch evidence citation",
      reviewFocusNodeId: "generated-node",
      visibleSectionLabels: ["Sources", "Evidence"],
      hiddenSectionLabels: [],
      expectedEvidenceChunkId: "chunk-1",
    },
  });

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tri-pane continuity when the generated node immediately clears evidence in the same mounted session", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeContextWithEvidence()
            : args.node_id === "imported-root"
              ? makeImportedNodeContext()
              : makeNodeContext()
        ) as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "draft_uncite_source_chunk_patch") {
        return makeGeneratedUnciteChunkPatchDocument() as T;
      }
      if (command === "apply_reviewed_patch") {
        return (
          args.focus_node_id === "generated-node"
            ? makeGeneratedUnciteChunkApplyReviewedPatchOutput()
            : makeApplyReviewedPatchOutputWithGeneratedEvidence()
        ) as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };
  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireMainPaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated follow-up branch",
      reviewFocusNodeId: "imported-root",
      visibleSectionLabels: ["Sources", "Evidence"],
      hiddenSectionLabels: [],
      expectedEvidenceChunkId: "chunk-1",
    },
  });

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  assert.equal(requireSidePaneProps().selectedSourceDetail?.source.id, "source-1");

  await act(async () => {
    requireSidePaneProps().onDraftUnciteChunk("chunk-1");
    await flush(2);
  });

  const unciteCalls = invokeCalls.filter(
    (call) => call.command === "draft_uncite_source_chunk_patch",
  );
  const latestUnciteCall = unciteCalls[unciteCalls.length - 1];
  assert.ok(latestUnciteCall, "generated node should draft an uncite patch");
  assert.equal(latestUnciteCall.args.node_id, "generated-node");
  assert.equal(latestUnciteCall.args.chunk_id, "chunk-1");
  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-node",
      focusedNodeTitle: "Generated Follow-up Branch",
      applySummary: "Applied generated branch evidence removal",
      reviewFocusNodeId: "generated-node",
      visibleSectionLabels: ["Sources"],
      hiddenSectionLabels: ["Evidence"],
      expectedEvidenceChunkId: null,
    },
  });
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.evidence.length, 0);

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps node and source focus cues visible when the generated node source context transitions into review", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeContextWithSource()
            : args.node_id === "imported-root"
              ? makeImportedNodeContext()
              : makeNodeContext()
        ) as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeApplyReviewedPatchOutputWithGeneratedSource() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: () => <div />,
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };
  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(4);
  });

  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "imported-root");

  await act(async () => {
    requireSidePaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(6);
  });

  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "generated-node");

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const patchEditor = eventHandlers.get("desktop://patch-editor");
  assert.ok(patchEditor, "patch-editor listener should be registered");

  await act(async () => {
    patchEditor?.({
      payload: {
        patch_json: JSON.stringify({
          version: 1,
          summary: "Generated node draft summary",
          ops: [{ type: "add_node", title: "Generated branch follow-up" }],
        } satisfies PatchDocument),
        message: "draft ready",
        tone: "success",
      },
    });
    await flush(2);
  });

  const renderedText = dom.container.textContent;
  const finalSidePaneHtml = renderToStaticMarkup(
    <WorkbenchSidePane {...requireSidePaneProps()} />,
  );
  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.equal(requireSidePaneProps().selectedSourceDetail?.source.id, "source-1");
  assert.match(renderedText, /Current focus/);
  assert.match(finalSidePaneHtml, /Node: Generated Follow-up Branch/);
  assert.match(finalSidePaneHtml, /Source in view: source\.md/);
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "get_source_detail" &&
        call.args.source_id === "source-1",
    ),
    "generated review continuity should still come from a fetched source detail",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App routes generated node source detail into node-scoped Draft through the shared handoff seam", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeContextWithSource()
            : args.node_id === "imported-root"
              ? makeImportedNodeContext()
              : makeNodeContext()
        ) as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return makeDraftReviewPayload(String(args.node_id)) as T;
      }
      if (command === "apply_reviewed_patch") {
        return makeApplyReviewedPatchOutputWithGeneratedSource() as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <div />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };
  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const patchEditor = eventHandlers.get("desktop://patch-editor");
  assert.ok(patchEditor, "patch-editor listener should be registered");

  await act(async () => {
    patchEditor?.({
      payload: {
        patch_json: JSON.stringify({
          version: 1,
          summary: "Generated node draft summary",
          ops: [{ type: "add_node", title: "Generated branch follow-up" }],
        } satisfies PatchDocument),
        message: "draft ready",
        tone: "success",
      },
    });
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");

  const nodeContextFetchCountBeforeDraft = invokeCalls.filter(
    (call) => call.command === "get_node_workspace_context",
  ).length;

  await act(async () => {
    requireSidePaneProps().onSelectSelectionTab("draft");
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "draft");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(requireSidePaneProps().patchDraftState.state, "empty");
  assert.equal(requireTreePaneProps().selectedNodeId, "generated-node");
  assert.equal(requireMainPaneProps().selectedNodeId, "generated-node");
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "generated-node");
  assert.equal(
    invokeCalls.filter((call) => call.command === "get_node_workspace_context").length,
    nodeContextFetchCountBeforeDraft,
    "switching from generated node source detail into Draft should reuse current node context instead of refetching it",
  );

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});

test("App keeps tri-pane continuity through generated node source detail into Draft and then review/apply", async () => {
  const dom = installFakeDom();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let latestTreePaneProps: TreePaneProps | null = null;
  let latestMainPaneProps: MainPaneProps | null = null;
  let latestSidePaneProps: SidePaneProps | null = null;

  const bindings: Partial<AppBindings> = {
    hasTauriRuntime: () => true,
    listen: async (eventName, handler) => {
      eventHandlers.set(eventName, handler as (event: { payload: unknown }) => void);
      return () => {
        eventHandlers.delete(eventName);
      };
    },
    invokeCommand: async <T,>(command: string, args: Record<string, unknown>) => {
      invokeCalls.push({ command, args });
      if (command === "set_menu_locale") {
        return undefined as T;
      }
      if (command === "get_desktop_ai_status") {
        return makeDesktopAiStatus() as T;
      }
      if (command === "get_node_workspace_context") {
        return (
          args.node_id === "generated-deep-node-1"
            ? makeGeneratedSecondBranchContext()
            : args.node_id === "generated-node"
              ? makeGeneratedNodeContextWithSource()
              : args.node_id === "imported-root"
                ? makeImportedNodeContext()
                : makeNodeContext()
        ) as T;
      }
      if (command === "get_source_detail") {
        return makeSourceDetail() as T;
      }
      if (command === "import_source") {
        return makeSourceImportOutput() as T;
      }
      if (command === "draft_node_expand") {
        return (
          args.node_id === "generated-node"
            ? makeGeneratedNodeDraftReviewPayload()
            : makeDraftReviewPayload(String(args.node_id))
        ) as T;
      }
      if (command === "apply_reviewed_patch") {
        return (
          args.focus_node_id === "generated-node"
            ? makeGeneratedNodeApplyReviewedPatchOutput()
            : makeApplyReviewedPatchOutputWithGeneratedSource()
        ) as T;
      }
      throw new Error(`unexpected command: ${command}`);
    },
    openPath: async () => "/tmp/imported.md",
    TreePane: (props) => {
      latestTreePaneProps = props;
      return <div />;
    },
    WorkbenchMainPane: (props) => {
      latestMainPaneProps = props;
      return <div />;
    },
    WorkbenchSidePane: (props) => {
      latestSidePaneProps = props;
      return <WorkbenchSidePane {...props} />;
    },
    WorkspaceStartPane: () => <div />,
  };

  const root = ReactDOM.createRoot(dom.container as unknown as Element);

  await act(async () => {
    root.render(<App bindings={bindings} />);
    await flush();
  });

  const workspaceLoaded = eventHandlers.get("desktop://workspace-loaded");
  assert.ok(workspaceLoaded, "workspace-loaded listener should be registered");

  await act(async () => {
    workspaceLoaded?.({
      payload: {
        overview: makeOverview(),
        message: "workspace loaded",
        tone: "success",
        focus_node_id: "node-1",
      },
    });
    await flush();
  });

  const requireSidePaneProps = () => {
    assert.ok(latestSidePaneProps, "side pane props should be available");
    return latestSidePaneProps;
  };
  const requireTreePaneProps = () => {
    assert.ok(latestTreePaneProps, "tree pane props should be available");
    return latestTreePaneProps;
  };
  const requireMainPaneProps = () => {
    assert.ok(latestMainPaneProps, "main pane props should be available");
    return latestMainPaneProps;
  };

  await act(async () => {
    requireTreePaneProps().onImportSource();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onDraftAiExpand();
    await flush(2);
  });

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  await act(async () => {
    requireSidePaneProps().onOpenSource("source-1");
    await flush();
  });

  const nodeContextFetchCountBeforeDraft = invokeCalls.filter(
    (call) => call.command === "get_node_workspace_context",
  ).length;

  await act(async () => {
    requireSidePaneProps().onSelectSelectionTab("draft");
    await flush();
  });

  assert.equal(requireSidePaneProps().selectionTab, "draft");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.equal(requireSidePaneProps().patchDraftState.state, "empty");
  assert.equal(requireTreePaneProps().selectedNodeId, "generated-node");
  assert.equal(requireMainPaneProps().selectedNodeId, "generated-node");
  assert.equal(requireSidePaneProps().nodeContext?.node_detail.node.id, "generated-node");
  assert.equal(
    invokeCalls.filter((call) => call.command === "get_node_workspace_context").length,
    nodeContextFetchCountBeforeDraft,
    "generated node Draft handoff should reuse current node context before the next review/apply step",
  );

  await act(async () => {
    requireSidePaneProps().onDraftAiExpand();
    await flush(2);
  });

  assert.equal(requireSidePaneProps().selectionTab, "review");
  assert.equal(requireSidePaneProps().patchDraftState.state, "ready");
  assert.equal(requireSidePaneProps().selectedSourceDetail, null);
  assert.ok(
    invokeCalls.some(
      (call) =>
        call.command === "draft_node_expand" &&
        call.args.node_id === "generated-node",
    ),
    "generated node Draft step should draft from the current generated node",
  );

  await act(async () => {
    requireSidePaneProps().onApplyPatch();
    await flush(4);
  });

  assertApplyContinuityContract({
    renderedText: dom.container.textContent ?? "",
    invokeCalls,
    treePaneProps: requireTreePaneProps(),
    mainPaneProps: requireMainPaneProps(),
    sidePaneProps: requireSidePaneProps(),
    expectation: {
      focusedNodeId: "generated-deep-node-1",
      focusedNodeTitle: "Generated Branch Follow-up",
      applySummary: "Applied generated branch follow-up",
      reviewFocusNodeId: "generated-node",
    },
  });

  await act(async () => {
    root.unmount();
    await flush(2);
  });
  dom.cleanup();
});
