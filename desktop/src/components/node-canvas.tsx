import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import { memo, useEffect, useMemo } from "react";

import type { TreeNode } from "../types";
import { EmptyBox } from "./common";

const NODE_X_GAP = 248;
const NODE_Y_GAP = 92;
const ROOT_NODE_WIDTH = 228;
const CHILD_NODE_WIDTH = 196;

type CanvasNodeData = Record<string, unknown> & {
  title: string;
  kind: string;
  childCount: number;
  isRoot: boolean;
  addChildTitle: string;
  addChildPlaceholder: string;
  draftAddChildLabel: string;
  draftAiExpandLabel: string;
  draftAiExploreQuestionLabel: string;
  draftAiExploreRiskLabel: string;
  draftAiExploreActionLabel: string;
  draftAiExploreEvidenceLabel: string;
  canDraftAddChild: boolean;
  onAddChildTitleChange: (value: string) => void;
  onDraftAddChild: () => void;
  onDraftAiExpand: () => void;
  onDraftAiExplore: (by: "risk" | "question" | "action" | "evidence") => void;
};

type CanvasFlowNode = Node<CanvasNodeData, "mindmap">;

const nodeTypes = {
  mindmap: memo(function MindMapNode({
    data,
    selected,
  }: NodeProps<CanvasFlowNode>) {
    return (
      <div
        className="nodex-flow__node-card"
        data-selected={selected ? "true" : "false"}
        data-root={data.isRoot ? "true" : "false"}
      >
        <Handle
          className="nodex-flow__handle"
          isConnectable={false}
          position={Position.Left}
          type="target"
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="nodex-flow__node-title">{data.title}</div>
            <div className="nodex-flow__node-kind">{data.kind}</div>
          </div>
          {data.childCount ? (
            <div className="nodex-flow__node-pill">{data.childCount}</div>
          ) : null}
        </div>
        {selected ? (
          <div
            className="nodex-flow__node-actions"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <input
              className="nodex-flow__node-input"
              placeholder={data.addChildPlaceholder}
              value={data.addChildTitle}
              onChange={(event) => data.onAddChildTitleChange(event.target.value)}
            />
            <div className="nodex-flow__node-action-row">
              <button
                className="nodex-flow__node-action nodex-flow__node-action--ghost"
                onClick={() => data.onDraftAiExpand()}
                type="button"
              >
                {data.draftAiExpandLabel}
              </button>
              <button
                className="nodex-flow__node-action nodex-flow__node-action--primary"
                disabled={!data.canDraftAddChild}
                onClick={() => data.onDraftAddChild()}
                type="button"
              >
                {data.draftAddChildLabel}
              </button>
            </div>
            <div className="nodex-flow__node-action-grid">
              <button
                className="nodex-flow__node-action nodex-flow__node-action--subtle"
                onClick={() => data.onDraftAiExplore("question")}
                type="button"
              >
                {data.draftAiExploreQuestionLabel}
              </button>
              <button
                className="nodex-flow__node-action nodex-flow__node-action--subtle"
                onClick={() => data.onDraftAiExplore("risk")}
                type="button"
              >
                {data.draftAiExploreRiskLabel}
              </button>
              <button
                className="nodex-flow__node-action nodex-flow__node-action--subtle"
                onClick={() => data.onDraftAiExplore("action")}
                type="button"
              >
                {data.draftAiExploreActionLabel}
              </button>
              <button
                className="nodex-flow__node-action nodex-flow__node-action--subtle"
                onClick={() => data.onDraftAiExplore("evidence")}
                type="button"
              >
                {data.draftAiExploreEvidenceLabel}
              </button>
            </div>
          </div>
        ) : null}
        <Handle
          className="nodex-flow__handle"
          isConnectable={false}
          position={Position.Right}
          type="source"
        />
      </div>
    );
  }),
};

export function NodeCanvas(props: {
  tree: TreeNode | null;
  selectedNodeId: string | null;
  viewport: Viewport;
  followSelection: boolean;
  addChildTitle: string;
  addChildPlaceholder: string;
  draftAddChildLabel: string;
  draftAiExpandLabel: string;
  draftAiExploreQuestionLabel: string;
  draftAiExploreRiskLabel: string;
  draftAiExploreActionLabel: string;
  draftAiExploreEvidenceLabel: string;
  followSelectionLabel: string;
  resetViewLabel: string;
  onSelectNode: (nodeId: string) => void;
  onAddChildTitleChange: (value: string) => void;
  onViewportChange: (viewport: Viewport) => void;
  onFollowSelectionChange: (followSelection: boolean) => void;
  onDraftAddChild: () => void;
  onDraftAiExpand: () => void;
  onDraftAiExplore: (by: "risk" | "question" | "action" | "evidence") => void;
}) {
  const projected = useMemo(
    () =>
      props.tree
        ? buildCanvasProjection({
            tree: props.tree,
            selectedNodeId: props.selectedNodeId,
            addChildTitle: props.addChildTitle,
            addChildPlaceholder: props.addChildPlaceholder,
            draftAddChildLabel: props.draftAddChildLabel,
            draftAiExpandLabel: props.draftAiExpandLabel,
            draftAiExploreQuestionLabel: props.draftAiExploreQuestionLabel,
            draftAiExploreRiskLabel: props.draftAiExploreRiskLabel,
            draftAiExploreActionLabel: props.draftAiExploreActionLabel,
            draftAiExploreEvidenceLabel: props.draftAiExploreEvidenceLabel,
            onAddChildTitleChange: props.onAddChildTitleChange,
            onDraftAddChild: props.onDraftAddChild,
            onDraftAiExpand: props.onDraftAiExpand,
            onDraftAiExplore: props.onDraftAiExplore,
          })
        : null,
    [
      props.addChildPlaceholder,
      props.addChildTitle,
      props.draftAddChildLabel,
      props.draftAiExpandLabel,
      props.draftAiExploreActionLabel,
      props.draftAiExploreEvidenceLabel,
      props.draftAiExploreQuestionLabel,
      props.draftAiExploreRiskLabel,
      props.onAddChildTitleChange,
      props.onDraftAddChild,
      props.onDraftAiExpand,
      props.onDraftAiExplore,
      props.selectedNodeId,
      props.tree,
    ],
  );

  if (!projected) {
    return (
      <EmptyBox className="m-4">
        Select one node from the tree to open the first canvas view.
      </EmptyBox>
    );
  }

  return (
    <div className="nodex-flow">
      <ReactFlowProvider>
        <NodeCanvasSurface
          edges={projected.edges}
          nodes={projected.nodes}
          viewport={props.viewport}
          followSelection={props.followSelection}
          followSelectionLabel={props.followSelectionLabel}
          resetViewLabel={props.resetViewLabel}
          selectedNodeId={props.selectedNodeId}
          onSelectNode={props.onSelectNode}
          onViewportChange={props.onViewportChange}
          onFollowSelectionChange={props.onFollowSelectionChange}
        />
      </ReactFlowProvider>
    </div>
  );
}

function NodeCanvasSurface(props: {
  nodes: CanvasFlowNode[];
  edges: Edge[];
  viewport: Viewport;
  followSelection: boolean;
  followSelectionLabel: string;
  resetViewLabel: string;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onViewportChange: (viewport: Viewport) => void;
  onFollowSelectionChange: (followSelection: boolean) => void;
}) {
  const typedNodeTypes = nodeTypes;

  return (
    <ReactFlow<CanvasFlowNode, Edge>
      className="nodex-flow__surface"
      defaultEdgeOptions={{
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
        },
        style: {
          stroke: "rgba(17, 24, 39, 0.22)",
          strokeWidth: 1.35,
        },
        type: "smoothstep",
      }}
      edges={props.edges}
      fitView
      maxZoom={1.35}
      minZoom={0.24}
      nodeOrigin={[0.5, 0.5]}
      nodes={props.nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={typedNodeTypes}
      onNodeClick={(_event, node) => props.onSelectNode(node.id)}
      onViewportChange={props.onViewportChange}
      proOptions={{ hideAttribution: true }}
      selectionOnDrag={false}
      viewport={props.viewport}
      zoomOnDoubleClick={false}
    >
      <Background
        color="rgba(15, 23, 42, 0.12)"
        gap={20}
        size={1.2}
        variant={BackgroundVariant.Dots}
      />
      <Controls position="bottom-right" showInteractive={false} />
      <CanvasViewportPanel
        followSelection={props.followSelection}
        followSelectionLabel={props.followSelectionLabel}
        nodes={props.nodes}
        onFollowSelectionChange={props.onFollowSelectionChange}
        onViewportChange={props.onViewportChange}
        resetViewLabel={props.resetViewLabel}
        selectedNodeId={props.selectedNodeId}
      />
      <CanvasViewportController
        followSelection={props.followSelection}
        nodes={props.nodes}
        onViewportChange={props.onViewportChange}
        selectedNodeId={props.selectedNodeId}
      />
    </ReactFlow>
  );
}

function CanvasViewportController(props: {
  followSelection: boolean;
  nodes: CanvasFlowNode[];
  onViewportChange: (viewport: Viewport) => void;
  selectedNodeId: string | null;
}) {
  const reactFlow = useReactFlow<CanvasFlowNode, Edge>();

  useEffect(() => {
    if (!props.followSelection || !props.nodes.length) {
      return;
    }

    const targetNode = props.selectedNodeId
      ? props.nodes.find((node) => node.id === props.selectedNodeId)
      : null;

    if (!targetNode) {
      void reactFlow
        .fitView({
          duration: 360,
          maxZoom: 0.96,
          padding: 0.24,
        })
        .then(() => {
          props.onViewportChange(reactFlow.getViewport());
        });
      return;
    }

    void reactFlow
      .setCenter(targetNode.position.x, targetNode.position.y, {
        duration: 360,
        zoom: targetNode.data.isRoot ? 0.82 : 1.02,
      })
      .then(() => {
        props.onViewportChange(reactFlow.getViewport());
      });
  }, [
    props.followSelection,
    props.nodes,
    props.onViewportChange,
    props.selectedNodeId,
    reactFlow,
  ]);

  return null;
}

function CanvasViewportPanel(props: {
  followSelection: boolean;
  followSelectionLabel: string;
  nodes: CanvasFlowNode[];
  onFollowSelectionChange: (followSelection: boolean) => void;
  onViewportChange: (viewport: Viewport) => void;
  resetViewLabel: string;
  selectedNodeId: string | null;
}) {
  const reactFlow = useReactFlow<CanvasFlowNode, Edge>();

  return (
    <Panel position="top-right">
      <div className="nodex-flow__panel">
        <label className="nodex-flow__panel-toggle">
          <input
            checked={props.followSelection}
            onChange={(event) => props.onFollowSelectionChange(event.target.checked)}
            type="checkbox"
          />
          <span>{props.followSelectionLabel}</span>
        </label>
        <button
          className="nodex-flow__panel-button"
          onClick={() => {
            const targetNode = props.selectedNodeId
              ? props.nodes.find((node) => node.id === props.selectedNodeId)
              : null;

            props.onFollowSelectionChange(true);

            if (!targetNode) {
              void reactFlow.fitView({
                duration: 260,
                maxZoom: 0.96,
                padding: 0.24,
              }).then(() => {
                props.onViewportChange(reactFlow.getViewport());
              });
              return;
            }

            void reactFlow
              .setCenter(targetNode.position.x, targetNode.position.y, {
                duration: 260,
                zoom: targetNode.data.isRoot ? 0.82 : 1.02,
              })
              .then(() => {
                props.onViewportChange(reactFlow.getViewport());
              });
          }}
          type="button"
        >
          {props.resetViewLabel}
        </button>
      </div>
    </Panel>
  );
}

function buildCanvasProjection(input: {
  tree: TreeNode;
  selectedNodeId: string | null;
  addChildTitle: string;
  addChildPlaceholder: string;
  draftAddChildLabel: string;
  draftAiExpandLabel: string;
  draftAiExploreQuestionLabel: string;
  draftAiExploreRiskLabel: string;
  draftAiExploreActionLabel: string;
  draftAiExploreEvidenceLabel: string;
  onAddChildTitleChange: (value: string) => void;
  onDraftAddChild: () => void;
  onDraftAiExpand: () => void;
  onDraftAiExplore: (by: "risk" | "question" | "action" | "evidence") => void;
}): {
  nodes: CanvasFlowNode[];
  edges: Edge[];
} {
  const nodes = new Array<CanvasFlowNode>();
  const edges = new Array<Edge>();
  let leafIndex = 0;

  const visit = (treeNode: TreeNode, depth: number): number => {
    const childYs = treeNode.children.map((child) => {
      const childY = visit(child, depth + 1);
      edges.push({
        id: `${treeNode.node.id}->${child.node.id}`,
        source: treeNode.node.id,
        target: child.node.id,
      });
      return childY;
    });

    const y =
      childYs.length > 0
        ? (childYs[0] + childYs[childYs.length - 1]) / 2
        : leafIndex++ * NODE_Y_GAP;

    nodes.push({
      id: treeNode.node.id,
      data: {
        addChildPlaceholder: input.addChildPlaceholder,
        addChildTitle:
          treeNode.node.id === input.selectedNodeId ? input.addChildTitle : "",
        canDraftAddChild:
          treeNode.node.id === input.selectedNodeId &&
          input.addChildTitle.trim().length > 0,
        draftAddChildLabel: input.draftAddChildLabel,
        draftAiExpandLabel: input.draftAiExpandLabel,
        draftAiExploreQuestionLabel: input.draftAiExploreQuestionLabel,
        draftAiExploreRiskLabel: input.draftAiExploreRiskLabel,
        draftAiExploreActionLabel: input.draftAiExploreActionLabel,
        draftAiExploreEvidenceLabel: input.draftAiExploreEvidenceLabel,
        title: treeNode.node.title,
        kind: treeNode.node.kind,
        childCount: treeNode.children.length,
        isRoot: treeNode.node.parent_id === null,
        onAddChildTitleChange: input.onAddChildTitleChange,
        onDraftAddChild: input.onDraftAddChild,
        onDraftAiExpand: input.onDraftAiExpand,
        onDraftAiExplore: input.onDraftAiExplore,
      },
      position: {
        x: depth * NODE_X_GAP,
        y,
      },
      selected: treeNode.node.id === input.selectedNodeId,
      sourcePosition: Position.Right,
      style: {
        width:
          treeNode.node.parent_id === null ? ROOT_NODE_WIDTH : CHILD_NODE_WIDTH,
      },
      targetPosition: Position.Left,
      type: "mindmap",
    });

    return y;
  };

  visit(input.tree, 0);

  return {
    nodes,
    edges,
  };
}
