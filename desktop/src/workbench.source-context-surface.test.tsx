import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SourceContextSurface } from "./components/workbench";
import type {
  NodeWorkspaceContext,
  SourceDetail,
} from "./types";

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

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
    chunks: [
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
        linked_nodes: [
          { id: "node-linked-1", title: "Provider Setup" },
        ],
        evidence_nodes: [],
        evidence_links: [
          {
            node: { id: "node-evidence-1", title: "Auth Evidence" },
            citation_kind: "direct",
            rationale: "This section explains why the current node should reuse the default auth route.",
          },
        ],
      },
    ],
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
              rationale: "This section explains why the current node should reuse the default auth route.",
            },
          ],
        },
      ],
    },
  };
}

function renderSurface(options: {
  detail?: SourceDetail;
  nodeContext?: NodeWorkspaceContext | null;
}) {
  return renderToStaticMarkup(
    <SourceContextSurface
      detail={options.detail ?? makeSourceDetail()}
      nodeContext={
        options.nodeContext === undefined ? makeNodeContext() : options.nodeContext
      }
      onBackToNodeContext={() => {}}
      onOpenDraft={() => {}}
      onDraftCiteChunk={() => {}}
      onDraftUnciteChunk={() => {}}
      onOpenLinkedNode={() => {}}
      selectedSourceChunkId={null}
      t={t}
    />,
  );
}

test("SourceContextSurface renders rationale summary, continue entries, and cite actions when node context is present", () => {
  const html = renderSurface({});

  assert.match(html, /detail\.sourceContextSummaryTitle/);
  assert.match(html, /detail\.evidenceWorthReading/);
  assert.match(html, /default auth route/);
  assert.match(html, /workbench\.contextNextTitle/);
  assert.match(html, /workbench\.contextNextSourceDraft/);
  assert.match(html, /workbench\.openDraft/);
  assert.match(html, /detail\.sourceContinueTitle/);
  assert.match(html, /Provider Setup/);
  assert.match(html, /Auth Evidence/);
  assert.match(html, /detail\.citationContextReadyForNode/);
  assert.match(html, /detail\.draftCite/);
  assert.match(html, /detail\.draftUncite/);
});

test("SourceContextSurface hides citation actions and shows empty continue state without node context", () => {
  const detail = makeSourceDetail();
  detail.chunks = [
    {
      chunk: {
        id: "chunk-empty",
        source_id: "source-1",
        ordinal: 0,
        label: "Overview",
        text: "A plain source summary without linked nodes.",
        start_line: 1,
        end_line: 2,
      },
      linked_nodes: [],
      evidence_nodes: [],
      evidence_links: [],
    },
  ];

  const html = renderSurface({
    detail,
    nodeContext: null,
  });

  assert.match(html, /detail\.citationContextMissing/);
  assert.match(html, /detail\.sourceContinueEmpty/);
  assert.doesNotMatch(html, /detail\.draftCite/);
  assert.doesNotMatch(html, /detail\.draftUncite/);
});

test("SourceContextSurface keeps continue entries focused by hiding duplicate evidence nodes already listed as related nodes", () => {
  const detail = makeSourceDetail();
  detail.chunks = [
    {
      chunk: {
        id: "chunk-shared",
        source_id: "source-1",
        ordinal: 0,
        label: "Shared next step",
        text: "A source chunk that points to the same follow-up node in both continue groups.",
        start_line: 3,
        end_line: 6,
      },
      linked_nodes: [{ id: "node-shared-1", title: "Shared next step" }],
      evidence_nodes: [],
      evidence_links: [
        {
          node: { id: "node-shared-1", title: "Shared next step" },
          citation_kind: "direct",
          rationale: "This is the same node already suggested as a direct continue path.",
        },
      ],
    },
  ];

  const html = renderSurface({ detail });

  assert.match(html, /detail\.sourceContinueLinkedNodes/);
  assert.doesNotMatch(html, /detail\.sourceContinueEvidenceNodes/);
  assert.match(
    html,
    /detail\.sourceContextStatContinue \{&quot;count&quot;:1\}/,
  );
});
