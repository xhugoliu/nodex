import "@xyflow/react/dist/style.css";
import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { listen } from "@tauri-apps/api/event";

import {
  countMatchingNodes,
  countNodes,
  filterTree,
  findNodeById,
  formatError,
  inspectPatchDraft,
  renderPatchReport,
  renderAiDraftFailure,
  type ConsoleTone,
} from "./app-helpers";
import {
  LANGUAGE_STORAGE_KEY,
  loadLanguagePreference,
  resolveSystemLocale,
  translate,
} from "./i18n";
import { TreePane, WorkspaceStartPane } from "./components/panes";
import { WorkbenchMainPane, WorkbenchSidePane } from "./components/workbench";
import { hasTauriRuntime, invokeCommand, openPath } from "./tauri";
import type {
  ApplyPatchReport,
  ApplyReviewedPatchOutput,
  DesktopAiStatus,
  DraftReviewPayload,
  LanguagePreference,
  Locale,
  NodeWorkspaceContext,
  PatchDocument,
  PatchDraftOrigin,
  SourceDetail,
  SourceImportReport,
  WorkspaceOverview,
} from "./types";

interface ConsoleEntry {
  message: string;
  tone: ConsoleTone;
}

interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

interface CanvasViewState {
  viewport: CanvasViewport;
  followSelection: boolean;
  focusMode: "all" | "selection";
  collapsedNodeIds: string[];
}

const CANVAS_VIEW_STORAGE_KEY = "nodex.desktop.canvas-view";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "nodex.desktop.sidebar-collapsed";
const DEFAULT_CANVAS_VIEW_STATE: CanvasViewState = {
  viewport: {
    x: 0,
    y: 0,
    zoom: 0.82,
  },
  followSelection: true,
  focusMode: "all",
  collapsedNodeIds: [],
};

function canvasViewStorageKey(workspacePath: string) {
  return `${CANVAS_VIEW_STORAGE_KEY}:${workspacePath}`;
}

function loadCanvasViewState(workspacePath: string): CanvasViewState {
  if (!workspacePath || typeof window === "undefined") {
    return DEFAULT_CANVAS_VIEW_STATE;
  }

  try {
    const raw = window.localStorage.getItem(canvasViewStorageKey(workspacePath));
    if (!raw) {
      return DEFAULT_CANVAS_VIEW_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<CanvasViewState> & {
      viewport?: Partial<CanvasViewport>;
    };

    return {
      collapsedNodeIds: Array.isArray(parsed.collapsedNodeIds)
        ? parsed.collapsedNodeIds.filter(
            (value): value is string => typeof value === "string",
          )
        : DEFAULT_CANVAS_VIEW_STATE.collapsedNodeIds,
      focusMode:
        parsed.focusMode === "selection"
          ? "selection"
          : DEFAULT_CANVAS_VIEW_STATE.focusMode,
      followSelection:
        typeof parsed.followSelection === "boolean"
          ? parsed.followSelection
          : DEFAULT_CANVAS_VIEW_STATE.followSelection,
      viewport: {
        x:
          typeof parsed.viewport?.x === "number"
            ? parsed.viewport.x
            : DEFAULT_CANVAS_VIEW_STATE.viewport.x,
        y:
          typeof parsed.viewport?.y === "number"
            ? parsed.viewport.y
            : DEFAULT_CANVAS_VIEW_STATE.viewport.y,
        zoom:
          typeof parsed.viewport?.zoom === "number"
            ? parsed.viewport.zoom
            : DEFAULT_CANVAS_VIEW_STATE.viewport.zoom,
      },
    };
  } catch {
    return DEFAULT_CANVAS_VIEW_STATE;
  }
}

function loadSidebarCollapsedState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

interface WorkspaceLoadedEvent {
  overview: WorkspaceOverview;
  message: string;
  tone: ConsoleTone;
  focus_node_id?: string | null;
}

interface ConsoleEventPayload {
  message: string;
  tone: ConsoleTone;
}

interface PatchEditorEventPayload {
  patch_json: string;
  message: string;
  tone: ConsoleTone;
}

interface LanguageMenuEvent {
  preference: LanguagePreference;
}

export default function App() {
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>(loadLanguagePreference);
  const [systemLocale, setSystemLocale] = useState<Locale>(resolveSystemLocale);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceOverview | null>(null);
  const [selectionPanelTab, setSelectionPanelTab] = useState<"context" | "review">(
    "context",
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeContext, setSelectedNodeContext] =
    useState<NodeWorkspaceContext | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedSourceDetail, setSelectedSourceDetail] =
    useState<SourceDetail | null>(null);
  const [patchEditor, setPatchEditor] = useState("");
  const [patchDraftOrigin, setPatchDraftOrigin] =
    useState<PatchDraftOrigin | null>(null);
  const [reviewDraft, setReviewDraft] = useState<DraftReviewPayload | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyPatchReport | null>(null);
  const [desktopAiStatus, setDesktopAiStatus] = useState<DesktopAiStatus | null>(null);
  const [isDesktopAiStatusLoading, setIsDesktopAiStatusLoading] = useState(false);
  const [lastAiDraftError, setLastAiDraftError] = useState<string | null>(null);
  const [updateNodeTitle, setUpdateNodeTitle] = useState("");
  const [updateNodeBody, setUpdateNodeBody] = useState("");
  const [addChildTitle, setAddChildTitle] = useState("");
  const [treeQuery, setTreeQuery] = useState("");
  const [consoleEntry, setConsoleEntry] = useState<ConsoleEntry | null>(null);
  const [canvasViewState, setCanvasViewState] =
    useState<CanvasViewState>(DEFAULT_CANVAS_VIEW_STATE);
  const [isSidebarCollapsed, setIsSidebarCollapsed] =
    useState<boolean>(loadSidebarCollapsedState);

  const locale =
    languagePreference === "auto" ? systemLocale : languagePreference;
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const deferredTreeQuery = useDeferredValue(treeQuery.trim());
  const deferredPatchEditor = useDeferredValue(patchEditor);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, languagePreference);
  }, [languagePreference]);

  useEffect(() => {
    if (!workspacePath) {
      return;
    }

    window.localStorage.setItem(
      canvasViewStorageKey(workspacePath),
      JSON.stringify(canvasViewState),
    );
  }, [canvasViewState, workspacePath]);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      isSidebarCollapsed ? "true" : "false",
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.title");
  }, [locale]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    void invokeCommand("set_menu_locale", { locale }).catch(() => {
      // Best-effort only.
    });
  }, [locale]);

  useEffect(() => {
    const handleLanguageChange = () => {
      setSystemLocale(resolveSystemLocale());
    };

    window.addEventListener("languagechange", handleLanguageChange);
    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime() || !workspaceOverview) {
      return;
    }

    void refreshDesktopAiStatus({ silentError: true });
  }, [workspaceOverview?.root_dir]);

  useEffect(() => {
    if (!selectedNodeContext) {
      setUpdateNodeTitle("");
      setUpdateNodeBody("");
      setAddChildTitle("");
      return;
    }

    setUpdateNodeTitle(selectedNodeContext.node_detail.node.title ?? "");
    setUpdateNodeBody(selectedNodeContext.node_detail.node.body ?? "");
    setAddChildTitle("");
  }, [selectedNodeContext]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    const unlisteners: Array<() => void> = [];

    const bind = async () => {
      unlisteners.push(
        await listen<WorkspaceLoadedEvent>(
          "desktop://workspace-loaded",
          (event) => {
            void applyOverview(event.payload.overview, {
              preferredNodeId: event.payload.focus_node_id ?? null,
            });
            setConsoleMessage(event.payload.message, event.payload.tone);
          },
        ),
      );

      unlisteners.push(
        await listen<ConsoleEventPayload>("desktop://console", (event) => {
          setConsoleMessage(event.payload.message, event.payload.tone);
        }),
      );

      unlisteners.push(
        await listen<PatchEditorEventPayload>("desktop://patch-editor", (event) => {
          setPatchEditor(event.payload.patch_json);
          setPatchDraftOrigin(null);
          setReviewDraft(null);
          setSelectionPanelTab("review");
          setConsoleMessage(event.payload.message, event.payload.tone);
        }),
      );

      unlisteners.push(
        await listen<LanguageMenuEvent>("desktop://language", (event) => {
          setLanguagePreference(event.payload.preference);
        }),
      );
    };

    void bind();

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  const consoleMessage = consoleEntry?.message ?? t("console.empty");
  const consoleTone = consoleEntry?.tone ?? null;
  const workspaceNodeCount = workspaceOverview ? countNodes(workspaceOverview.tree) : 0;
  const filteredTree = workspaceOverview
    ? filterTree(workspaceOverview.tree, deferredTreeQuery)
    : null;
  const treeResultCount = workspaceOverview
    ? deferredTreeQuery
      ? countMatchingNodes(workspaceOverview.tree, deferredTreeQuery)
      : workspaceNodeCount
    : 0;
  const treeSummary = deferredTreeQuery
    ? t("navigator.searchResults", { count: treeResultCount })
    : t("navigator.totalNodes", { count: workspaceNodeCount });
  const patchDraftState = inspectPatchDraft(deferredPatchEditor);

  function setConsoleMessage(message: string, tone: ConsoleTone) {
    setConsoleEntry({ message, tone });
  }

  function ensureTauri(): boolean {
    if (hasTauriRuntime()) {
      return true;
    }

    setConsoleMessage(t("messages.tauriUnavailable"), "error");
    return false;
  }

  function ensureWorkspace(path = workspacePath): boolean {
    if (!ensureTauri()) {
      return false;
    }
    if (path) {
      return true;
    }

    setConsoleMessage(t("messages.selectWorkspaceFirst"), "error");
    return false;
  }

  function ensureNodeSelected(): boolean {
    if (selectedNodeId) {
      return true;
    }

    setConsoleMessage(t("messages.selectNodeFirst"), "error");
    return false;
  }

  async function applyOverview(
    overview: WorkspaceOverview,
    options: {
      preserveSelection?: boolean;
      skipAutoSelect?: boolean;
      preferredNodeId?: string | null;
    } = {},
  ) {
    const workspaceChanged = overview.root_dir !== workspacePath;

    startTransition(() => {
      setWorkspaceOverview(overview);
      setWorkspacePath(overview.root_dir);
      setTreeQuery("");
      if (workspaceChanged) {
        setCanvasViewState(loadCanvasViewState(overview.root_dir));
      }
    });

    if (
      options.preserveSelection &&
      selectedNodeId &&
      findNodeById(overview.tree, selectedNodeId)
    ) {
      const reloaded = await fetchNodeContext(selectedNodeId, overview.root_dir, {
        silentError: true,
      });
      if (reloaded) {
        if (selectedSourceId) {
          await fetchSourceDetail(selectedSourceId, overview.root_dir, {
            silentError: true,
          });
        }
        return;
      }
    }

    if (options.skipAutoSelect) {
      return;
    }

    if (
      options.preferredNodeId &&
      findNodeById(overview.tree, options.preferredNodeId)
    ) {
      const reloaded = await fetchNodeContext(
        options.preferredNodeId,
        overview.root_dir,
        {
          silentError: true,
        },
      );
      if (reloaded) {
        return;
      }
    }

    const fallbackNodeId =
      overview.tree.node.id || findNodeById(overview.tree, "root")?.node.id || null;
    if (fallbackNodeId) {
      const reloaded = await fetchNodeContext(fallbackNodeId, overview.root_dir, {
        silentError: true,
      });
      if (reloaded) {
        return;
      }
    }

    setSelectedNodeId(null);
    setSelectedNodeContext(null);
    setSelectedSourceId(null);
    setSelectedSourceDetail(null);
    setSelectionPanelTab("context");
    setPatchEditor("");
    setPatchDraftOrigin(null);
    setReviewDraft(null);
    setApplyResult(null);
  }

  async function openWorkspaceCommand(path: string) {
    return invokeCommand<WorkspaceOverview>("open_workspace", {
      start_path: path,
    });
  }

  async function openOrInitWorkspaceCommand(path: string) {
    return invokeCommand<WorkspaceOverview>("open_or_init_workspace", {
      root_path: path,
    });
  }

  async function openWorkspaceFromShortcut() {
    if (!ensureTauri()) {
      return;
    }

    try {
      const selectedPath = await openPath({
        directory: true,
        title: t("workspace.chooseFolder"),
      });
      if (!selectedPath) {
        return;
      }

      const overview = await openOrInitWorkspaceCommand(selectedPath);
      await applyOverview(overview);
      setConsoleMessage(
        t("messages.openedWorkspace", { path: overview.root_dir }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function refreshDesktopAiStatus(options: {
    silentError?: boolean;
    clearDraftError?: boolean;
  } = {}) {
    if (!hasTauriRuntime()) {
      return null;
    }

    setIsDesktopAiStatusLoading(true);
    try {
      const status = await invokeCommand<DesktopAiStatus>("get_desktop_ai_status", {});
      setDesktopAiStatus(status);
      if (options.clearDraftError) {
        setLastAiDraftError(null);
      }
      return status;
    } catch (error) {
      setDesktopAiStatus(null);
      if (!options.silentError) {
        setConsoleMessage(formatError(error), "error");
      }
      return null;
    } finally {
      setIsDesktopAiStatusLoading(false);
    }
  }

  async function importSourceFromShortcut(path = workspacePath) {
    if (!ensureWorkspace(path)) {
      return;
    }

    try {
      const selectedPath = await openPath({
        directory: false,
        title: t("workspace.chooseSourceFile"),
        filters: [
          {
            name: "Markdown / Text",
            extensions: ["md", "txt"],
          },
        ],
      });
      if (!selectedPath) {
        return;
      }

      const report = await invokeCommand<SourceImportReport>("import_source", {
        start_path: path,
        source_path: selectedPath,
      });
      const overview = await openWorkspaceCommand(path);
      await applyOverview(overview, {
        preferredNodeId: report.root_node_id,
      });
      setConsoleMessage(
        t("messages.importedSource", {
          name: report.original_name,
          title: report.root_title,
        }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function fetchNodeContext(
    nodeId: string,
    path = workspacePath,
    options: { silentError?: boolean } = {},
  ) {
    if (!ensureWorkspace(path)) {
      return false;
    }

    try {
      const context = await invokeCommand<NodeWorkspaceContext>(
        "get_node_workspace_context",
        {
          start_path: path,
          node_id: nodeId,
        },
      );
      setSelectedNodeId(nodeId);
      setSelectedNodeContext(context);
      setSelectedSourceId(null);
      setSelectedSourceDetail(null);
      setSelectionPanelTab("context");
      return true;
    } catch (error) {
      if (!options.silentError) {
        setConsoleMessage(formatError(error), "error");
      }
      return false;
    }
  }

  async function fetchSourceDetail(
    sourceId: string,
    path = workspacePath,
    options: { silentError?: boolean } = {},
  ) {
    if (!ensureWorkspace(path)) {
      return false;
    }

    try {
      const detail = await invokeCommand<SourceDetail>("get_source_detail", {
        start_path: path,
        source_id: sourceId,
      });
      setSelectedSourceId(sourceId);
      setSelectedSourceDetail(detail);
      setApplyResult(null);
      setSelectionPanelTab("context");
      return true;
    } catch (error) {
      if (!options.silentError) {
        setConsoleMessage(formatError(error), "error");
      }
      return false;
    }
  }

  async function refreshWorkspace() {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const overview = await openWorkspaceCommand(workspacePath);
      await applyOverview(overview, { preserveSelection: true });
      setConsoleMessage(
        t("messages.refreshedWorkspace", {
          name: overview.workspace_name,
        }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function previewPatch() {
    if (!ensureWorkspace()) {
      return;
    }

    const patchJson = patchEditor.trim();
    if (!patchJson) {
      setConsoleMessage(t("messages.patchEditorEmpty"), "error");
      return;
    }

    try {
      const report = await invokeCommand<ApplyPatchReport>("preview_patch", {
        start_path: workspacePath,
        patch_json: patchJson,
      });
      setApplyResult(null);
      setConsoleMessage(renderPatchReport(report, true, t, patchDraftOrigin), "success");
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function applyPatch() {
    if (!ensureWorkspace()) {
      return;
    }

    const patchJson = patchEditor.trim();
    if (!patchJson) {
      setConsoleMessage(t("messages.patchEditorEmpty"), "error");
      return;
    }

    try {
      const args: Record<string, unknown> = {
        start_path: workspacePath,
        patch_json: patchJson,
        focus_node_id: selectedNodeId,
      };
      if (patchDraftOrigin?.kind === "ai_run") {
        args.ai_run_id = patchDraftOrigin.run_id;
      }

      const output = await invokeCommand<ApplyReviewedPatchOutput>(
        "apply_reviewed_patch",
        args,
      );
      await applyOverview(output.overview, {
        preserveSelection: false,
        skipAutoSelect: true,
      });
      setApplyResult(output.report);
      const nextNodeId =
        output.preferred_focus_node_id ??
        output.focus_node_context?.node_detail.node.id ??
        null;
      if (nextNodeId) {
        await fetchNodeContext(nextNodeId, output.overview.root_dir, {
          silentError: true,
        });
      }
      setSelectionPanelTab("context");
      setConsoleMessage(
        renderPatchReport(output.report, false, t, patchDraftOrigin),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftAddChildPatch() {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    const title = addChildTitle.trim();
    if (!title) {
      setConsoleMessage(t("messages.addChildRequiresTitle"), "error");
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("draft_add_node_patch", {
        title,
        parent_id: selectedNodeId,
        kind: "topic",
        body: null,
        position: null,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setReviewDraft(null);
      setApplyResult(null);
      setSelectionPanelTab("review");
      setConsoleMessage(
        t("messages.draftedAddChild", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftAiExpandPatch() {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    try {
      setLastAiDraftError(null);
      const result = await invokeCommand<DraftReviewPayload>("draft_node_expand", {
        start_path: workspacePath,
        node_id: selectedNodeId,
      });
      setPatchEditor(JSON.stringify(result.patch, null, 2));
      setPatchDraftOrigin(aiRunRecordToDraftOrigin(result.run));
      setReviewDraft(result);
      setApplyResult(null);
      setSelectionPanelTab("review");
      void refreshDesktopAiStatus({ silentError: true, clearDraftError: true });
      setConsoleMessage(
        renderPatchReport(result.report, true, t, aiRunRecordToDraftOrigin(result.run)),
        "success",
      );
    } catch (error) {
      const status = await refreshDesktopAiStatus({ silentError: true });
      setLastAiDraftError(formatError(error));
      setConsoleMessage(renderAiDraftFailure(error, status, t), "error");
    }
  }

  async function draftAiExplorePatch(
    by: "risk" | "question" | "action" | "evidence",
  ) {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    try {
      setLastAiDraftError(null);
      const result = await invokeCommand<DraftReviewPayload>("draft_node_explore", {
        start_path: workspacePath,
        node_id: selectedNodeId,
        by,
      });
      setPatchEditor(JSON.stringify(result.patch, null, 2));
      setPatchDraftOrigin(aiRunRecordToDraftOrigin(result.run));
      setReviewDraft(result);
      setApplyResult(null);
      setSelectionPanelTab("review");
      void refreshDesktopAiStatus({ silentError: true, clearDraftError: true });
      setConsoleMessage(
        renderPatchReport(result.report, true, t, aiRunRecordToDraftOrigin(result.run)),
        "success",
      );
    } catch (error) {
      const status = await refreshDesktopAiStatus({ silentError: true });
      setLastAiDraftError(formatError(error));
      setConsoleMessage(renderAiDraftFailure(error, status, t), "error");
    }
  }

  async function draftUpdateNodePatch() {
    if (!ensureNodeSelected() || !ensureWorkspace() || !selectedNodeContext) {
      return;
    }

    const currentNode = selectedNodeContext.node_detail.node;
    const title = updateNodeTitle.trim();
    const body = updateNodeBody;
    const nextTitle = title && title !== currentNode.title ? title : null;
    const nextBody = body !== (currentNode.body ?? "") ? body : null;

    if (nextTitle === null && nextBody === null) {
      setConsoleMessage(t("messages.updateNeedsField"), "error");
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("draft_update_node_patch", {
        node_id: selectedNodeId,
        title: nextTitle,
        kind: null,
        body: nextBody,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setReviewDraft(null);
      setApplyResult(null);
      setSelectionPanelTab("review");
      setConsoleMessage(
        t("messages.draftedUpdate", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftCiteChunkPatch(chunkId: string) {
    if (!ensureNodeSelected()) {
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("draft_cite_source_chunk_patch", {
        node_id: selectedNodeId,
        chunk_id: chunkId,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setReviewDraft(null);
      setApplyResult(null);
      setSelectionPanelTab("review");
      setConsoleMessage(
        t("messages.draftedCitation", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftUnciteChunkPatch(chunkId: string) {
    if (!ensureNodeSelected()) {
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("draft_uncite_source_chunk_patch", {
        node_id: selectedNodeId,
        chunk_id: chunkId,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setReviewDraft(null);
      setApplyResult(null);
      setSelectionPanelTab("review");
      setConsoleMessage(
        t("messages.draftedUncitation", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  return (
    <div className="flex h-screen w-full flex-col gap-3 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),rgba(243,244,246,0.98),rgba(229,231,235,0.92))] px-3 py-3">
      {workspaceOverview ? (
        <main className="flex min-h-0 flex-1 flex-col gap-3">
          <div
            className={[
              "grid min-h-0 flex-1 gap-3",
              isSidebarCollapsed
                ? "xl:grid-cols-[76px_minmax(0,1.58fr)_320px] 2xl:grid-cols-[80px_minmax(0,1.66fr)_336px]"
                : "xl:grid-cols-[264px_minmax(0,1.42fr)_320px] 2xl:grid-cols-[272px_minmax(0,1.5fr)_336px]",
            ].join(" ")}
          >
            <TreePane
              isCollapsed={isSidebarCollapsed}
              workspaceOverview={workspaceOverview}
              treeSummary={treeSummary}
              treeQuery={treeQuery}
              query={deferredTreeQuery}
              filteredTree={filteredTree}
              selectedNodeId={selectedNodeId}
              t={t}
              onToggleCollapse={() => {
                setIsSidebarCollapsed((current) => !current);
              }}
              onImportSource={() => {
                void importSourceFromShortcut();
              }}
              onQueryChange={setTreeQuery}
              onSelectNode={(nodeId) => {
                void fetchNodeContext(nodeId);
              }}
            />

            <WorkbenchMainPane
              tree={workspaceOverview.tree}
              selectedNodeId={selectedNodeId}
              canvasViewport={canvasViewState.viewport}
              canvasFollowSelection={canvasViewState.followSelection}
              canvasFocusMode={canvasViewState.focusMode}
              collapsedNodeIds={canvasViewState.collapsedNodeIds}
              addChildTitle={addChildTitle}
              t={t}
              onAddChildTitleChange={setAddChildTitle}
              onCanvasViewportChange={(viewport) => {
                setCanvasViewState((current) => ({
                  ...current,
                  viewport,
                }));
              }}
              onCanvasFollowSelectionChange={(followSelection) => {
                setCanvasViewState((current) => ({
                  ...current,
                  followSelection,
                }));
              }}
              onCanvasFocusModeChange={(focusMode) => {
                setCanvasViewState((current) => ({
                  ...current,
                  focusMode,
                }));
              }}
              onCanvasToggleCollapse={(nodeId) => {
                setCanvasViewState((current) => {
                  const collapsedNodeIds = current.collapsedNodeIds.includes(nodeId)
                    ? current.collapsedNodeIds.filter((id) => id !== nodeId)
                    : [...current.collapsedNodeIds, nodeId];

                  return {
                    ...current,
                    collapsedNodeIds,
                  };
                });
              }}
              onSelectNode={(nodeId) => {
                void fetchNodeContext(nodeId);
              }}
              onDraftAiExpand={() => {
                void draftAiExpandPatch();
              }}
              onDraftAiExplore={(by) => {
                void draftAiExplorePatch(by);
              }}
              onDraftAddChild={() => {
                void draftAddChildPatch();
              }}
            />

            <WorkbenchSidePane
              selectionTab={selectionPanelTab}
              aiDraftStatus={desktopAiStatus}
              aiDraftStatusLoading={isDesktopAiStatusLoading}
              aiDraftError={lastAiDraftError}
              nodeContext={selectedNodeContext}
              applyResult={applyResult}
              updateNodeTitle={updateNodeTitle}
              updateNodeBody={updateNodeBody}
              selectedSourceDetail={selectedSourceDetail}
              selectedSourceChunkId={null}
              reviewDraft={reviewDraft}
              patchDraftState={patchDraftState}
              t={t}
              onSelectSelectionTab={setSelectionPanelTab}
              onRefreshAiDraftStatus={() => {
                void refreshDesktopAiStatus({ clearDraftError: true });
              }}
              onTitleChange={setUpdateNodeTitle}
              onBodyChange={setUpdateNodeBody}
              onOpenSource={(sourceId) => {
                void fetchSourceDetail(sourceId);
              }}
              onOpenCreatedNode={(nodeId) => {
                void fetchNodeContext(nodeId);
              }}
              onOpenLinkedNode={(nodeId) => {
                void fetchNodeContext(nodeId);
              }}
              onBackToNodeContext={() => {
                setSelectedSourceId(null);
                setSelectedSourceDetail(null);
              }}
              onDraftCiteChunk={(chunkId) => {
                void draftCiteChunkPatch(chunkId);
              }}
              onDraftUnciteChunk={(chunkId) => {
                void draftUnciteChunkPatch(chunkId);
              }}
              onDraftUpdate={() => {
                void draftUpdateNodePatch();
              }}
              onPreviewPatch={() => {
                void previewPatch();
              }}
              onApplyPatch={() => {
                void applyPatch();
              }}
            />
          </div>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1">
          <WorkspaceStartPane
            message={consoleMessage}
            tone={consoleTone}
            showStatus={Boolean(consoleEntry)}
            t={t}
            onOpenWorkspace={() => {
              void openWorkspaceFromShortcut();
            }}
          />
        </main>
      )}
    </div>
  );
}

function aiRunRecordToDraftOrigin(run: DraftReviewPayload["run"]): PatchDraftOrigin {
  return {
    kind: "ai_run",
    run_id: run.id,
    capability: run.capability,
    explore_by: run.explore_by,
    provider: run.provider,
    model: run.model,
    patch_run_id: run.patch_run_id,
  };
}
