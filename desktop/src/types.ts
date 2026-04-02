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

export interface AiEvidenceReference {
  source_id: string;
  source_name: string;
  chunk_id: string;
  label: string | null;
  start_line: number;
  end_line: number;
  why_it_matters: string;
}

export interface AiPatchExplanation {
  rationale_summary: string;
  direct_evidence: AiEvidenceReference[];
  inferred_suggestions: string[];
}

export interface AiRunMetadata {
  run_id: string;
  capability: string;
  explore_by: string | null;
  node_id: string;
  command: string;
  dry_run: boolean;
  status: string;
  started_at: number;
  finished_at: number;
  request_path: string;
  response_path: string;
  exit_code: number | null;
  provider: string | null;
  model: string | null;
  provider_run_id: string | null;
  retry_count: number;
  last_error_category: string | null;
  last_error_message: string | null;
  last_status_code: number | null;
  patch_run_id: string | null;
  patch_summary: string | null;
}

export interface AiRunRecord {
  id: string;
  capability: string;
  explore_by: string | null;
  node_id: string;
  command: string;
  dry_run: boolean;
  status: string;
  started_at: number;
  finished_at: number;
  request_path: string;
  response_path: string;
  exit_code: number | null;
  provider: string | null;
  model: string | null;
  provider_run_id: string | null;
  retry_count: number;
  last_error_category: string | null;
  last_error_message: string | null;
  last_status_code: number | null;
  patch_run_id: string | null;
  patch_summary: string | null;
}

export interface ExternalRunnerReport {
  request_path: string;
  response_path: string;
  metadata_path: string;
  command: string;
  exit_code: number;
  metadata: AiRunMetadata;
  explanation: AiPatchExplanation;
  notes: string[];
  patch: PatchDocument;
  report: ApplyPatchReport;
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

export interface ParentCandidate {
  id: string;
  label: string;
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

export interface NodeEvidenceDetail {
  source: SourceRecord;
  chunks: SourceChunkRecord[];
}

export interface NodeDetail {
  node: NodeRecord;
  parent: NodeSummary | null;
  children: NodeSummary[];
  sources: NodeSourceDetail[];
  evidence: NodeEvidenceDetail[];
}

export interface SourceChunkDetail {
  chunk: SourceChunkRecord;
  linked_nodes: NodeSummary[];
  evidence_nodes: NodeSummary[];
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
