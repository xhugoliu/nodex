import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { listen } from "@tauri-apps/api/event";

import {
  countMatchingNodes,
  countNodes,
  filterTree,
  findNodeById,
  formatError,
  inspectPatchDraft,
  listParentCandidates,
  optionalText,
  renderAiDraftFailure,
  renderAiRunArtifact,
  renderAiRunTrace,
  renderExternalRunnerReport,
  renderPatchReport,
  type ConsoleTone,
} from "./app-helpers";
import {
  LANGUAGE_STORAGE_KEY,
  loadLanguagePreference,
  resolveSystemLocale,
  translate,
} from "./i18n";
import {
  EditorPane,
  InspectorPane,
  TreePane,
  WorkspaceStartPane,
} from "./components/panes";
import { hasTauriRuntime, invokeCommand, openPath } from "./tauri";
import type {
  AiRunArtifact,
  AiRunRecord,
  ApplyPatchReport,
  DesktopAiStatus,
  ExternalRunnerReport,
  LanguagePreference,
  Locale,
  NodeDetail,
  PatchDocument,
  PatchDraftOrigin,
  SourceDetail,
  WorkspaceOverview,
} from "./types";

interface ConsoleEntry {
  message: string;
  tone: ConsoleTone;
}

interface WorkspaceLoadedEvent {
  overview: WorkspaceOverview;
  message: string;
  tone: ConsoleTone;
}

interface ConsoleEventPayload {
  message: string;
  tone: ConsoleTone;
}

interface PatchEditorEventPayload {
  patch_json: string;
  message: string;
  tone: ConsoleTone;
  reveal_advanced: boolean;
}

interface LanguageMenuEvent {
  preference: LanguagePreference;
}

export default function App() {
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>(loadLanguagePreference);
  const [systemLocale, setSystemLocale] = useState<Locale>(
    resolveSystemLocale,
  );
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceOverview | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] =
    useState<NodeDetail | null>(null);
  const [selectedNodeAiRuns, setSelectedNodeAiRuns] = useState<AiRunRecord[]>([]);
  const [selectedSourceDetail, setSelectedSourceDetail] =
    useState<SourceDetail | null>(null);
  const [desktopAiStatus, setDesktopAiStatus] = useState<DesktopAiStatus | null>(null);
  const [contextNodeId, setContextNodeId] = useState<string | null>(null);
  const [contextSourceId, setContextSourceId] = useState<string | null>(null);
  const [patchEditor, setPatchEditor] = useState("");
  const [patchDraftOrigin, setPatchDraftOrigin] =
    useState<PatchDraftOrigin | null>(null);
  const [currentDraftRun, setCurrentDraftRun] = useState<AiRunRecord | null>(null);
  const [showAdvancedPatchEditor, setShowAdvancedPatchEditor] = useState(false);
  const [updateNodeTitle, setUpdateNodeTitle] = useState("");
  const [updateNodeKind, setUpdateNodeKind] = useState("");
  const [updateNodeBody, setUpdateNodeBody] = useState("");
  const [addChildTitle, setAddChildTitle] = useState("");
  const [addChildKind, setAddChildKind] = useState("topic");
  const [addChildBody, setAddChildBody] = useState("");
  const [moveNodeParent, setMoveNodeParent] = useState("");
  const [treeQuery, setTreeQuery] = useState("");
  const [consoleEntry, setConsoleEntry] = useState<ConsoleEntry | null>(null);
  const [showConsoleDetails, setShowConsoleDetails] = useState(false);

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
    document.documentElement.lang = locale;
    document.title = t("app.title");
  }, [locale]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    void invokeCommand("set_menu_locale", { locale }).catch(() => {
      // Menu syncing is best-effort; the page should remain usable without it.
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
    if (!hasTauriRuntime()) {
      setConsoleEntry({
        message: t("messages.tauriUnavailable"),
        tone: "error",
      });
      return;
    }

    void invokeCommand<DesktopAiStatus>("get_desktop_ai_status", {})
      .then((status) => {
        setDesktopAiStatus(status);
      })
      .catch((error) => {
        setConsoleMessage(formatError(error), "error");
      });
  }, []);

  useEffect(() => {
    if (!selectedNodeDetail) {
      setUpdateNodeTitle("");
      setUpdateNodeKind("");
      setUpdateNodeBody("");
      setMoveNodeParent("");
      setSelectedNodeAiRuns([]);
      return;
    }

    setUpdateNodeTitle(selectedNodeDetail.node.title ?? "");
    setUpdateNodeKind(selectedNodeDetail.node.kind ?? "");
    setUpdateNodeBody(selectedNodeDetail.node.body ?? "");
    setMoveNodeParent(selectedNodeDetail.parent?.id ?? "");
  }, [selectedNodeDetail]);

  useEffect(() => {
    setAddChildTitle("");
    setAddChildKind("topic");
    setAddChildBody("");
  }, [selectedNodeDetail?.node.id]);

  useEffect(() => {
    if (!patchDraftOrigin || !workspacePath || !hasTauriRuntime()) {
      setCurrentDraftRun(null);
      return;
    }

    const draftRun = selectedNodeAiRuns.find(
      (run) => run.id === patchDraftOrigin.run_id,
    );
    if (draftRun) {
      setCurrentDraftRun(draftRun);
      return;
    }

    let cancelled = false;
    void getAiRunRecord(patchDraftOrigin.run_id)
      .then((run) => {
        if (!cancelled) {
          setCurrentDraftRun(run);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentDraftRun(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [patchDraftOrigin, selectedNodeAiRuns, workspacePath]);

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
            startTransition(() => {
              setWorkspaceOverview(event.payload.overview);
              setWorkspacePath(event.payload.overview.root_dir);
              setTreeQuery("");
              setSelectedNodeId(null);
              setSelectedSourceId(null);
              setSelectedNodeDetail(null);
              setSelectedNodeAiRuns([]);
              setSelectedSourceDetail(null);
              setContextNodeId(null);
              setContextSourceId(null);
              setPatchDraftOrigin(null);
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
          setShowAdvancedPatchEditor(event.payload.reveal_advanced);
          setPatchEditor(event.payload.patch_json);
          setPatchDraftOrigin(null);
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
  const workspaceNodeCount = workspaceOverview
    ? countNodes(workspaceOverview.tree)
    : 0;
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
  const isRootNodeSelected = selectedNodeDetail?.node.parent_id === null;
  const moveParentOptions =
    workspaceOverview && selectedNodeDetail
      ? listParentCandidates(workspaceOverview.tree, selectedNodeDetail.node.id)
      : [];
  const canRunStructureActions =
    Boolean(selectedNodeDetail) &&
    !isRootNodeSelected &&
    moveParentOptions.length > 0;

  function setConsoleMessage(message: string, tone: ConsoleTone) {
    setConsoleEntry({ message, tone });
    setShowConsoleDetails(tone === "error");
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
    options: { preserveSelection?: boolean } = {},
  ) {
    startTransition(() => {
      setWorkspaceOverview(overview);
      setWorkspacePath(overview.root_dir);
      setTreeQuery("");
    });

    if (
      options.preserveSelection &&
      selectedNodeId &&
      findNodeById(overview.tree, selectedNodeId)
    ) {
      const reloaded = await fetchNodeDetail(selectedNodeId, overview.root_dir, {
        silentError: true,
      });
      if (reloaded) {
        return;
      }
    }

    if (
      options.preserveSelection &&
      selectedSourceId &&
      overview.sources.some((source) => source.id === selectedSourceId)
    ) {
      const reloaded = await fetchSourceDetail(
        selectedSourceId,
        overview.root_dir,
        { silentError: true },
      );
      if (reloaded) {
        return;
      }
    }

    const fallbackNodeId =
      overview.tree.node.id ||
      findNodeById(overview.tree, "root")?.node.id ||
      null;
    if (fallbackNodeId) {
      const reloaded = await fetchNodeDetail(fallbackNodeId, overview.root_dir, {
        silentError: true,
      });
      if (reloaded) {
        return;
      }
    }

    setSelectedNodeId(null);
    setSelectedSourceId(null);
    setSelectedNodeDetail(null);
    setSelectedNodeAiRuns([]);
    setSelectedSourceDetail(null);
    setContextNodeId(null);
    setContextSourceId(null);
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

  async function fetchNodeDetail(
    nodeId: string,
    path = workspacePath,
    options: { silentError?: boolean } = {},
  ) {
    if (!ensureWorkspace(path)) {
      return false;
    }

    try {
      const sourceContextId = selectedSourceDetail
        ? selectedSourceId
        : contextSourceId;
      const [detail, aiRuns] = await Promise.all([
        invokeCommand<NodeDetail>("get_node_detail", {
          start_path: path,
          node_id: nodeId,
        }),
        invokeCommand<AiRunRecord[]>("get_ai_run_history", {
          start_path: path,
          node_id: nodeId,
        }),
      ]);
      setContextNodeId(nodeId);
      setContextSourceId(sourceContextId);
      setSelectedNodeId(nodeId);
      setSelectedSourceId(null);
      setSelectedNodeDetail(detail);
      setSelectedNodeAiRuns(aiRuns);
      setSelectedSourceDetail(null);
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
      const nodeContextId = selectedNodeDetail ? selectedNodeId : contextNodeId;
      const detail = await invokeCommand<SourceDetail>("get_source_detail", {
        start_path: path,
        source_id: sourceId,
      });
      setContextSourceId(sourceId);
      setContextNodeId(nodeContextId);
      setSelectedSourceId(sourceId);
      setSelectedNodeId(null);
      setSelectedSourceDetail(detail);
      setSelectedNodeDetail(null);
      setSelectedNodeAiRuns([]);
      return true;
    } catch (error) {
      if (!options.silentError) {
        setConsoleMessage(formatError(error), "error");
      }
      return false;
    }
  }

  async function refreshWorkspace(options: {
    preserveSelection?: boolean;
    successMessage?: boolean;
  } = {}) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const overview = await openWorkspaceCommand(workspacePath);
      await applyOverview(overview, {
        preserveSelection: options.preserveSelection ?? true,
      });

      if (options.successMessage ?? true) {
        setConsoleMessage(
          t("messages.refreshedWorkspace", {
            name: overview.workspace_name,
          }),
          "success",
        );
      }
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
      };
      if (patchDraftOrigin?.kind === "ai_run") {
        args.ai_run_id = patchDraftOrigin.run_id;
      }
      const report = await invokeCommand<ApplyPatchReport>("apply_patch", args);
      const nextDraftOrigin = linkPatchRunToDraftOrigin(
        patchDraftOrigin,
        report.run_id,
      );
      setPatchDraftOrigin(nextDraftOrigin);
      setCurrentDraftRun((current) =>
        nextDraftOrigin?.kind === "ai_run" && report.run_id
          ? attachPatchRunToRun(current, report.run_id, report.summary)
          : current,
      );
      if (nextDraftOrigin?.kind === "ai_run" && report.run_id) {
        setSelectedNodeAiRuns((current) =>
          attachPatchRunToAiRuns(
            current,
            nextDraftOrigin.run_id,
            report.run_id!,
            report.summary,
          ),
        );
      }
      await refreshWorkspace({
        preserveSelection: true,
        successMessage: false,
      });
      setConsoleMessage(renderPatchReport(report, false, t, nextDraftOrigin), "success");
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
      setShowAdvancedPatchEditor(false);
      const patch = await invokeCommand<PatchDocument>("draft_add_node_patch", {
        title,
        parent_id: selectedNodeId,
        kind: optionalText(addChildKind) ?? "topic",
        body: optionalText(addChildBody),
        position: null,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
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
      setShowAdvancedPatchEditor(false);
      const result = await invokeCommand<ExternalRunnerReport>("draft_ai_expand_patch", {
        start_path: workspacePath,
        node_id: selectedNodeId,
      });
      setPatchEditor(JSON.stringify(result.patch, null, 2));
      setPatchDraftOrigin(aiMetadataToDraftOrigin(result));
      setCurrentDraftRun(aiMetadataToRunRecord(result.metadata));
      setSelectedNodeAiRuns((current) =>
        mergeAiRunRecord(current, aiMetadataToRunRecord(result.metadata)),
      );
      setConsoleMessage(
        renderExternalRunnerReport(result, t),
        "success",
      );
    } catch (error) {
      setConsoleMessage(renderAiDraftFailure(error, desktopAiStatus, t), "error");
    }
  }

  async function draftAiExplorePatch(
    by: "risk" | "question" | "action" | "evidence",
  ) {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    try {
      setShowAdvancedPatchEditor(false);
      const result = await invokeCommand<ExternalRunnerReport>(
        "draft_ai_explore_patch",
        {
          start_path: workspacePath,
          node_id: selectedNodeId,
          by,
        },
      );
      setPatchEditor(JSON.stringify(result.patch, null, 2));
      setPatchDraftOrigin(aiMetadataToDraftOrigin(result));
      setCurrentDraftRun(aiMetadataToRunRecord(result.metadata));
      setSelectedNodeAiRuns((current) =>
        mergeAiRunRecord(current, aiMetadataToRunRecord(result.metadata)),
      );
      setConsoleMessage(renderExternalRunnerReport(result, t), "success");
    } catch (error) {
      setConsoleMessage(renderAiDraftFailure(error, desktopAiStatus, t), "error");
    }
  }

  async function draftUpdateNodePatch() {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    if (!selectedNodeDetail) {
      setConsoleMessage(t("messages.selectNodeFirst"), "error");
      return;
    }

    const currentNode = selectedNodeDetail.node;
    const nextTitle = updateNodeTitle.trim();
    const nextKind = updateNodeKind.trim();
    const title = nextTitle && nextTitle !== currentNode.title ? nextTitle : null;
    const kind = nextKind && nextKind !== currentNode.kind ? nextKind : null;
    const currentBody = currentNode.body ?? "";
    const bodyChanged = updateNodeBody !== currentBody;

    if (title === null && kind === null && !bodyChanged) {
      setConsoleMessage(t("messages.updateNeedsField"), "error");
      return;
    }

    try {
      setShowAdvancedPatchEditor(false);
      const patch = await invokeCommand<PatchDocument>(
        "draft_update_node_patch",
        {
          node_id: selectedNodeId,
          title,
          kind,
          body: bodyChanged ? updateNodeBody : null,
        },
      );
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setConsoleMessage(
        t("messages.draftedUpdate", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftMoveNodePatch() {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    if (!canRunStructureActions) {
      setConsoleMessage(t("messages.rootNodeStructureLocked"), "error");
      return;
    }

    const parentId = moveNodeParent.trim();
    if (!parentId) {
      setConsoleMessage(t("messages.provideParentId"), "error");
      return;
    }

    if (!selectedNodeDetail) {
      setConsoleMessage(t("messages.selectNodeFirst"), "error");
      return;
    }

    try {
      if (parentId === (selectedNodeDetail.parent?.id ?? "")) {
        setConsoleMessage(t("messages.moveNeedsChange"), "error");
        return;
      }

      setShowAdvancedPatchEditor(false);
      const patch = await invokeCommand<PatchDocument>("draft_move_node_patch", {
        node_id: selectedNodeId,
        parent_id: parentId,
        position: null,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setConsoleMessage(
        t("messages.draftedMove", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftDeleteNodePatch() {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    if (!canRunStructureActions) {
      setConsoleMessage(t("messages.rootNodeStructureLocked"), "error");
      return;
    }

    try {
      setShowAdvancedPatchEditor(false);
      const patch = await invokeCommand<PatchDocument>(
        "draft_delete_node_patch",
        {
          node_id: selectedNodeId,
        },
      );
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setConsoleMessage(
        t("messages.draftedDelete", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftSourceChunkCitation(chunkId: string, cited: boolean) {
    if (!ensureWorkspace()) {
      return;
    }

    if (!contextNodeId) {
      setConsoleMessage(t("messages.selectNodeContextFirst"), "error");
      return;
    }

    try {
      setShowAdvancedPatchEditor(false);
      const command = cited
        ? "draft_uncite_source_chunk_patch"
        : "draft_cite_source_chunk_patch";
      const patch = await invokeCommand<PatchDocument>(command, {
        node_id: contextNodeId,
        chunk_id: chunkId,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(null);
      setConsoleMessage(
        cited
          ? t("messages.draftedUncitation", { nodeId: contextNodeId })
          : t("messages.draftedCitation", { nodeId: contextNodeId }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  function clearPatchEditor() {
    setPatchEditor("");
    setPatchDraftOrigin(null);
    setShowAdvancedPatchEditor(false);
    setConsoleMessage(t("messages.patchEditorCleared"), "success");
  }

  async function loadAiRunPatch(run: AiRunRecord) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      setShowAdvancedPatchEditor(false);
      const patch = await invokeCommand<PatchDocument>("get_ai_run_patch", {
        start_path: workspacePath,
        run_id: run.id,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setPatchDraftOrigin(aiRunRecordToDraftOrigin(run));
      setCurrentDraftRun(run);
      setConsoleMessage(t("messages.loadedAiRunPatch", { runId: run.id }), "success");
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function getAiRunRecord(runId: string): Promise<AiRunRecord> {
    const currentRun = selectedNodeAiRuns.find((run) => run.id === runId);
    if (currentRun) {
      return currentRun;
    }

    return invokeCommand<AiRunRecord>("get_ai_run_record", {
      start_path: workspacePath,
      run_id: runId,
    });
  }

  async function showAiRunTraceById(runId: string) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const run = await getAiRunRecord(runId);
      setConsoleMessage(
        renderAiRunTrace(run, t),
        run.status === "failed" ? "error" : "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function showAiRunArtifactById(
    runId: string,
    kind: "request" | "response" | "metadata",
  ) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const artifact = await invokeCommand<AiRunArtifact>("get_ai_run_artifact", {
        start_path: workspacePath,
        run_id: runId,
        kind,
      });
      setConsoleMessage(renderAiRunArtifact(artifact, t), "success");
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  function showCurrentDraftOriginTrace() {
    if (!patchDraftOrigin) {
      return;
    }

    void showAiRunTraceById(patchDraftOrigin.run_id);
  }

  function showCurrentDraftOriginArtifact(
    kind: "request" | "response" | "metadata",
  ) {
    if (!patchDraftOrigin) {
      return;
    }

    void showAiRunArtifactById(patchDraftOrigin.run_id, kind);
  }

  return (
    <div className="flex h-screen w-full flex-col gap-3 overflow-hidden px-3 py-3">
      {workspaceOverview ? (
        <main className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_400px]">
          <TreePane
            workspaceOverview={workspaceOverview}
            treeSummary={treeSummary}
            treeQuery={treeQuery}
            query={deferredTreeQuery}
            filteredTree={filteredTree}
            selectedNodeId={selectedNodeId}
            t={t}
            onQueryChange={setTreeQuery}
            onSelectNode={(nodeId) => {
              void fetchNodeDetail(nodeId);
            }}
          />
          <InspectorPane
            hasWorkspace
            desktopAiStatus={desktopAiStatus}
            selectedNodeDetail={selectedNodeDetail}
            selectedNodeAiRuns={selectedNodeAiRuns}
            patchDraftOrigin={patchDraftOrigin}
            selectedSourceDetail={selectedSourceDetail}
            contextNodeId={contextNodeId}
            contextSourceId={contextSourceId}
            consoleMessage={consoleMessage}
            consoleTone={consoleTone}
            showConsoleDetails={showConsoleDetails}
            t={t}
            onToggleConsoleDetails={() => {
              setShowConsoleDetails((current) => !current);
            }}
            onSelectNode={(nodeId) => {
              void fetchNodeDetail(nodeId);
            }}
            onSelectSource={(sourceId) => {
              void fetchSourceDetail(sourceId);
            }}
            onLoadAiRunPatch={(runId) => {
              const run = selectedNodeAiRuns.find((entry) => entry.id === runId);
              if (!run) {
                setConsoleMessage(t("messages.patchDraftOriginTraceUnavailable", { runId }), "error");
                return;
              }
              void loadAiRunPatch(run);
            }}
            onShowAiRunTrace={(run) => {
              void showAiRunTraceById(run.id);
            }}
            onShowAiRunArtifact={(runId, kind) => {
              void showAiRunArtifactById(runId, kind);
            }}
            onDraftCiteChunk={(chunkId) => {
              void draftSourceChunkCitation(chunkId, false);
            }}
            onDraftUnciteChunk={(chunkId) => {
              void draftSourceChunkCitation(chunkId, true);
            }}
          />
          <EditorPane
            hasWorkspace
            desktopAiStatus={desktopAiStatus}
            selectedNodeDetail={selectedNodeDetail}
            updateNodeTitle={updateNodeTitle}
            updateNodeKind={updateNodeKind}
            updateNodeBody={updateNodeBody}
            addChildTitle={addChildTitle}
            addChildKind={addChildKind}
            addChildBody={addChildBody}
            moveNodeParent={moveNodeParent}
            moveParentOptions={moveParentOptions}
            patchEditor={patchEditor}
            patchDraftOrigin={patchDraftOrigin}
            currentDraftRun={currentDraftRun}
            showAdvancedPatchEditor={showAdvancedPatchEditor}
            canRunStructureActions={canRunStructureActions}
            patchDraftState={patchDraftState}
            t={t}
            onTitleChange={setUpdateNodeTitle}
            onKindChange={setUpdateNodeKind}
            onBodyChange={setUpdateNodeBody}
            onAddChildTitleChange={setAddChildTitle}
            onAddChildKindChange={setAddChildKind}
            onAddChildBodyChange={setAddChildBody}
            onParentChange={setMoveNodeParent}
            onPatchEditorChange={setPatchEditor}
            onToggleAdvancedPatchEditor={() => {
              setShowAdvancedPatchEditor((current) => !current);
            }}
            onClearPatchEditor={clearPatchEditor}
            onDraftUpdate={() => {
              void draftUpdateNodePatch();
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
            onDraftMove={() => {
              void draftMoveNodePatch();
            }}
            onDraftDelete={() => {
              void draftDeleteNodePatch();
            }}
            onPreviewPatch={() => {
              void previewPatch();
            }}
            onApplyPatch={() => {
              void applyPatch();
            }}
            onShowDraftOriginTrace={showCurrentDraftOriginTrace}
            onShowDraftOriginArtifact={(kind) => {
              showCurrentDraftOriginArtifact(kind);
            }}
          />
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

function aiMetadataToDraftOrigin(
  result: ExternalRunnerReport,
): PatchDraftOrigin {
  return {
    kind: "ai_run",
    run_id: result.metadata.run_id,
    capability: result.metadata.capability,
    explore_by: result.metadata.explore_by,
    provider: result.metadata.provider,
    model: result.metadata.model,
    patch_run_id: result.metadata.patch_run_id,
  };
}

function aiMetadataToRunRecord(metadata: ExternalRunnerReport["metadata"]): AiRunRecord {
  return {
    id: metadata.run_id,
    capability: metadata.capability,
    explore_by: metadata.explore_by,
    node_id: metadata.node_id,
    command: metadata.command,
    dry_run: metadata.dry_run,
    status: metadata.status,
    started_at: metadata.started_at,
    finished_at: metadata.finished_at,
    request_path: metadata.request_path,
    response_path: metadata.response_path,
    exit_code: metadata.exit_code,
    provider: metadata.provider,
    model: metadata.model,
    provider_run_id: metadata.provider_run_id,
    retry_count: metadata.retry_count,
    last_error_category: metadata.last_error_category,
    last_error_message: metadata.last_error_message,
    last_status_code: metadata.last_status_code,
    patch_run_id: metadata.patch_run_id,
    patch_summary: metadata.patch_summary,
  };
}

function aiRunRecordToDraftOrigin(run: AiRunRecord): PatchDraftOrigin {
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

function mergeAiRunRecord(
  current: AiRunRecord[],
  next: AiRunRecord,
): AiRunRecord[] {
  return [next, ...current.filter((run) => run.id !== next.id)].sort((left, right) => {
    if (right.started_at !== left.started_at) {
      return right.started_at - left.started_at;
    }
    return right.id.localeCompare(left.id);
  });
}

function attachPatchRunToAiRuns(
  current: AiRunRecord[],
  aiRunId: string,
  patchRunId: string,
  patchSummary: string | null,
): AiRunRecord[] {
  return current.map((run) =>
    run.id === aiRunId
      ? {
          ...run,
          patch_run_id: patchRunId,
          patch_summary: patchSummary ?? run.patch_summary,
        }
      : run,
  );
}

function attachPatchRunToRun(
  current: AiRunRecord | null,
  patchRunId: string,
  patchSummary: string | null,
): AiRunRecord | null {
  if (!current) {
    return current;
  }

  return {
    ...current,
    patch_run_id: patchRunId,
    patch_summary: patchSummary ?? current.patch_summary,
  };
}

function linkPatchRunToDraftOrigin(
  origin: PatchDraftOrigin | null,
  patchRunId: string | null,
): PatchDraftOrigin | null {
  if (!origin || !patchRunId) {
    return origin;
  }

  return {
    ...origin,
    patch_run_id: patchRunId,
  };
}
