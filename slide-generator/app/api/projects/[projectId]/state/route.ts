import { db } from "@/lib/firebase-admin";
import { PROJECT_ID } from "@/lib/project-state";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!PROJECT_ID.test(projectId)) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const projectSnap = await db.collection("projects").doc(projectId).get();
  const currentStateId: string | undefined = projectSnap.get("current_state_id");
  if (!currentStateId) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const stateSnap = await projectSnap.ref.collection("states").doc(currentStateId).get();
  const state = stateSnap.data();
  if (!state) {
    return Response.json({ error: "state_not_found" }, { status: 404 });
  }

  delete state.updated_at_ts;
  delete state.received_at;
  return Response.json(state);
}
