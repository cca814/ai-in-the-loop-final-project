import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { PROJECT_ID } from "@/lib/project-state";
import { readReport } from "@/lib/report";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  if (!PROJECT_ID.test(projectId)) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const parsed = await readReport(request);
  if (parsed.error) return parsed.error;
  const { name, type, content } = parsed.value;

  const projectRef = db.collection("projects").doc(projectId);
  if (!(await projectRef.get()).exists) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const reportRef = projectRef.collection("reports").doc();
  const now = Timestamp.now();
  await reportRef.create({ name, type, content, created_at: now, updated_at: now });

  return Response.json(
    { id: reportRef.id, name, type, updated_at: now.toDate().toISOString() },
    { status: 201 },
  );
}

export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  if (!PROJECT_ID.test(projectId)) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const projectRef = db.collection("projects").doc(projectId);
  if (!(await projectRef.get()).exists) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const snapshot = await projectRef
    .collection("reports")
    .orderBy("updated_at", "desc")
    .select("name", "type", "updated_at")
    .get();

  const reports = snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.get("name"),
    type: doc.get("type"),
    updated_at: (doc.get("updated_at") as Timestamp).toDate().toISOString(),
  }));
  return Response.json({ reports });
}
