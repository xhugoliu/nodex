const invoke = window.__TAURI__?.core?.invoke;
const dialogOpen = window.__TAURI__?.dialog?.open;
const LANGUAGE_STORAGE_KEY = "nodex.desktop.language";

const translations = {
  "en-US": {
    app: {
      title: "Nodex",
    },
    hero: {
      eyebrow: "Nodex Desktop",
      title: "Patch-first mind map shell",
      lede:
        "A thin desktop layer over the local Nodex core. Open a workspace, inspect structure, preview source imports, and apply patches.",
    },
    language: {
      label: "Language",
      auto: "Follow system",
      zhCN: "简体中文",
      enUS: "English",
    },
    workspace: {
      pathLabel: "Workspace path",
      pathPlaceholder: "/path/to/project or workspace",
      chooseFolder: "Choose Folder",
      open: "Open Workspace",
      init: "Init Workspace",
      refresh: "Refresh",
      meta: "{name} — {path}",
    },
    sidebar: {
      workspace: "Workspace",
      workspaceEmpty: "No workspace opened yet.",
      tree: "Tree",
      treeEmpty: "Open a workspace to inspect its tree.",
      sources: "Sources",
      sourcesEmpty: "No source loaded.",
      snapshots: "Snapshots",
      saveSnapshot: "Save snapshot",
      snapshotLabelPlaceholder: "optional label",
      saveSnapshotButton: "Save Snapshot",
      snapshotsEmpty: "No snapshots loaded.",
      patchHistory: "Patch History",
      patchHistoryEmpty: "No patch history loaded.",
    },
    detail: {
      title: "Inspector",
      emptyMeta: "Select a node or source.",
      emptyBody: "Details will appear here.",
      nodeMeta: "Node {id}",
      sourceMeta: "Source {id}",
      nodeSection: "Node",
      relationsSection: "Relations",
      sourcesSection: "Sources",
      sourceSection: "Source",
      chunksSection: "Chunks",
      parent: "Parent: {value}",
      children: "Children: {value}",
      noBody: "(no body)",
      noSourceLinks: "No source links.",
      noChunks: "No chunks.",
      noLabel: "(no label)",
      sourceLevelOnly: "Source-level link only",
      chunkMeta: "Chunk {ordinal} · {start}-{end}",
      nodes: "Nodes: {value}",
      none: "(none)",
    },
    actions: {
      title: "Actions",
      subtitle: "Preview first, then apply.",
    },
    fields: {
      title: "Title",
      kind: "Kind",
      body: "Body",
    },
    nodeEditing: {
      title: "Node Editing",
      emptyMeta: "Select a node to draft edit patches.",
      selectedMeta: "Selected node: {title} [{id}]",
      addChild: "Add Child",
      addChildTitlePlaceholder: "New child title",
      kindPlaceholder: "topic",
      draftAddChild: "Draft Add Child",
      updateNode: "Update Selected Node",
      keepCurrentPlaceholder: "leave blank to keep current",
      moveNode: "Move Selected Node",
      newParentId: "New parent id",
      moveParentPlaceholder: "root or another node id",
      position: "Position",
      positionPlaceholder: "optional index",
      draftMove: "Draft Move",
      draftDelete: "Draft Delete",
      draftUpdate: "Draft Update",
    },
    sourceImport: {
      title: "Source Import",
      pathLabel: "Source file path",
      pathPlaceholder: "/path/to/file.md",
      chooseFile: "Choose File",
      preview: "Preview Import",
      run: "Run Import",
    },
    patchEditor: {
      title: "Patch Editor",
      clear: "Clear",
      label: "Patch JSON",
      preview: "Preview Patch",
      apply: "Apply Patch",
    },
    console: {
      title: "Console",
      empty: "Nothing to show yet.",
    },
    history: {
      preview: "Preview",
      load: "Load Patch",
      restore: "Restore",
      noSummary: "(no summary)",
      noLabel: "(no label)",
    },
    messages: {
      tauriUnavailable: "Tauri runtime is not available in this context.",
      dialogUnavailable: "The dialog API is not available in this context.",
      patchEditorCleared: "Patch editor cleared.",
      chooseWorkspaceSuccess: "Selected workspace folder: {path}",
      chooseSourceSuccess: "Selected source file: {path}",
      provideWorkspacePath: "Please provide a workspace path first.",
      provideParentId: "Move draft requires a new parent id.",
      provideSourcePath: "Please provide a source file path.",
      initializedWorkspace: "Initialized and opened workspace at {path}.",
      openedWorkspace: "Opened workspace at {path}.",
      refreshedWorkspace: "Refreshed {name}.",
      patchEditorEmpty: "Patch editor is empty.",
      savedSnapshot: "Saved snapshot {id}.",
      restoredSnapshot: "Restored snapshot {id}.",
      loadedPatchRun: "Loaded patch run {id} into the editor.",
      historyPreview: "History preview: {id}",
      addChildRequiresTitle: "Add child requires a title.",
      updateNeedsField: "Update draft needs at least one changed field.",
      draftedAddChild: "Drafted add-child patch under {nodeId}.",
      draftedUpdate: "Drafted update patch for {nodeId}.",
      draftedMove: "Drafted move patch for {nodeId}.",
      draftedDelete: "Drafted delete patch for {nodeId}.",
      selectNodeFirst: "Select a node in the tree first.",
      selectWorkspaceFirst: "Open or initialize a workspace first.",
      invalidInteger: "Invalid integer value: {value}",
    },
    reports: {
      importPreviewTitle: "Dry preview for {name}",
      plannedSourceId: "planned source id: {id}",
      plannedRootNode: "planned root node: {title} [{id}]",
      plannedNodes: "planned nodes: {count}",
      plannedChunks: "planned chunks: {count}",
      summary: "summary: {value}",
      importedTitle: "Imported {name} as {id}",
      storedFile: "stored file: {value}",
      rootNode: "root node: {title} [{id}]",
      generatedNodes: "generated nodes: {count}",
      generatedChunks: "generated chunks: {count}",
      patchPreviewSucceeded: "Patch preview succeeded.",
      patchApplied: "Patch applied.",
      runId: "run id: {id}",
    },
  },
  "zh-CN": {
    app: {
      title: "Nodex",
    },
    hero: {
      eyebrow: "Nodex 桌面壳",
      title: "Patch-first 脑图工作台壳层",
      lede:
        "这是包在本地 Nodex 内核外的一层轻桌面壳。你可以打开工作区、查看结构、预览资料导入，并对 patch 进行预览和应用。",
    },
    language: {
      label: "语言",
      auto: "跟随系统",
      zhCN: "简体中文",
      enUS: "English",
    },
    workspace: {
      pathLabel: "工作区路径",
      pathPlaceholder: "/path/to/project or workspace",
      chooseFolder: "选择文件夹",
      open: "打开工作区",
      init: "初始化工作区",
      refresh: "刷新",
      meta: "{name} — {path}",
    },
    sidebar: {
      workspace: "工作区",
      workspaceEmpty: "还没有打开工作区。",
      tree: "树视图",
      treeEmpty: "先打开工作区，再查看树结构。",
      sources: "来源",
      sourcesEmpty: "还没有来源。",
      snapshots: "快照",
      saveSnapshot: "保存快照",
      snapshotLabelPlaceholder: "可选标签",
      saveSnapshotButton: "保存快照",
      snapshotsEmpty: "还没有快照。",
      patchHistory: "Patch 历史",
      patchHistoryEmpty: "还没有 patch 历史。",
    },
    detail: {
      title: "详情面板",
      emptyMeta: "请选择一个节点或来源。",
      emptyBody: "详情会显示在这里。",
      nodeMeta: "节点 {id}",
      sourceMeta: "来源 {id}",
      nodeSection: "节点",
      relationsSection: "关系",
      sourcesSection: "来源",
      sourceSection: "来源",
      chunksSection: "切片",
      parent: "父节点：{value}",
      children: "子节点：{value}",
      noBody: "（无正文）",
      noSourceLinks: "没有来源关联。",
      noChunks: "没有切片。",
      noLabel: "（无标签）",
      sourceLevelOnly: "只有 source-level link",
      chunkMeta: "切片 {ordinal} · {start}-{end}",
      nodes: "关联节点：{value}",
      none: "（无）",
    },
    actions: {
      title: "操作",
      subtitle: "先预览，再应用。",
    },
    fields: {
      title: "标题",
      kind: "类型",
      body: "正文",
    },
    nodeEditing: {
      title: "节点编辑",
      emptyMeta: "选择一个节点后，可以起草编辑 patch。",
      selectedMeta: "当前节点：{title} [{id}]",
      addChild: "新增子节点",
      addChildTitlePlaceholder: "新子节点标题",
      kindPlaceholder: "topic",
      draftAddChild: "起草新增子节点",
      updateNode: "更新当前节点",
      keepCurrentPlaceholder: "留空则保持当前值",
      moveNode: "移动当前节点",
      newParentId: "新父节点 id",
      moveParentPlaceholder: "root 或其他节点 id",
      position: "位置",
      positionPlaceholder: "可选索引",
      draftMove: "起草移动",
      draftDelete: "起草删除",
      draftUpdate: "起草更新",
    },
    sourceImport: {
      title: "资料导入",
      pathLabel: "来源文件路径",
      pathPlaceholder: "/path/to/file.md",
      chooseFile: "选择文件",
      preview: "预览导入",
      run: "执行导入",
    },
    patchEditor: {
      title: "Patch 编辑器",
      clear: "清空",
      label: "Patch JSON",
      preview: "预览 Patch",
      apply: "应用 Patch",
    },
    console: {
      title: "控制台",
      empty: "这里还没有内容。",
    },
    history: {
      preview: "预览",
      load: "载入 Patch",
      restore: "恢复",
      noSummary: "（无摘要）",
      noLabel: "（无标签）",
    },
    messages: {
      tauriUnavailable: "当前环境里没有可用的 Tauri 运行时。",
      dialogUnavailable: "当前环境里没有可用的文件对话框能力。",
      patchEditorCleared: "Patch 编辑器已清空。",
      chooseWorkspaceSuccess: "已选择工作区文件夹：{path}",
      chooseSourceSuccess: "已选择来源文件：{path}",
      provideWorkspacePath: "请先输入工作区路径。",
      provideParentId: "移动草案需要填写新的父节点 id。",
      provideSourcePath: "请先输入来源文件路径。",
      initializedWorkspace: "已初始化并打开工作区：{path}",
      openedWorkspace: "已打开工作区：{path}",
      refreshedWorkspace: "已刷新 {name}。",
      patchEditorEmpty: "Patch 编辑器目前为空。",
      savedSnapshot: "已保存快照 {id}。",
      restoredSnapshot: "已恢复快照 {id}。",
      loadedPatchRun: "已将 patch run {id} 载入编辑器。",
      historyPreview: "历史 patch 预览：{id}",
      addChildRequiresTitle: "新增子节点必须填写标题。",
      updateNeedsField: "更新草案至少要包含一个变更字段。",
      draftedAddChild: "已为 {nodeId} 起草新增子节点 patch。",
      draftedUpdate: "已为 {nodeId} 起草更新 patch。",
      draftedMove: "已为 {nodeId} 起草移动 patch。",
      draftedDelete: "已为 {nodeId} 起草删除 patch。",
      selectNodeFirst: "请先在树里选择一个节点。",
      selectWorkspaceFirst: "请先打开或初始化一个工作区。",
      invalidInteger: "无效的整数值：{value}",
    },
    reports: {
      importPreviewTitle: "{name} 的 dry preview",
      plannedSourceId: "计划 source id：{id}",
      plannedRootNode: "计划根节点：{title} [{id}]",
      plannedNodes: "计划节点数：{count}",
      plannedChunks: "计划切片数：{count}",
      summary: "摘要：{value}",
      importedTitle: "已导入 {name} 为 {id}",
      storedFile: "存储文件：{value}",
      rootNode: "根节点：{title} [{id}]",
      generatedNodes: "生成节点数：{count}",
      generatedChunks: "生成切片数：{count}",
      patchPreviewSucceeded: "Patch 预览成功。",
      patchApplied: "Patch 已应用。",
      runId: "运行记录：{id}",
    },
  },
};

const state = {
  workspacePath: "",
  selectedNodeId: null,
  selectedSourceId: null,
  selectedNodeButton: null,
  selectedSourceButton: null,
  selectedNodeDetail: null,
  selectedSourceDetail: null,
  workspaceOverview: null,
  languagePreference: loadLanguagePreference(),
  currentLocale: "en-US",
  consoleMode: "default",
};

const els = {
  languageSelect: document.querySelector("#language-select"),
  workspacePath: document.querySelector("#workspace-path"),
  pickWorkspace: document.querySelector("#pick-workspace"),
  openWorkspace: document.querySelector("#open-workspace"),
  initWorkspace: document.querySelector("#init-workspace"),
  refreshWorkspace: document.querySelector("#refresh-workspace"),
  workspaceMeta: document.querySelector("#workspace-meta"),
  detailMeta: document.querySelector("#detail-meta"),
  treeView: document.querySelector("#tree-view"),
  sourceList: document.querySelector("#source-list"),
  snapshotList: document.querySelector("#snapshot-list"),
  historyList: document.querySelector("#history-list"),
  detailView: document.querySelector("#detail-view"),
  nodeEditMeta: document.querySelector("#node-edit-meta"),
  addChildTitle: document.querySelector("#add-child-title"),
  addChildKind: document.querySelector("#add-child-kind"),
  addChildBody: document.querySelector("#add-child-body"),
  draftAddChild: document.querySelector("#draft-add-child"),
  updateNodeTitle: document.querySelector("#update-node-title"),
  updateNodeKind: document.querySelector("#update-node-kind"),
  updateNodeBody: document.querySelector("#update-node-body"),
  draftUpdateNode: document.querySelector("#draft-update-node"),
  moveNodeParent: document.querySelector("#move-node-parent"),
  moveNodePosition: document.querySelector("#move-node-position"),
  draftMoveNode: document.querySelector("#draft-move-node"),
  draftDeleteNode: document.querySelector("#draft-delete-node"),
  snapshotLabel: document.querySelector("#snapshot-label"),
  saveSnapshot: document.querySelector("#save-snapshot"),
  sourcePath: document.querySelector("#source-path"),
  pickSource: document.querySelector("#pick-source"),
  previewImport: document.querySelector("#preview-import"),
  runImport: document.querySelector("#run-import"),
  patchEditor: document.querySelector("#patch-editor"),
  previewPatch: document.querySelector("#preview-patch"),
  applyPatch: document.querySelector("#apply-patch"),
  clearPatch: document.querySelector("#clear-patch"),
  consoleOutput: document.querySelector("#console-output"),
};

applyLanguage();
bindEvents();

if (!invoke) {
  setConsole(t("messages.tauriUnavailable"), "error");
}

function bindEvents() {
  els.languageSelect.addEventListener("change", handleLanguageChange);
  els.openWorkspace.addEventListener("click", () => loadWorkspace("open"));
  els.initWorkspace.addEventListener("click", () => loadWorkspace("init"));
  els.refreshWorkspace.addEventListener("click", () => refreshWorkspace());
  els.pickWorkspace.addEventListener("click", () => chooseWorkspaceFolder());
  els.saveSnapshot.addEventListener("click", () => saveSnapshot());
  els.pickSource.addEventListener("click", () => chooseSourceFile());
  els.previewImport.addEventListener("click", () => previewSourceImport());
  els.runImport.addEventListener("click", () => runSourceImport());
  els.draftAddChild.addEventListener("click", () => draftAddChildPatch());
  els.draftUpdateNode.addEventListener("click", () => draftUpdateNodePatch());
  els.draftMoveNode.addEventListener("click", () => draftMoveNodePatch());
  els.draftDeleteNode.addEventListener("click", () => draftDeleteNodePatch());
  els.previewPatch.addEventListener("click", () => previewPatch());
  els.applyPatch.addEventListener("click", () => applyPatch());
  els.clearPatch.addEventListener("click", () => {
    els.patchEditor.value = "";
    setConsole(t("messages.patchEditorCleared"));
  });
  window.addEventListener("languagechange", () => {
    if (state.languagePreference === "auto") {
      applyLanguage();
    }
  });
}

function loadLanguagePreference() {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "zh-CN" || stored === "en-US" || stored === "auto") {
    return stored;
  }
  return "auto";
}

function resolveSystemLocale() {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const locale of candidates) {
    if (!locale) continue;
    const normalized = locale.toLowerCase();
    if (normalized.startsWith("zh")) {
      return "zh-CN";
    }
    if (normalized.startsWith("en")) {
      return "en-US";
    }
  }
  return "en-US";
}

function applyLanguage() {
  state.currentLocale =
    state.languagePreference === "auto" ? resolveSystemLocale() : state.languagePreference;
  document.documentElement.lang = state.currentLocale;
  document.title = t("app.title");
  els.languageSelect.value = state.languagePreference;
  applyStaticTranslations();
  rerenderDynamicViews();
}

function handleLanguageChange(event) {
  state.languagePreference = event.target.value;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, state.languagePreference);
  applyLanguage();
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
}

function rerenderDynamicViews() {
  if (state.workspaceOverview) {
    applyWorkspaceOverview(state.workspaceOverview, false);
  } else {
    clearNodeEditForm(t("nodeEditing.emptyMeta"));
  }

  if (state.selectedNodeDetail) {
    renderNodeDetail(state.selectedNodeDetail);
    syncNodeEditForm(state.selectedNodeDetail);
  } else if (state.selectedSourceDetail) {
    renderSourceDetail(state.selectedSourceDetail);
  } else {
    els.detailMeta.textContent = t("detail.emptyMeta");
    els.detailView.className = "detail-view empty";
    els.detailView.textContent = t("detail.emptyBody");
  }

  if (state.consoleMode === "default") {
    setDefaultConsole();
  }
}

async function chooseWorkspaceFolder() {
  if (!dialogOpen) {
    setConsole(t("messages.dialogUnavailable"), "error");
    return;
  }
  try {
    const selected = await dialogOpen({
      directory: true,
      multiple: false,
      title: t("workspace.chooseFolder"),
    });
    if (typeof selected === "string") {
      els.workspacePath.value = selected;
      setConsole(t("messages.chooseWorkspaceSuccess", { path: selected }));
    }
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function chooseSourceFile() {
  if (!dialogOpen) {
    setConsole(t("messages.dialogUnavailable"), "error");
    return;
  }
  try {
    const selected = await dialogOpen({
      directory: false,
      multiple: false,
      title: t("sourceImport.chooseFile"),
      filters: [
        {
          name: state.currentLocale === "zh-CN" ? "Markdown 文档" : "Markdown",
          extensions: ["md", "markdown"],
        },
        {
          name: state.currentLocale === "zh-CN" ? "文本文件" : "Text",
          extensions: ["txt", "text"],
        },
      ],
    });
    if (typeof selected === "string") {
      els.sourcePath.value = selected;
      setConsole(t("messages.chooseSourceSuccess", { path: selected }));
    }
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function loadWorkspace(mode) {
  const workspacePath = els.workspacePath.value.trim();
  if (!workspacePath) {
    setConsole(t("messages.provideWorkspacePath"), "error");
    return;
  }

  try {
    const overview =
      mode === "init"
        ? await invoke("init_workspace", { root_path: workspacePath })
        : await invoke("open_workspace", { start_path: workspacePath });
    state.workspacePath = overview.root_dir;
    els.workspacePath.value = overview.root_dir;
    applyWorkspaceOverview(overview);
    setConsole(
      t(mode === "init" ? "messages.initializedWorkspace" : "messages.openedWorkspace", {
        path: overview.root_dir,
      }),
      "success",
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function refreshWorkspace() {
  if (!ensureWorkspace()) return;
  try {
    const overview = await invoke("open_workspace", { start_path: state.workspacePath });
    applyWorkspaceOverview(overview);
    setConsole(
      t("messages.refreshedWorkspace", { name: overview.workspace_name }),
      "success",
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function previewSourceImport() {
  if (!ensureWorkspace()) return;
  const sourcePath = els.sourcePath.value.trim();
  if (!sourcePath) {
    setConsole(t("messages.provideSourcePath"), "error");
    return;
  }

  try {
    const preview = await invoke("preview_source_import", {
      start_path: state.workspacePath,
      source_path: sourcePath,
    });
    els.patchEditor.value = JSON.stringify(preview.patch, null, 2);
    setConsole(renderImportPreview(preview), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function runSourceImport() {
  if (!ensureWorkspace()) return;
  const sourcePath = els.sourcePath.value.trim();
  if (!sourcePath) {
    setConsole(t("messages.provideSourcePath"), "error");
    return;
  }

  try {
    const report = await invoke("import_source", {
      start_path: state.workspacePath,
      source_path: sourcePath,
    });
    await refreshWorkspace();
    setConsole(renderImportReport(report), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function previewPatch() {
  if (!ensureWorkspace()) return;
  const patchJson = els.patchEditor.value.trim();
  if (!patchJson) {
    setConsole(t("messages.patchEditorEmpty"), "error");
    return;
  }

  try {
    const report = await invoke("preview_patch", {
      start_path: state.workspacePath,
      patch_json: patchJson,
    });
    setConsole(renderPatchReport(report, true), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function applyPatch() {
  if (!ensureWorkspace()) return;
  const patchJson = els.patchEditor.value.trim();
  if (!patchJson) {
    setConsole(t("messages.patchEditorEmpty"), "error");
    return;
  }

  try {
    const report = await invoke("apply_patch", {
      start_path: state.workspacePath,
      patch_json: patchJson,
    });
    await refreshWorkspace();
    setConsole(renderPatchReport(report, false), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function saveSnapshot() {
  if (!ensureWorkspace()) return;
  try {
    const snapshot = await invoke("save_snapshot", {
      start_path: state.workspacePath,
      label: els.snapshotLabel.value.trim() || null,
    });
    els.snapshotLabel.value = "";
    await refreshWorkspace();
    setConsole(t("messages.savedSnapshot", { id: snapshot.id }), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function restoreSnapshot(snapshotId) {
  if (!ensureWorkspace()) return;
  try {
    const overview = await invoke("restore_snapshot", {
      start_path: state.workspacePath,
      snapshot_id: snapshotId,
    });
    applyWorkspaceOverview(overview);
    setConsole(t("messages.restoredSnapshot", { id: snapshotId }), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function showNodeDetail(nodeId, button) {
  if (!ensureWorkspace()) return;
  try {
    const detail = await invoke("get_node_detail", {
      start_path: state.workspacePath,
      node_id: nodeId,
    });
    state.selectedNodeId = nodeId;
    state.selectedSourceId = null;
    state.selectedNodeDetail = detail;
    state.selectedSourceDetail = null;
    markActive(button, "node");
    renderNodeDetail(detail);
    syncNodeEditForm(detail);
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function showSourceDetail(sourceId, button) {
  if (!ensureWorkspace()) return;
  try {
    const detail = await invoke("get_source_detail", {
      start_path: state.workspacePath,
      source_id: sourceId,
    });
    state.selectedSourceId = sourceId;
    state.selectedNodeId = null;
    state.selectedNodeDetail = null;
    state.selectedSourceDetail = detail;
    markActive(button, "source");
    renderSourceDetail(detail);
    clearNodeEditForm(t("nodeEditing.emptyMeta"));
  } catch (error) {
    setConsole(String(error), "error");
  }
}

function applyWorkspaceOverview(overview, resetSelection = true) {
  state.workspaceOverview = overview;
  state.workspacePath = overview.root_dir;
  els.workspaceMeta.textContent = t("workspace.meta", {
    name: overview.workspace_name,
    path: overview.root_dir,
  });
  renderTree(overview.tree);
  renderSources(overview.sources);
  renderSnapshots(overview.snapshots);
  renderHistory(overview.patch_history);

  if (resetSelection) {
    if (state.selectedNodeId && !findNodeById(overview.tree, state.selectedNodeId)) {
      state.selectedNodeId = null;
      state.selectedNodeDetail = null;
      clearNodeEditForm(t("nodeEditing.emptyMeta"));
    }
    if (
      state.selectedSourceId &&
      !overview.sources.some((source) => source.id === state.selectedSourceId)
    ) {
      state.selectedSourceId = null;
      state.selectedSourceDetail = null;
    }
  }
}

function renderTree(tree) {
  els.treeView.innerHTML = "";
  const container = document.createElement("div");
  container.className = "tree-list";
  container.appendChild(renderTreeNode(tree, 0));
  els.treeView.classList.remove("empty");
  els.treeView.appendChild(container);
}

function renderTreeNode(treeNode, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";
  wrapper.style.setProperty("--depth", String(depth));

  const button = document.createElement("button");
  button.className = "tree-item";
  if (state.selectedNodeId === treeNode.node.id) {
    button.classList.add("active");
    state.selectedNodeButton = button;
  }
  button.innerHTML = `
    <span class="tree-title">${escapeHtml(treeNode.node.title)}</span>
    <span class="tree-meta">${escapeHtml(treeNode.node.kind)} · ${escapeHtml(treeNode.node.id)}</span>
  `;
  button.addEventListener("click", () => showNodeDetail(treeNode.node.id, button));
  wrapper.appendChild(button);

  for (const child of treeNode.children) {
    wrapper.appendChild(renderTreeNode(child, depth + 1));
  }
  return wrapper;
}

function renderSources(sources) {
  els.sourceList.innerHTML = "";
  if (!sources.length) {
    els.sourceList.className = "list empty";
    els.sourceList.textContent = t("sidebar.sourcesEmpty");
    return;
  }

  const stack = document.createElement("div");
  stack.className = "list-stack";
  sources.forEach((source) => {
    const button = document.createElement("button");
    button.className = "list-item";
    if (state.selectedSourceId === source.id) {
      button.classList.add("active");
      state.selectedSourceButton = button;
    }
    button.innerHTML = `
      <span class="item-title">${escapeHtml(source.original_name)}</span>
      <span class="item-meta">${escapeHtml(source.format)} · ${escapeHtml(source.id)}</span>
    `;
    button.addEventListener("click", () => showSourceDetail(source.id, button));
    stack.appendChild(button);
  });
  els.sourceList.className = "list";
  els.sourceList.appendChild(stack);
}

function renderSnapshots(snapshots) {
  els.snapshotList.innerHTML = "";
  if (!snapshots.length) {
    els.snapshotList.className = "list empty";
    els.snapshotList.textContent = t("sidebar.snapshotsEmpty");
    return;
  }

  const stack = document.createElement("div");
  stack.className = "list-stack";
  snapshots.forEach((snapshot) => {
    const item = document.createElement("div");
    item.className = "snapshot-item";
    item.innerHTML = `
      <div>
        <span class="item-title">${escapeHtml(snapshot.label || t("history.noLabel"))}</span>
        <span class="item-meta">${escapeHtml(snapshot.id)}</span>
      </div>
    `;
    const button = document.createElement("button");
    button.textContent = t("history.restore");
    button.addEventListener("click", () => restoreSnapshot(snapshot.id));
    item.appendChild(button);
    stack.appendChild(item);
  });
  els.snapshotList.className = "list";
  els.snapshotList.appendChild(stack);
}

function renderHistory(entries) {
  els.historyList.innerHTML = "";
  if (!entries.length) {
    els.historyList.className = "list empty";
    els.historyList.textContent = t("sidebar.patchHistoryEmpty");
    return;
  }

  const stack = document.createElement("div");
  stack.className = "list-stack";
  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "chunk-block";
    item.innerHTML = `
      <div class="item-title">${escapeHtml(entry.summary || t("history.noSummary"))}</div>
      <div class="item-meta">${escapeHtml(entry.origin)} · ${escapeHtml(entry.id)}</div>
    `;
    const row = document.createElement("div");
    row.className = "row";
    const previewButton = document.createElement("button");
    previewButton.textContent = t("history.preview");
    previewButton.addEventListener("click", () => previewPatchFromHistory(entry.id));
    const button = document.createElement("button");
    button.textContent = t("history.load");
    button.addEventListener("click", () => loadPatchFromHistory(entry.id));
    row.appendChild(previewButton);
    row.appendChild(button);
    item.appendChild(row);
    stack.appendChild(item);
  });
  els.historyList.className = "list";
  els.historyList.appendChild(stack);
}

function renderNodeDetail(detail) {
  els.detailMeta.textContent = t("detail.nodeMeta", { id: detail.node.id });
  const sourcesHtml = detail.sources.length
    ? detail.sources
        .map(
          (sourceDetail) => `
            <div class="chunk-block">
              <div class="item-title">${escapeHtml(sourceDetail.source.original_name)}</div>
              <div class="item-meta">${escapeHtml(sourceDetail.source.id)}</div>
              ${
                sourceDetail.chunks.length
                  ? sourceDetail.chunks
                      .map(
                        (chunk) => `
                          <div class="chunk-meta">${escapeHtml(
                            t("detail.chunkMeta", {
                              ordinal: chunk.ordinal + 1,
                              start: chunk.start_line,
                              end: chunk.end_line,
                            }),
                          )}</div>
                          <div>${escapeHtml(chunk.text)}</div>
                        `,
                      )
                      .join("")
                  : `<div class="item-meta">${escapeHtml(t("detail.sourceLevelOnly"))}</div>`
              }
            </div>
          `,
        )
        .join("")
    : `<p class="muted">${escapeHtml(t("detail.noSourceLinks"))}</p>`;

  els.detailView.className = "detail-view";
  els.detailView.innerHTML = `
    <div class="detail-section">
      <h3>${escapeHtml(t("detail.nodeSection"))}</h3>
      <div class="detail-grid">
        <div><strong>${escapeHtml(detail.node.title)}</strong></div>
        <div class="detail-pill">${escapeHtml(detail.node.kind)}</div>
        <div>${escapeHtml(detail.node.body || t("detail.noBody"))}</div>
      </div>
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(t("detail.relationsSection"))}</h3>
      <div class="detail-grid">
        <div>${escapeHtml(
          t("detail.parent", {
            value: detail.parent
              ? `${detail.parent.title} [${detail.parent.id}]`
              : t("detail.none"),
          }),
        )}</div>
        <div>${escapeHtml(
          t("detail.children", {
            value: detail.children.length
              ? detail.children
                  .map((child) => `${child.title} [${child.id}]`)
                  .join(", ")
              : t("detail.none"),
          }),
        )}</div>
      </div>
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(t("detail.sourcesSection"))}</h3>
      ${sourcesHtml}
    </div>
  `;
}

function renderSourceDetail(detail) {
  els.detailMeta.textContent = t("detail.sourceMeta", { id: detail.source.id });
  const chunksHtml = detail.chunks.length
    ? detail.chunks
        .map(
          (chunkDetail) => `
            <div class="chunk-block">
              <div class="item-title">${escapeHtml(chunkDetail.chunk.label || t("detail.noLabel"))}</div>
              <div class="chunk-meta">${escapeHtml(
                t("detail.chunkMeta", {
                  ordinal: chunkDetail.chunk.ordinal + 1,
                  start: chunkDetail.chunk.start_line,
                  end: chunkDetail.chunk.end_line,
                }),
              )}</div>
              <div>${escapeHtml(chunkDetail.chunk.text)}</div>
              <div class="item-meta">${escapeHtml(
                t("detail.nodes", {
                  value: chunkDetail.linked_nodes.length
                    ? chunkDetail.linked_nodes
                        .map((node) => `${node.title} [${node.id}]`)
                        .join(", ")
                    : t("detail.none"),
                }),
              )}</div>
            </div>
          `,
        )
        .join("")
    : `<p class="muted">${escapeHtml(t("detail.noChunks"))}</p>`;

  els.detailView.className = "detail-view";
  els.detailView.innerHTML = `
    <div class="detail-section">
      <h3>${escapeHtml(t("detail.sourceSection"))}</h3>
      <div class="detail-grid">
        <div><strong>${escapeHtml(detail.source.original_name)}</strong></div>
        <div class="detail-pill">${escapeHtml(detail.source.format)}</div>
        <div>${escapeHtml(detail.source.original_path)}</div>
      </div>
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(t("detail.chunksSection"))}</h3>
      ${chunksHtml}
    </div>
  `;
}

function renderImportPreview(preview) {
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
    t("reports.summary", { value: preview.patch.summary || t("history.noSummary") }),
    ...preview.patch.ops.map((op) => `- ${op.type || "op"}`),
  ].join("\n");
}

function renderImportReport(report) {
  return [
    t("reports.importedTitle", { name: report.original_name, id: report.source_id }),
    t("reports.storedFile", { value: report.stored_name }),
    t("reports.rootNode", { title: report.root_title, id: report.root_node_id }),
    t("reports.generatedNodes", { count: report.node_count }),
    t("reports.generatedChunks", { count: report.chunk_count }),
  ].join("\n");
}

function renderPatchReport(report, dryRun) {
  return [
    dryRun ? t("reports.patchPreviewSucceeded") : t("reports.patchApplied"),
    report.summary ? t("reports.summary", { value: report.summary }) : null,
    ...report.preview.map((line) => `- ${line}`),
    report.run_id ? t("reports.runId", { id: report.run_id }) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function loadPatchFromHistory(runId) {
  if (!ensureWorkspace()) return;
  try {
    const patch = await invoke("get_patch_document", {
      start_path: state.workspacePath,
      run_id: runId,
    });
    els.patchEditor.value = JSON.stringify(patch, null, 2);
    setConsole(t("messages.loadedPatchRun", { id: runId }), "success");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function previewPatchFromHistory(runId) {
  if (!ensureWorkspace()) return;
  try {
    const patch = await invoke("get_patch_document", {
      start_path: state.workspacePath,
      run_id: runId,
    });
    const report = await invoke("preview_patch", {
      start_path: state.workspacePath,
      patch_json: JSON.stringify(patch),
    });
    setConsole(
      [t("messages.historyPreview", { id: runId }), "", renderPatchReport(report, true)].join(
        "\n",
      ),
      "success",
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function draftAddChildPatch() {
  if (!ensureNodeSelected()) return;
  const title = els.addChildTitle.value.trim();
  if (!title) {
    setConsole(t("messages.addChildRequiresTitle"), "error");
    return;
  }

  try {
    const patch = await invoke("draft_add_node_patch", {
      title,
      parent_id: state.selectedNodeId,
      kind: optionalText(els.addChildKind.value) || "topic",
      body: optionalText(els.addChildBody.value),
      position: null,
    });
    loadDraftIntoEditor(
      patch,
      t("messages.draftedAddChild", { nodeId: state.selectedNodeId }),
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function draftUpdateNodePatch() {
  if (!ensureNodeSelected()) return;

  const title = optionalText(els.updateNodeTitle.value);
  const kind = optionalText(els.updateNodeKind.value);
  const body = optionalTextareaValue(els.updateNodeBody);
  if (title === null && kind === null && body === undefined) {
    setConsole(t("messages.updateNeedsField"), "error");
    return;
  }

  try {
    const patch = await invoke("draft_update_node_patch", {
      node_id: state.selectedNodeId,
      title,
      kind,
      body: body === undefined ? null : body,
    });
    loadDraftIntoEditor(
      patch,
      t("messages.draftedUpdate", { nodeId: state.selectedNodeId }),
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function draftMoveNodePatch() {
  if (!ensureNodeSelected()) return;
  const parentId = els.moveNodeParent.value.trim();
  if (!parentId) {
    setConsole(t("messages.provideWorkspacePath"), "error");
    return;
  }

  try {
    const patch = await invoke("draft_move_node_patch", {
      node_id: state.selectedNodeId,
      parent_id: parentId,
      position: parseOptionalInteger(els.moveNodePosition.value),
    });
    loadDraftIntoEditor(
      patch,
      t("messages.draftedMove", { nodeId: state.selectedNodeId }),
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function draftDeleteNodePatch() {
  if (!ensureNodeSelected()) return;

  try {
    const patch = await invoke("draft_delete_node_patch", {
      node_id: state.selectedNodeId,
    });
    loadDraftIntoEditor(
      patch,
      t("messages.draftedDelete", { nodeId: state.selectedNodeId }),
    );
  } catch (error) {
    setConsole(String(error), "error");
  }
}

function loadDraftIntoEditor(patch, message) {
  els.patchEditor.value = JSON.stringify(patch, null, 2);
  setConsole(message, "success");
}

function syncNodeEditForm(detail) {
  els.nodeEditMeta.textContent = t("nodeEditing.selectedMeta", {
    title: detail.node.title,
    id: detail.node.id,
  });
  els.updateNodeTitle.value = detail.node.title || "";
  els.updateNodeKind.value = detail.node.kind || "";
  els.updateNodeBody.value = detail.node.body || "";
  els.moveNodeParent.value = detail.parent?.id || "";
}

function clearNodeEditForm(message) {
  els.nodeEditMeta.textContent = message;
  els.updateNodeTitle.value = "";
  els.updateNodeKind.value = "";
  els.updateNodeBody.value = "";
  els.addChildTitle.value = "";
  els.addChildKind.value = "";
  els.addChildBody.value = "";
  els.moveNodeParent.value = "";
  els.moveNodePosition.value = "";
}

function ensureNodeSelected() {
  if (state.selectedNodeId) return true;
  setConsole(t("messages.selectNodeFirst"), "error");
  return false;
}

function ensureWorkspace() {
  if (state.workspacePath) return true;
  setConsole(t("messages.selectWorkspaceFirst"), "error");
  return false;
}

function findNodeById(treeNode, nodeId) {
  if (treeNode.node.id === nodeId) return treeNode;
  for (const child of treeNode.children) {
    const match = findNodeById(child, nodeId);
    if (match) return match;
  }
  return null;
}

function optionalText(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalTextareaValue(element) {
  const raw = element.value;
  if (raw === "") return undefined;
  return raw;
}

function parseOptionalInteger(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(t("messages.invalidInteger", { value: trimmed }));
  }
  return parsed;
}

function setDefaultConsole() {
  state.consoleMode = "default";
  els.consoleOutput.className = "console empty";
  els.consoleOutput.textContent = t("console.empty");
}

function setConsole(message, tone = "") {
  state.consoleMode = "custom";
  els.consoleOutput.className = `console ${tone}`.trim();
  els.consoleOutput.textContent = message;
}

function t(key, vars = {}) {
  const template = getMessage(translations[state.currentLocale], key)
    ?? getMessage(translations["en-US"], key)
    ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function getMessage(localeTree, key) {
  return key.split(".").reduce((current, part) => current?.[part], localeTree);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
