export type Locale = "en-US" | "zh-CN";
export type LanguagePreference = Locale | "auto";

export interface NodeRecord {
  id: string;
  parent_id: string | null;
  title: string;
  body: string | null;
  kind: string;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface TreeNode {
  node: NodeRecord;
  children: TreeNode[];
}

export interface PatchRunRecord {
  id: string;
  summary: string | null;
  origin: string;
  file_name: string;
  applied_at: number;
}

export interface SnapshotRecord {
  id: string;
  label: string | null;
  file_name: string;
  created_at: number;
}

export interface ApplyPatchReport {
  run_id: string | null;
  summary: string | null;
  preview: string[];
}

export interface SourceRecord {
  id: string;
  original_path: string;
  original_name: string;
  stored_name: string;
  format: string;
  imported_at: number;
}

export interface SourceImportReport {
  source_id: string;
  original_name: string;
  stored_name: string;
  root_node_id: string;
  root_title: string;
  node_count: number;
  chunk_count: number;
}

export interface PatchOperation {
  type?: string;
  [key: string]: unknown;
}

export interface PatchDocument {
  version: number;
  summary: string | null;
  ops: PatchOperation[];
}

export interface SourceImportPreview {
  report: SourceImportReport;
  patch: PatchDocument;
}

export interface NodeSummary {
  id: string;
  title: string;
}

export interface SourceChunkRecord {
  id: string;
  source_id: string;
  ordinal: number;
  label: string | null;
  text: string;
  start_line: number;
  end_line: number;
}

export interface NodeSourceDetail {
  source: SourceRecord;
  chunks: SourceChunkRecord[];
}

export interface NodeDetail {
  node: NodeRecord;
  parent: NodeSummary | null;
  children: NodeSummary[];
  sources: NodeSourceDetail[];
}

export interface SourceChunkDetail {
  chunk: SourceChunkRecord;
  linked_nodes: NodeSummary[];
}

export interface SourceDetail {
  source: SourceRecord;
  chunks: SourceChunkDetail[];
}

export interface WorkspaceOverview {
  root_dir: string;
  workspace_name: string;
  tree: TreeNode;
  sources: SourceRecord[];
  snapshots: SnapshotRecord[];
  patch_history: PatchRunRecord[];
}
