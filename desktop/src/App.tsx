import { startTransition, useEffect, useState } from "react";

import {
  LANGUAGE_STORAGE_KEY,
  loadLanguagePreference,
  resolveSystemLocale,
  translate,
} from "./i18n";
import { hasTauriRuntime, invokeCommand, openPath } from "./tauri";
import type {
  ApplyPatchReport,
  LanguagePreference,
  Locale,
  NodeDetail,
  PatchDocument,
  PatchRunRecord,
  SnapshotRecord,
  SourceDetail,
  SourceImportPreview,
  SourceImportReport,
  TreeNode,
  WorkspaceOverview,
} from "./types";

type ConsoleTone = "success" | "error";

interface ConsoleEntry {
  message: string;
  tone: ConsoleTone;
}

const panelClass =
  "surface-panel surface-blur rounded-[28px] border border-[color:var(--line)] p-4 shadow-[var(--shadow)] lg:p-5";
const cardClass =
  "surface-card rounded-[22px] border border-[color:var(--line-soft)] p-4";
const inputClass =
  "w-full rounded-2xl border border-[color:var(--line)] bg-white/80 px-4 py-3 text-sm text-[color:var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[rgba(15,118,110,0.18)]";
const textareaClass = `${inputClass} min-h-[7rem] resize-y`;
const patchTextareaClass = `${inputClass} min-h-[20rem] resize-y`;
const subtleTextClass = "text-sm leading-6 text-[color:var(--muted)]";
const actionButtonClass =
  "rounded-full border border-transparent px-4 py-2.5 text-sm font-medium text-[color:var(--text)] transition disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = `${actionButtonClass} bg-[#eadfca] hover:bg-[#e1d3ba]`;
const primaryButtonClass = `${actionButtonClass} bg-[color:var(--accent)] text-[#f8fffd] hover:bg-[color:var(--accent-strong)]`;
const dangerButtonClass =
  `${actionButtonClass} bg-[rgba(180,35,24,0.12)] text-[color:var(--danger)] hover:bg-[rgba(180,35,24,0.18)]`;
const ghostButtonClass =
  `${actionButtonClass} border-[color:var(--line)] bg-transparent hover:bg-white/50`;

export default function App() {
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>(loadLanguagePreference);
  const [systemLocale, setSystemLocale] = useState<Locale>(
    resolveSystemLocale,
  );
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceOverview | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] =
    useState<NodeDetail | null>(null);
  const [selectedSourceDetail, setSelectedSourceDetail] =
    useState<SourceDetail | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [patchEditor, setPatchEditor] = useState("");
  const [addChildTitle, setAddChildTitle] = useState("");
  const [addChildKind, setAddChildKind] = useState("");
  const [addChildBody, setAddChildBody] = useState("");
  const [updateNodeTitle, setUpdateNodeTitle] = useState("");
  const [updateNodeKind, setUpdateNodeKind] = useState("");
  const [updateNodeBody, setUpdateNodeBody] = useState("");
  const [moveNodeParent, setMoveNodeParent] = useState("");
  const [moveNodePosition, setMoveNodePosition] = useState("");
  const [consoleEntry, setConsoleEntry] = useState<ConsoleEntry | null>(null);

  const locale =
    languagePreference === "auto" ? systemLocale : languagePreference;
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, languagePreference);
  }, [languagePreference]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.title");
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
    }
  }, []);

  useEffect(() => {
    if (!selectedNodeDetail) {
      setUpdateNodeTitle("");
      setUpdateNodeKind("");
      setUpdateNodeBody("");
      setAddChildTitle("");
      setAddChildKind("");
      setAddChildBody("");
      setMoveNodeParent("");
      setMoveNodePosition("");
      return;
    }

    setUpdateNodeTitle(selectedNodeDetail.node.title ?? "");
    setUpdateNodeKind(selectedNodeDetail.node.kind ?? "");
    setUpdateNodeBody(selectedNodeDetail.node.body ?? "");
    setMoveNodeParent(selectedNodeDetail.parent?.id ?? "");
    setMoveNodePosition("");
  }, [selectedNodeDetail]);

  const consoleMessage = consoleEntry?.message ?? t("console.empty");
  const consoleTone = consoleEntry?.tone;
  const workspaceNodeCount = workspaceOverview
    ? countNodes(workspaceOverview.tree)
    : 0;
  const workspaceMeta = workspaceOverview
    ? t("workspace.meta", {
        name: workspaceOverview.workspace_name,
        path: workspaceOverview.root_dir,
      })
    : t("sidebar.workspaceEmpty");
  const detailMeta = selectedNodeDetail
    ? t("detail.nodeMeta", { id: selectedNodeDetail.node.id })
    : selectedSourceDetail
      ? t("detail.sourceMeta", { id: selectedSourceDetail.source.id })
      : t("detail.emptyMeta");
  const nodeEditMeta = selectedNodeDetail
    ? t("nodeEditing.selectedMeta", {
        title: selectedNodeDetail.node.title,
        id: selectedNodeDetail.node.id,
      })
    : t("nodeEditing.emptyMeta");

  function setConsoleMessage(message: string, tone: ConsoleTone) {
    setConsoleEntry({ message, tone });
  }

  function clearConsole() {
    setConsoleEntry(null);
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
      setWorkspaceInput(overview.root_dir);
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
        {
          silentError: true,
        },
      );
      if (reloaded) {
        return;
      }
    }

    setSelectedNodeId(null);
    setSelectedSourceId(null);
    setSelectedNodeDetail(null);
    setSelectedSourceDetail(null);
  }

  async function openWorkspaceCommand(path: string) {
    return invokeCommand<WorkspaceOverview>("open_workspace", {
      start_path: path,
    });
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
      const detail = await invokeCommand<NodeDetail>("get_node_detail", {
        start_path: path,
        node_id: nodeId,
      });
      setSelectedNodeId(nodeId);
      setSelectedSourceId(null);
      setSelectedNodeDetail(detail);
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
      const detail = await invokeCommand<SourceDetail>("get_source_detail", {
        start_path: path,
        source_id: sourceId,
      });
      setSelectedSourceId(sourceId);
      setSelectedNodeId(null);
      setSelectedSourceDetail(detail);
      setSelectedNodeDetail(null);
      return true;
    } catch (error) {
      if (!options.silentError) {
        setConsoleMessage(formatError(error), "error");
      }
      return false;
    }
  }

  async function loadWorkspace(mode: "open" | "init") {
    const nextWorkspacePath = workspaceInput.trim();
    if (!nextWorkspacePath) {
      setConsoleMessage(t("messages.provideWorkspacePath"), "error");
      return;
    }

    if (!ensureTauri()) {
      return;
    }

    try {
      const overview =
        mode === "init"
          ? await invokeCommand<WorkspaceOverview>("init_workspace", {
              root_path: nextWorkspacePath,
            })
          : await openWorkspaceCommand(nextWorkspacePath);

      await applyOverview(overview);
      setConsoleMessage(
        t(
          mode === "init"
            ? "messages.initializedWorkspace"
            : "messages.openedWorkspace",
          { path: overview.root_dir },
        ),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
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

  async function chooseWorkspaceFolder() {
    if (!ensureTauri()) {
      return;
    }

    try {
      const selected = await openPath({
        directory: true,
        title: t("workspace.chooseFolder"),
      });

      if (!selected) {
        return;
      }

      setWorkspaceInput(selected);
      setConsoleMessage(
        t("messages.chooseWorkspaceSuccess", { path: selected }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(
        hasTauriRuntime()
          ? formatError(error)
          : t("messages.dialogUnavailable"),
        "error",
      );
    }
  }

  async function chooseSourceFile() {
    if (!ensureTauri()) {
      return;
    }

    try {
      const selected = await openPath({
        directory: false,
        title: t("sourceImport.chooseFile"),
        filters: [
          {
            name: locale === "zh-CN" ? "Markdown 文档" : "Markdown",
            extensions: ["md", "markdown"],
          },
          {
            name: locale === "zh-CN" ? "文本文件" : "Text",
            extensions: ["txt", "text"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      setSourcePath(selected);
      setConsoleMessage(
        t("messages.chooseSourceSuccess", { path: selected }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(
        hasTauriRuntime()
          ? formatError(error)
          : t("messages.dialogUnavailable"),
        "error",
      );
    }
  }

  async function previewSourceImport() {
    if (!ensureWorkspace()) {
      return;
    }

    const nextSourcePath = sourcePath.trim();
    if (!nextSourcePath) {
      setConsoleMessage(t("messages.provideSourcePath"), "error");
      return;
    }

    try {
      const preview = await invokeCommand<SourceImportPreview>(
        "preview_source_import",
        {
          start_path: workspacePath,
          source_path: nextSourcePath,
        },
      );
      setPatchEditor(JSON.stringify(preview.patch, null, 2));
      setConsoleMessage(renderImportPreview(preview, t), "success");
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function runSourceImport() {
    if (!ensureWorkspace()) {
      return;
    }

    const nextSourcePath = sourcePath.trim();
    if (!nextSourcePath) {
      setConsoleMessage(t("messages.provideSourcePath"), "error");
      return;
    }

    try {
      const report = await invokeCommand<SourceImportReport>("import_source", {
        start_path: workspacePath,
        source_path: nextSourcePath,
      });
      await refreshWorkspace({
        preserveSelection: false,
        successMessage: false,
      });
      setConsoleMessage(renderImportReport(report, t), "success");
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
      setConsoleMessage(renderPatchReport(report, true, t), "success");
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
      const report = await invokeCommand<ApplyPatchReport>("apply_patch", {
        start_path: workspacePath,
        patch_json: patchJson,
      });
      await refreshWorkspace({
        preserveSelection: true,
        successMessage: false,
      });
      setConsoleMessage(renderPatchReport(report, false, t), "success");
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function saveSnapshot() {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const snapshot = await invokeCommand<SnapshotRecord>("save_snapshot", {
        start_path: workspacePath,
        label: snapshotLabel.trim() || null,
      });
      setSnapshotLabel("");
      await refreshWorkspace({
        preserveSelection: true,
        successMessage: false,
      });
      setConsoleMessage(
        t("messages.savedSnapshot", { id: snapshot.id }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function restoreSnapshot(snapshotId: string) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const overview = await invokeCommand<WorkspaceOverview>(
        "restore_snapshot",
        {
          start_path: workspacePath,
          snapshot_id: snapshotId,
        },
      );
      await applyOverview(overview, {
        preserveSelection: true,
      });
      setConsoleMessage(
        t("messages.restoredSnapshot", { id: snapshotId }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function loadPatchFromHistory(runId: string) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("get_patch_document", {
        start_path: workspacePath,
        run_id: runId,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setConsoleMessage(
        t("messages.loadedPatchRun", { id: runId }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function previewPatchFromHistory(runId: string) {
    if (!ensureWorkspace()) {
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("get_patch_document", {
        start_path: workspacePath,
        run_id: runId,
      });
      const report = await invokeCommand<ApplyPatchReport>("preview_patch", {
        start_path: workspacePath,
        patch_json: JSON.stringify(patch),
      });
      setConsoleMessage(
        [t("messages.historyPreview", { id: runId }), "", renderPatchReport(report, true, t)].join(
          "\n",
        ),
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
        kind: optionalText(addChildKind) ?? "topic",
        body: optionalText(addChildBody),
        position: null,
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
      setConsoleMessage(
        t("messages.draftedAddChild", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  async function draftUpdateNodePatch() {
    if (!ensureNodeSelected() || !ensureWorkspace()) {
      return;
    }

    const title = optionalText(updateNodeTitle);
    const kind = optionalText(updateNodeKind);
    const body = optionalTextareaValue(updateNodeBody);

    if (title === null && kind === null && body === undefined) {
      setConsoleMessage(t("messages.updateNeedsField"), "error");
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>(
        "draft_update_node_patch",
        {
          node_id: selectedNodeId,
          title,
          kind,
          body: body === undefined ? null : body,
        },
      );
      setPatchEditor(JSON.stringify(patch, null, 2));
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

    const parentId = moveNodeParent.trim();
    if (!parentId) {
      setConsoleMessage(t("messages.provideParentId"), "error");
      return;
    }

    try {
      const patch = await invokeCommand<PatchDocument>("draft_move_node_patch", {
        node_id: selectedNodeId,
        parent_id: parentId,
        position: parseOptionalInteger(moveNodePosition, t),
      });
      setPatchEditor(JSON.stringify(patch, null, 2));
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

    try {
      const patch = await invokeCommand<PatchDocument>(
        "draft_delete_node_patch",
        {
          node_id: selectedNodeId,
        },
      );
      setPatchEditor(JSON.stringify(patch, null, 2));
      setConsoleMessage(
        t("messages.draftedDelete", { nodeId: selectedNodeId! }),
        "success",
      );
    } catch (error) {
      setConsoleMessage(formatError(error), "error");
    }
  }

  function clearPatchEditor() {
    setPatchEditor("");
    setConsoleMessage(t("messages.patchEditorCleared"), "success");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      <header
        className={`${panelClass} relative overflow-hidden px-6 py-6 lg:px-8 lg:py-7`}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-64 bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.16),transparent_70%)] xl:block" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,460px)]">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent)]">
              {t("hero.eyebrow")}
            </p>
            <div className="max-w-4xl space-y-3">
              <h1
                className="text-[clamp(2.2rem,4vw,4rem)] leading-[0.95] tracking-[-0.03em]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {t("hero.title")}
              </h1>
              <p className={`${subtleTextClass} max-w-2xl text-base lg:text-lg`}>
                {t("hero.lede")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <MetricPill label={t("sidebar.tree")} value={String(workspaceNodeCount)} />
              <MetricPill
                label={t("sidebar.sources")}
                value={String(workspaceOverview?.sources.length ?? 0)}
              />
              <MetricPill
                label={t("sidebar.snapshots")}
                value={String(workspaceOverview?.snapshots.length ?? 0)}
              />
            </div>
          </div>

          <div
            className={`${cardClass} flex flex-col gap-4 border-white/40 bg-white/55`}
          >
            <LabeledField label={t("language.label")} className="max-w-[240px]">
              <select
                className={inputClass}
                value={languagePreference}
                onChange={(event) =>
                  setLanguagePreference(event.target.value as LanguagePreference)
                }
              >
                <option value="auto">{t("language.auto")}</option>
                <option value="zh-CN">{t("language.zhCN")}</option>
                <option value="en-US">{t("language.enUS")}</option>
              </select>
            </LabeledField>

            <LabeledField label={t("workspace.pathLabel")}>
              <input
                className={inputClass}
                value={workspaceInput}
                placeholder={t("workspace.pathPlaceholder")}
                onChange={(event) => setWorkspaceInput(event.target.value)}
              />
            </LabeledField>

            <div className="flex flex-wrap gap-3">
              <button className={secondaryButtonClass} onClick={chooseWorkspaceFolder}>
                {t("workspace.chooseFolder")}
              </button>
              <button className={primaryButtonClass} onClick={() => loadWorkspace("open")}>
                {t("workspace.open")}
              </button>
              <button className={secondaryButtonClass} onClick={() => loadWorkspace("init")}>
                {t("workspace.init")}
              </button>
              <button className={ghostButtonClass} onClick={() => refreshWorkspace()}>
                {t("workspace.refresh")}
              </button>
            </div>

            <p className={`${subtleTextClass} rounded-2xl bg-white/55 px-4 py-3`}>
              {workspaceMeta}
            </p>
          </div>
        </div>
      </header>

      <main className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
        <section className={`${panelClass} min-h-[70vh]`}>
          <SectionHeader
            title={t("sidebar.workspace")}
            subtitle={workspaceMeta}
          />

          <div className="flex flex-col gap-4">
            <div className={cardClass}>
              <CardHeader title={t("sidebar.tree")} />
              {workspaceOverview ? (
                <div className="scroll-panel max-h-[360px] overflow-auto rounded-2xl border border-[color:var(--line)] bg-white/60 p-3">
                  <TreeBranch
                    treeNode={workspaceOverview.tree}
                    depth={0}
                    selectedNodeId={selectedNodeId}
                    onSelect={(nodeId) => {
                      void fetchNodeDetail(nodeId);
                    }}
                  />
                </div>
              ) : (
                <EmptyBox>{t("sidebar.treeEmpty")}</EmptyBox>
              )}
            </div>

            <div className={cardClass}>
              <CardHeader title={t("sidebar.sources")} />
              {workspaceOverview?.sources.length ? (
                <div className="scroll-panel max-h-[220px] space-y-2 overflow-auto rounded-2xl border border-[color:var(--line)] bg-white/60 p-3">
                  {workspaceOverview.sources.map((source) => (
                    <SelectableItem
                      key={source.id}
                      active={selectedSourceId === source.id}
                      title={source.original_name}
                      meta={`${source.format} · ${source.id}`}
                      onClick={() => {
                        void fetchSourceDetail(source.id);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyBox>{t("sidebar.sourcesEmpty")}</EmptyBox>
              )}
            </div>

            <div className={cardClass}>
              <CardHeader title={t("sidebar.snapshots")} />
              <LabeledField label={t("sidebar.saveSnapshot")}>
                <input
                  className={inputClass}
                  value={snapshotLabel}
                  placeholder={t("sidebar.snapshotLabelPlaceholder")}
                  onChange={(event) => setSnapshotLabel(event.target.value)}
                />
              </LabeledField>
              <button className={secondaryButtonClass} onClick={saveSnapshot}>
                {t("sidebar.saveSnapshotButton")}
              </button>

              {workspaceOverview?.snapshots.length ? (
                <div className="scroll-panel mt-4 max-h-[220px] space-y-2 overflow-auto rounded-2xl border border-[color:var(--line)] bg-white/60 p-3">
                  {workspaceOverview.snapshots.map((snapshot) => (
                    <SnapshotItem
                      key={snapshot.id}
                      snapshot={snapshot}
                      fallbackLabel={t("history.noLabel")}
                      restoreLabel={t("history.restore")}
                      onRestore={() => {
                        void restoreSnapshot(snapshot.id);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyBox className="mt-4">{t("sidebar.snapshotsEmpty")}</EmptyBox>
              )}
            </div>

            <div className={cardClass}>
              <CardHeader title={t("sidebar.patchHistory")} />
              {workspaceOverview?.patch_history.length ? (
                <div className="scroll-panel max-h-[260px] space-y-3 overflow-auto rounded-2xl border border-[color:var(--line)] bg-white/60 p-3">
                  {workspaceOverview.patch_history.map((entry) => (
                    <HistoryItem
                      key={entry.id}
                      entry={entry}
                      fallbackSummary={t("history.noSummary")}
                      previewLabel={t("history.preview")}
                      loadLabel={t("history.load")}
                      onPreview={() => {
                        void previewPatchFromHistory(entry.id);
                      }}
                      onLoad={() => {
                        void loadPatchFromHistory(entry.id);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyBox>{t("sidebar.patchHistoryEmpty")}</EmptyBox>
              )}
            </div>
          </div>
        </section>

        <section className={`${panelClass} min-h-[70vh]`}>
          <SectionHeader title={t("detail.title")} subtitle={detailMeta} />

          <div className="scroll-panel min-h-[72vh] rounded-[24px] border border-[color:var(--line)] bg-white/60 p-4">
            {selectedNodeDetail ? (
              <NodeDetailPanel detail={selectedNodeDetail} t={t} />
            ) : selectedSourceDetail ? (
              <SourceDetailPanel detail={selectedSourceDetail} t={t} />
            ) : (
              <EmptyState
                title={t("detail.emptyMeta")}
                body={t("detail.emptyBody")}
              />
            )}
          </div>
        </section>

        <section className={`${panelClass} min-h-[70vh]`}>
          <SectionHeader
            title={t("actions.title")}
            subtitle={t("actions.subtitle")}
          />

          <div className="flex flex-col gap-4">
            <div className={cardClass}>
              <CardHeader title={t("nodeEditing.title")} />
              <p className={`${subtleTextClass} mb-4`}>{nodeEditMeta}</p>

              <EditorBlock title={t("nodeEditing.addChild")}>
                <LabeledField label={t("fields.title")}>
                  <input
                    className={inputClass}
                    value={addChildTitle}
                    placeholder={t("nodeEditing.addChildTitlePlaceholder")}
                    onChange={(event) => setAddChildTitle(event.target.value)}
                  />
                </LabeledField>
                <LabeledField label={t("fields.kind")}>
                  <input
                    className={inputClass}
                    value={addChildKind}
                    placeholder={t("nodeEditing.kindPlaceholder")}
                    onChange={(event) => setAddChildKind(event.target.value)}
                  />
                </LabeledField>
                <LabeledField label={t("fields.body")}>
                  <textarea
                    className={`${textareaClass} min-h-[6rem]`}
                    value={addChildBody}
                    spellCheck={false}
                    onChange={(event) => setAddChildBody(event.target.value)}
                  />
                </LabeledField>
                <button className={primaryButtonClass} onClick={draftAddChildPatch}>
                  {t("nodeEditing.draftAddChild")}
                </button>
              </EditorBlock>

              <EditorBlock title={t("nodeEditing.updateNode")}>
                <LabeledField label={t("fields.title")}>
                  <input
                    className={inputClass}
                    value={updateNodeTitle}
                    placeholder={t("nodeEditing.keepCurrentPlaceholder")}
                    onChange={(event) => setUpdateNodeTitle(event.target.value)}
                  />
                </LabeledField>
                <LabeledField label={t("fields.kind")}>
                  <input
                    className={inputClass}
                    value={updateNodeKind}
                    placeholder={t("nodeEditing.keepCurrentPlaceholder")}
                    onChange={(event) => setUpdateNodeKind(event.target.value)}
                  />
                </LabeledField>
                <LabeledField label={t("fields.body")}>
                  <textarea
                    className={`${textareaClass} min-h-[6rem]`}
                    value={updateNodeBody}
                    spellCheck={false}
                    onChange={(event) => setUpdateNodeBody(event.target.value)}
                  />
                </LabeledField>
                <button className={secondaryButtonClass} onClick={draftUpdateNodePatch}>
                  {t("nodeEditing.draftUpdate")}
                </button>
              </EditorBlock>

              <EditorBlock title={t("nodeEditing.moveNode")} className="mb-0">
                <LabeledField label={t("nodeEditing.newParentId")}>
                  <input
                    className={inputClass}
                    value={moveNodeParent}
                    placeholder={t("nodeEditing.moveParentPlaceholder")}
                    onChange={(event) => setMoveNodeParent(event.target.value)}
                  />
                </LabeledField>
                <LabeledField label={t("nodeEditing.position")}>
                  <input
                    className={inputClass}
                    value={moveNodePosition}
                    placeholder={t("nodeEditing.positionPlaceholder")}
                    onChange={(event) => setMoveNodePosition(event.target.value)}
                  />
                </LabeledField>
                <div className="flex flex-wrap gap-3">
                  <button className={secondaryButtonClass} onClick={draftMoveNodePatch}>
                    {t("nodeEditing.draftMove")}
                  </button>
                  <button className={dangerButtonClass} onClick={draftDeleteNodePatch}>
                    {t("nodeEditing.draftDelete")}
                  </button>
                </div>
              </EditorBlock>
            </div>

            <div className={cardClass}>
              <CardHeader title={t("sourceImport.title")} />
              <LabeledField label={t("sourceImport.pathLabel")}>
                <input
                  className={inputClass}
                  value={sourcePath}
                  placeholder={t("sourceImport.pathPlaceholder")}
                  onChange={(event) => setSourcePath(event.target.value)}
                />
              </LabeledField>
              <div className="flex flex-wrap gap-3">
                <button className={secondaryButtonClass} onClick={chooseSourceFile}>
                  {t("sourceImport.chooseFile")}
                </button>
                <button className={primaryButtonClass} onClick={previewSourceImport}>
                  {t("sourceImport.preview")}
                </button>
                <button className={secondaryButtonClass} onClick={runSourceImport}>
                  {t("sourceImport.run")}
                </button>
              </div>
            </div>

            <div className={cardClass}>
              <CardHeader
                title={t("patchEditor.title")}
                action={
                  <button className={ghostButtonClass} onClick={clearPatchEditor}>
                    {t("patchEditor.clear")}
                  </button>
                }
              />
              <LabeledField label={t("patchEditor.label")}>
                <textarea
                  className={patchTextareaClass}
                  value={patchEditor}
                  spellCheck={false}
                  onChange={(event) => setPatchEditor(event.target.value)}
                />
              </LabeledField>
              <div className="flex flex-wrap gap-3">
                <button className={primaryButtonClass} onClick={previewPatch}>
                  {t("patchEditor.preview")}
                </button>
                <button className={secondaryButtonClass} onClick={applyPatch}>
                  {t("patchEditor.apply")}
                </button>
              </div>
            </div>

            <div className={cardClass}>
              <CardHeader title={t("console.title")} />
              <div
                className={[
                  "scroll-panel min-h-[9rem] rounded-2xl border px-4 py-3 text-sm whitespace-pre-wrap",
                  consoleTone === "success"
                    ? "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)]"
                    : consoleTone === "error"
                      ? "border-[rgba(180,35,24,0.16)] bg-[rgba(180,35,24,0.08)]"
                      : "border-[color:var(--line)] bg-white/60",
                ].join(" ")}
              >
                {consoleMessage}
              </div>
              {consoleEntry ? (
                <div className="mt-3">
                  <button className={ghostButtonClass} onClick={clearConsole}>
                    {t("patchEditor.clear")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricPill(props: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-[color:var(--line)] bg-white/60 px-4 py-2">
      <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--muted)]">
        {props.label}
      </div>
      <div
        className="text-lg font-semibold leading-none"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {props.value}
      </div>
    </div>
  );
}

function SectionHeader(props: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="space-y-1">
        <h2
          className="text-2xl leading-none"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {props.title}
        </h2>
        <p className={subtleTextClass}>{props.subtitle}</p>
      </div>
    </div>
  );
}

function CardHeader(props: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3
        className="text-lg leading-none"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {props.title}
      </h3>
      {props.action}
    </div>
  );
}

function LabeledField(props: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-2 ${props.className ?? ""}`}>
      <span className="text-sm font-medium text-[color:var(--muted)]">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

function EditorBlock(props: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 ${props.className ?? ""}`}>
      <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--warm)]">
        {props.title}
      </h4>
      <div className="space-y-4">{props.children}</div>
    </div>
  );
}

function EmptyBox(props: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-[color:var(--line)] bg-white/40 px-4 py-5 text-sm text-[color:var(--muted)] ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div
        className="text-2xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {props.title}
      </div>
      <p className={`${subtleTextClass} max-w-md`}>{props.body}</p>
    </div>
  );
}

function TreeBranch(props: {
  treeNode: TreeNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const active = props.selectedNodeId === props.treeNode.node.id;
  const paddingLeft = `${props.depth * 0.85}rem`;

  return (
    <div className="space-y-2">
      <button
        className={[
          "block w-full rounded-2xl border px-3 py-2 text-left",
          active
            ? "border-[color:var(--accent)] bg-[linear-gradient(135deg,rgba(15,118,110,0.12),rgba(255,255,255,0.95))] shadow-[0_12px_24px_rgba(15,118,110,0.08)]"
            : "border-[color:var(--line)] bg-white/70 hover:border-[rgba(67,54,33,0.22)] hover:bg-white/90",
        ].join(" ")}
        style={{ paddingLeft: `calc(${paddingLeft} + 0.75rem)` }}
        onClick={() => props.onSelect(props.treeNode.node.id)}
      >
        <div className="font-medium text-[color:var(--text)]">
          {props.treeNode.node.title}
        </div>
        <div className="text-xs text-[color:var(--muted)]">
          {props.treeNode.node.kind} · {props.treeNode.node.id}
        </div>
      </button>

      {props.treeNode.children.length ? (
        <div className="space-y-2">
          {props.treeNode.children.map((child) => (
            <TreeBranch
              key={child.node.id}
              treeNode={child}
              depth={props.depth + 1}
              selectedNodeId={props.selectedNodeId}
              onSelect={props.onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SelectableItem(props: {
  active: boolean;
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "block w-full rounded-2xl border px-3 py-2 text-left",
        props.active
          ? "border-[color:var(--accent)] bg-[linear-gradient(135deg,rgba(15,118,110,0.12),rgba(255,255,255,0.96))]"
          : "border-[color:var(--line)] bg-white/70 hover:border-[rgba(67,54,33,0.22)] hover:bg-white/90",
      ].join(" ")}
      onClick={props.onClick}
    >
      <div className="font-medium text-[color:var(--text)]">{props.title}</div>
      <div className="text-xs text-[color:var(--muted)]">{props.meta}</div>
    </button>
  );
}

function SnapshotItem(props: {
  snapshot: SnapshotRecord;
  fallbackLabel: string;
  restoreLabel: string;
  onRestore: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--line)] bg-white/75 px-3 py-3">
      <div className="min-w-0">
        <div className="truncate font-medium text-[color:var(--text)]">
          {props.snapshot.label || props.fallbackLabel}
        </div>
        <div className="truncate text-xs text-[color:var(--muted)]">
          {props.snapshot.id}
        </div>
      </div>
      <button className={secondaryButtonClass} onClick={props.onRestore}>
        {props.restoreLabel}
      </button>
    </div>
  );
}

function HistoryItem(props: {
  entry: PatchRunRecord;
  fallbackSummary: string;
  previewLabel: string;
  loadLabel: string;
  onPreview: () => void;
  onLoad: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white/75 p-3">
      <div className="font-medium text-[color:var(--text)]">
        {props.entry.summary || props.fallbackSummary}
      </div>
      <div className="text-xs text-[color:var(--muted)]">
        {props.entry.origin} · {props.entry.id}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <button className={secondaryButtonClass} onClick={props.onPreview}>
          {props.previewLabel}
        </button>
        <button className={ghostButtonClass} onClick={props.onLoad}>
          {props.loadLabel}
        </button>
      </div>
    </div>
  );
}

function NodeDetailPanel(props: {
  detail: NodeDetail;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-5">
      <DetailSection title={props.t("detail.nodeSection")}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-[color:var(--line)] bg-white/70 p-4">
            <div className="text-xl font-semibold text-[color:var(--text)]">
              {props.detail.node.title}
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
              {props.detail.node.body || props.t("detail.noBody")}
            </div>
          </div>
          <div className="rounded-full border border-[color:var(--line)] bg-white/70 px-4 py-2 text-sm font-medium text-[color:var(--muted)]">
            {props.detail.node.kind}
          </div>
        </div>
      </DetailSection>

      <DetailSection title={props.t("detail.relationsSection")}>
        <div className="grid gap-3">
          <DetailLine
            value={props.t("detail.parent", {
              value: props.detail.parent
                ? `${props.detail.parent.title} [${props.detail.parent.id}]`
                : props.t("detail.none"),
            })}
          />
          <DetailLine
            value={props.t("detail.children", {
              value: props.detail.children.length
                ? props.detail.children
                    .map((child) => `${child.title} [${child.id}]`)
                    .join(", ")
                : props.t("detail.none"),
            })}
          />
        </div>
      </DetailSection>

      <DetailSection title={props.t("detail.sourcesSection")}>
        {props.detail.sources.length ? (
          <div className="space-y-3">
            {props.detail.sources.map((sourceDetail) => (
              <div
                key={sourceDetail.source.id}
                className="rounded-2xl border border-[color:var(--line)] bg-white/75 p-4"
              >
                <div className="font-medium text-[color:var(--text)]">
                  {sourceDetail.source.original_name}
                </div>
                <div className="mb-3 text-xs text-[color:var(--muted)]">
                  {sourceDetail.source.id}
                </div>
                {sourceDetail.chunks.length ? (
                  <div className="space-y-3">
                    {sourceDetail.chunks.map((chunk) => (
                      <div
                        key={chunk.id}
                        className="rounded-2xl border border-[color:var(--line-soft)] bg-white/75 p-3"
                      >
                        <div className="text-xs uppercase tracking-[0.14em] text-[color:var(--warm)]">
                          {props.t("detail.chunkMeta", {
                            ordinal: chunk.ordinal + 1,
                            start: chunk.start_line,
                            end: chunk.end_line,
                          })}
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                          {chunk.text}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[color:var(--muted)]">
                    {props.t("detail.sourceLevelOnly")}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyBox>{props.t("detail.noSourceLinks")}</EmptyBox>
        )}
      </DetailSection>
    </div>
  );
}

function SourceDetailPanel(props: {
  detail: SourceDetail;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-5">
      <DetailSection title={props.t("detail.sourceSection")}>
        <div className="grid gap-3">
          <div className="rounded-2xl border border-[color:var(--line)] bg-white/75 p-4">
            <div className="text-xl font-semibold text-[color:var(--text)]">
              {props.detail.source.original_name}
            </div>
            <div className="mt-2 text-sm text-[color:var(--muted)]">
              {props.detail.source.format}
            </div>
            <div className="mt-4 break-all text-sm leading-6 text-[color:var(--text)]">
              {props.detail.source.original_path}
            </div>
          </div>
        </div>
      </DetailSection>

      <DetailSection title={props.t("detail.chunksSection")}>
        {props.detail.chunks.length ? (
          <div className="space-y-3">
            {props.detail.chunks.map((chunkDetail) => (
              <div
                key={chunkDetail.chunk.id}
                className="rounded-2xl border border-[color:var(--line)] bg-white/75 p-4"
              >
                <div className="font-medium text-[color:var(--text)]">
                  {chunkDetail.chunk.label || props.t("detail.noLabel")}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[color:var(--warm)]">
                  {props.t("detail.chunkMeta", {
                    ordinal: chunkDetail.chunk.ordinal + 1,
                    start: chunkDetail.chunk.start_line,
                    end: chunkDetail.chunk.end_line,
                  })}
                </div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                  {chunkDetail.chunk.text}
                </div>
                <div className="mt-4 text-sm text-[color:var(--muted)]">
                  {props.t("detail.nodes", {
                    value: chunkDetail.linked_nodes.length
                      ? chunkDetail.linked_nodes
                          .map((node) => `${node.title} [${node.id}]`)
                          .join(", ")
                      : props.t("detail.none"),
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyBox>{props.t("detail.noChunks")}</EmptyBox>
        )}
      </DetailSection>
    </div>
  );
}

function DetailSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3
        className="text-lg leading-none"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function DetailLine(props: { value: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm leading-6 text-[color:var(--text)]">
      {props.value}
    </div>
  );
}

function renderImportPreview(
  preview: SourceImportPreview,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  return [
    t("reports.importPreviewTitle", { name: preview.report.original_name }),
    t("reports.plannedSourceId", { id: preview.report.source_id }),
    t("reports.plannedRootNode", {
      title: preview.report.root_title,
      id: preview.report.root_node_id,
    }),
    t("reports.plannedNodes", { count: preview.report.node_count }),
    t("reports.plannedChunks", { count: preview.report.chunk_count }),
    "",
    t("reports.summary", {
      value: preview.patch.summary || t("history.noSummary"),
    }),
    ...preview.patch.ops.map((op) => `- ${op.type || "op"}`),
  ].join("\n");
}

function renderImportReport(
  report: SourceImportReport,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  return [
    t("reports.importedTitle", {
      name: report.original_name,
      id: report.source_id,
    }),
    t("reports.storedFile", { value: report.stored_name }),
    t("reports.rootNode", {
      title: report.root_title,
      id: report.root_node_id,
    }),
    t("reports.generatedNodes", { count: report.node_count }),
    t("reports.generatedChunks", { count: report.chunk_count }),
  ].join("\n");
}

function renderPatchReport(
  report: ApplyPatchReport,
  dryRun: boolean,
  t: (key: string, vars?: Record<string, string | number>) => string,
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

function countNodes(tree: TreeNode): number {
  return 1 + tree.children.reduce((count, child) => count + countNodes(child), 0);
}

function findNodeById(tree: TreeNode, nodeId: string): TreeNode | null {
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

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalTextareaValue(value: string): string | null | undefined {
  if (value === "") {
    return undefined;
  }
  return value;
}

function parseOptionalInteger(
  value: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): number | null {
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
}
