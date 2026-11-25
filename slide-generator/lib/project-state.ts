import "server-only";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@/schemas/project_state.schema.json";

type SourceRef = { id: string; type: "pull_request" | "issue" | "document" };
type Cited = { id: string; status?: string; source_ref_ids: string[] };

export type ProjectState = {
  event_id: string;
  project_id: string;
  project_name: string;
  repository: { full_name: string; url: string };
  base_state_id: string | null;
  updated_at: string;
  milestones: Cited[];
  features: (Cited & { milestone_id?: string })[];
  risks: Cited[];
  trigger: { source_ref_id: string; feature_ids?: string[] };
  source_refs: SourceRef[];
};

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<ProjectState>(schema);

export function checkProjectState(
  body: unknown,
  projectId: string,
): { state: ProjectState; errors: [] } | { state: null; errors: string[] } {
  if (!validate(body)) {
    const errors = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "(root)"} ${e.message}`,
    );
    return { state: null, errors };
  }

  const state = body;
  const errors: string[] = [];

  // Rule 1: project_id in the body must equal projectId in the URL.
  if (state.project_id !== projectId) {
    errors.push(`project_id must equal "${projectId}" from the URL`);
  }

  // Rule 2: ids must be unique within each array.
  for (const name of ["milestones", "features", "risks", "source_refs"] as const) {
    const seen = new Set<string>();
    for (const item of state[name]) {
      if (seen.has(item.id)) errors.push(`${name}: duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  }

  const refTypes = new Map(state.source_refs.map((r) => [r.id, r.type]));
  const milestoneIds = new Set(state.milestones.map((m) => m.id));
  const featureIds = new Set(state.features.map((f) => f.id));

  for (const name of ["milestones", "features", "risks"] as const) {
    for (const item of state[name]) {
      // Rule 3: every source_ref_id must exist in source_refs.
      for (const ref of item.source_ref_ids) {
        if (!refTypes.has(ref)) {
          errors.push(`${name} "${item.id}": unknown source_ref_id "${ref}"`);
        }
      }
      // Rule 4: done must cite at least one pull_request.
      const citesPr = item.source_ref_ids.some((ref) => refTypes.get(ref) === "pull_request");
      if (item.status === "done" && !citesPr) {
        errors.push(`${name} "${item.id}": done must cite a pull_request`);
      }
    }
  }

  // Rule 3 (continued): milestone_id and feature_ids must exist.
  for (const f of state.features) {
    if (f.milestone_id && !milestoneIds.has(f.milestone_id)) {
      errors.push(`features "${f.id}": unknown milestone_id "${f.milestone_id}"`);
    }
  }
  for (const id of state.trigger.feature_ids ?? []) {
    if (!featureIds.has(id)) errors.push(`trigger: unknown feature_id "${id}"`);
  }

  // Rule 5: the trigger must be a pull_request in source_refs.
  if (refTypes.get(state.trigger.source_ref_id) !== "pull_request") {
    errors.push("trigger.source_ref_id must refer to a pull_request in source_refs");
  }

  return errors.length ? { state: null, errors } : { state, errors: [] };
}
