// Display contract only; the backend ingestion boundary owns full schema validation.
export type WorkspaceState = {
  evidence_kind?: 'repository_snapshot';
  project_id: string; project_name: string; event_id: string; source_commit_sha: string;
  updated_at: string; base_state_id: string | null;
  repository: { full_name: string; url: string };
  trigger: { source_ref_id: string; summary: string };
  source_refs: { id: string; url: string; title?: string }[];
  features: unknown[]; risks: unknown[]; data_gaps: { section: string }[];
};

export type WorkspaceDataset = {
  id: string; label: string;
  supportsHistory?: boolean; supportsRepository?: boolean;
  snapshots: { id: string; label: string; state: WorkspaceState }[];
};
