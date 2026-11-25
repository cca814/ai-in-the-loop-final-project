import "server-only";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@/schemas/project_state.schema.json";

export type ProjectState = {
  event_id: string;
  project_id: string;
  project_name: string;
  repository: { full_name: string; url: string };
  source_commit_sha: string;
  base_state_id: string | null;
  updated_at: string;
  pull_request: { number: number; title: string; url: string; merged_at: string };
  generator?: { name: string; version: string; model?: string };
  content: string;
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

  // The schema cannot compare a field with the URL.
  if (body.project_id !== projectId) {
    return { state: null, errors: [`project_id must equal "${projectId}" from the URL`] };
  }

  return { state: body, errors: [] };
}