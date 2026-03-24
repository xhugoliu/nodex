import { open } from "@tauri-apps/plugin-dialog";

const invoke = window.__TAURI__?.core?.invoke;

const state = {
  workspacePath: "",
  selectedNodeId: null,
  selectedSourceId: null,
  selectedNodeButton: null,
  selectedSourceButton: null,
  selectedNodeDetail: null,
};

const els = {
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

if (!invoke) {
  setConsole("Tauri runtime is not available in this context.", "error");
}

bindEvents();

function bindEvents() {
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
    setConsole("Patch editor cleared.");
  });
}

async function chooseWorkspaceFolder() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a Nodex workspace directory",
    });
    if (typeof selected === "string") {
      els.workspacePath.value = selected;
      setConsole(`Selected workspace folder: ${selected}`);
    }
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function chooseSourceFile() {
  try {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Choose a source file",
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Text", extensions: ["txt", "text"] },
      ],
    });
    if (typeof selected === "string") {
      els.sourcePath.value = selected;
      setConsole(`Selected source file: ${selected}`);
    }
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function loadWorkspace(mode) {
  const workspacePath = els.workspacePath.value.trim();
  if (!workspacePath) {
    setConsole("Please provide a workspace path first.", "error");
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
      mode === "init"
        ? `Initialized and opened workspace at ${overview.root_dir}.`
        : `Opened workspace at ${overview.root_dir}.`,
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
    setConsole(`Refreshed ${overview.workspace_name}.`);
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function previewSourceImport() {
  if (!ensureWorkspace()) return;
  const sourcePath = els.sourcePath.value.trim();
  if (!sourcePath) {
    setConsole("Please provide a source file path.", "error");
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
    setConsole("Please provide a source file path.", "error");
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
    setConsole("Patch editor is empty.", "error");
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
    setConsole("Patch editor is empty.", "error");
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
    setConsole(`Saved snapshot ${snapshot.id}.`, "success");
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
    setConsole(`Restored snapshot ${snapshotId}.`, "success");
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
    markActive(button, "source");
    renderSourceDetail(detail);
    clearNodeEditForm("Select a node to draft edit patches.");
  } catch (error) {
    setConsole(String(error), "error");
  }
}

function applyWorkspaceOverview(overview) {
  state.workspacePath = overview.root_dir;
  els.workspaceMeta.textContent = `${overview.workspace_name} — ${overview.root_dir}`;
  renderTree(overview.tree);
  renderSources(overview.sources);
  renderSnapshots(overview.snapshots);
  renderHistory(overview.patch_history);
  if (state.selectedNodeId && !findNodeById(overview.tree, state.selectedNodeId)) {
    state.selectedNodeId = null;
    state.selectedNodeDetail = null;
    clearNodeEditForm("Select a node to draft edit patches.");
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
    els.sourceList.textContent = "No sources loaded.";
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
    els.snapshotList.textContent = "No snapshots loaded.";
    return;
  }

  const stack = document.createElement("div");
  stack.className = "list-stack";
  snapshots.forEach((snapshot) => {
    const item = document.createElement("div");
    item.className = "snapshot-item";
    item.innerHTML = `
      <div>
        <span class="item-title">${escapeHtml(snapshot.label || "(no label)")}</span>
        <span class="item-meta">${escapeHtml(snapshot.id)}</span>
      </div>
    `;
    const button = document.createElement("button");
    button.textContent = "Restore";
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
    els.historyList.textContent = "No patch history yet.";
    return;
  }

  const stack = document.createElement("div");
  stack.className = "list-stack";
  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "chunk-block";
    item.innerHTML = `
      <div class="item-title">${escapeHtml(entry.summary || "(no summary)")}</div>
      <div class="item-meta">${escapeHtml(entry.origin)} · ${escapeHtml(entry.id)}</div>
    `;
    const row = document.createElement("div");
    row.className = "row";
    const previewButton = document.createElement("button");
    previewButton.textContent = "Preview";
    previewButton.addEventListener("click", () => previewPatchFromHistory(entry.id));
    const button = document.createElement("button");
    button.textContent = "Load Patch";
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
  els.detailMeta.textContent = `Node ${detail.node.id}`;
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
                          <div class="chunk-meta">Chunk ${chunk.ordinal + 1} · ${chunk.start_line}-${chunk.end_line}</div>
                          <div>${escapeHtml(chunk.text)}</div>
                        `,
                      )
                      .join("")
                  : "<div class=\"item-meta\">Source-level link only</div>"
              }
            </div>
          `,
        )
        .join("")
    : "<p class=\"muted\">No source links.</p>";

  els.detailView.className = "detail-view";
  els.detailView.innerHTML = `
    <div class="detail-section">
      <h3>Node</h3>
      <div class="detail-grid">
        <div><strong>${escapeHtml(detail.node.title)}</strong></div>
        <div class="detail-pill">${escapeHtml(detail.node.kind)}</div>
        <div>${escapeHtml(detail.node.body || "(no body)")}</div>
      </div>
    </div>
    <div class="detail-section">
      <h3>Relations</h3>
      <div class="detail-grid">
        <div>Parent: ${escapeHtml(detail.parent ? `${detail.parent.title} [${detail.parent.id}]` : "(none)")}</div>
        <div>Children: ${detail.children.length ? detail.children.map((child) => escapeHtml(`${child.title} [${child.id}]`)).join(", ") : "(none)"}</div>
      </div>
    </div>
    <div class="detail-section">
      <h3>Sources</h3>
      ${sourcesHtml}
    </div>
  `;
}

function renderSourceDetail(detail) {
  els.detailMeta.textContent = `Source ${detail.source.id}`;
  const chunksHtml = detail.chunks.length
    ? detail.chunks
        .map(
          (chunkDetail) => `
            <div class="chunk-block">
              <div class="item-title">${escapeHtml(chunkDetail.chunk.label || "(no label)")}</div>
              <div class="chunk-meta">Chunk ${chunkDetail.chunk.ordinal + 1} · ${chunkDetail.chunk.start_line}-${chunkDetail.chunk.end_line}</div>
              <div>${escapeHtml(chunkDetail.chunk.text)}</div>
              <div class="item-meta">Nodes: ${chunkDetail.linked_nodes.length ? chunkDetail.linked_nodes.map((node) => escapeHtml(`${node.title} [${node.id}]`)).join(", ") : "(none)"}</div>
            </div>
          `,
        )
        .join("")
    : "<p class=\"muted\">No chunks.</p>";

  els.detailView.className = "detail-view";
  els.detailView.innerHTML = `
    <div class="detail-section">
      <h3>Source</h3>
      <div class="detail-grid">
        <div><strong>${escapeHtml(detail.source.original_name)}</strong></div>
        <div class="detail-pill">${escapeHtml(detail.source.format)}</div>
        <div>${escapeHtml(detail.source.original_path)}</div>
      </div>
    </div>
    <div class="detail-section">
      <h3>Chunks</h3>
      ${chunksHtml}
    </div>
  `;
}

function renderImportPreview(preview) {
  const lines = preview.patch.ops.map((op) => `- ${op.type || "op"}`);
  return [
    `Dry preview for ${preview.report.original_name}`,
    `planned source id: ${preview.report.source_id}`,
    `planned root node: ${preview.report.root_title} [${preview.report.root_node_id}]`,
    `planned nodes: ${preview.report.node_count}`,
    `planned chunks: ${preview.report.chunk_count}`,
    "",
    `summary: ${preview.patch.summary || "(no summary)"}`,
    ...lines,
  ].join("\n");
}

function renderImportReport(report) {
  return [
    `Imported ${report.original_name} as ${report.source_id}`,
    `stored file: ${report.stored_name}`,
    `root node: ${report.root_title} [${report.root_node_id}]`,
    `generated nodes: ${report.node_count}`,
    `generated chunks: ${report.chunk_count}`,
  ].join("\n");
}

function renderPatchReport(report, dryRun) {
  return [
    dryRun ? "Patch preview succeeded." : "Patch applied.",
    report.summary ? `summary: ${report.summary}` : null,
    ...report.preview.map((line) => `- ${line}`),
    report.run_id ? `run id: ${report.run_id}` : null,
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
    setConsole(`Loaded patch run ${runId} into the editor.`, "success");
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
      [`History preview: ${runId}`, "", renderPatchReport(report, true)].join("\n"),
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
    setConsole("Add child requires a title.", "error");
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
    loadDraftIntoEditor(patch, `Drafted add-child patch under ${state.selectedNodeId}.`);
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
    setConsole("Update draft needs at least one changed field.", "error");
    return;
  }

  try {
    const patch = await invoke("draft_update_node_patch", {
      node_id: state.selectedNodeId,
      title,
      kind,
      body: body === undefined ? null : body,
    });
    loadDraftIntoEditor(patch, `Drafted update patch for ${state.selectedNodeId}.`);
  } catch (error) {
    setConsole(String(error), "error");
  }
}

async function draftMoveNodePatch() {
  if (!ensureNodeSelected()) return;
  const parentId = els.moveNodeParent.value.trim();
  if (!parentId) {
    setConsole("Move draft requires a new parent id.", "error");
    return;
  }

  try {
    const patch = await invoke("draft_move_node_patch", {
      node_id: state.selectedNodeId,
      parent_id: parentId,
      position: parseOptionalInteger(els.moveNodePosition.value),
    });
    loadDraftIntoEditor(patch, `Drafted move patch for ${state.selectedNodeId}.`);
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
    loadDraftIntoEditor(patch, `Drafted delete patch for ${state.selectedNodeId}.`);
  } catch (error) {
    setConsole(String(error), "error");
  }
}

function loadDraftIntoEditor(patch, message) {
  els.patchEditor.value = JSON.stringify(patch, null, 2);
  setConsole(message, "success");
}

function syncNodeEditForm(detail) {
  els.nodeEditMeta.textContent = `Selected node: ${detail.node.title} [${detail.node.id}]`;
  els.updateNodeTitle.value = detail.node.title || "";
  els.updateNodeKind.value = detail.node.kind || "";
  els.updateNodeBody.value = detail.node.body || "";
  els.moveNodeParent.value = detail.node.parent?.id || "";
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
  setConsole("Select a node in the tree first.", "error");
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
    throw new Error(`Invalid integer value: ${trimmed}`);
  }
  return parsed;
}

function markActive(button, kind) {
  if (kind === "node") {
    state.selectedNodeButton?.classList.remove("active");
    state.selectedSourceButton?.classList.remove("active");
    state.selectedNodeButton = button;
    state.selectedSourceButton = null;
  } else {
    state.selectedSourceButton?.classList.remove("active");
    state.selectedNodeButton?.classList.remove("active");
    state.selectedSourceButton = button;
    state.selectedNodeButton = null;
  }
  button.classList.add("active");
}

function ensureWorkspace() {
  if (state.workspacePath) return true;
  setConsole("Open or initialize a workspace first.", "error");
  return false;
}

function setConsole(message, tone = "") {
  els.consoleOutput.className = `console ${tone}`.trim();
  els.consoleOutput.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
