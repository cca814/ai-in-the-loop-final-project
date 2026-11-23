import { db } from "@/lib/firebase-admin";
import { PROJECT_ID } from "@/lib/project-state";

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; eventId: string }> },
) {
  const { projectId, eventId } = await params;
  if (!PROJECT_ID.test(projectId) || !EVENT_ID.test(eventId)) {
    return Response.json({ error: "state_not_found" }, { status: 404 });
  }

  const stateSnap = await db
    .collection("projects")
    .doc(projectId)
    .collection("states")
    .doc(eventId)
    .get();
  const state = stateSnap.data();
  if (!state) {
    return Response.json({ error: "state_not_found" }, { status: 404 });
  }

  delete state.updated_at_ts;
  delete state.received_at;
  return Response.json(state);
}
