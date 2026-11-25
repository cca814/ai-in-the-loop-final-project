import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { PROJECT_ID } from "@/lib/project-state";
import { readReport, REPORT_ID } from "@/lib/report";

type Params = { params: Promise<{ projectId: string; reportId: string }> };

function reportRefFor(projectId: string, reportId: string) {
  return db.collection("projects").doc(projectId).collection("reports").doc(reportId);
}

export async function GET(_request: Request, { params }: Params) {
  const { projectId, reportId } = await params;
  if (!PROJECT_ID.test(projectId) || !REPORT_ID.test(reportId)) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  const report = (await reportRefFor(projectId, reportId).get()).data();
  if (!report) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  return Response.json({
    id: reportId,
    name: report.name,
    type: report.type,
    content: report.content,
    created_at: (report.created_at as Timestamp).toDate().toISOString(),
    updated_at: (report.updated_at as Timestamp).toDate().toISOString(),
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { projectId, reportId } = await params;
  if (!PROJECT_ID.test(projectId) || !REPORT_ID.test(reportId)) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  const parsed = await readReport(request);
  if (parsed.error) return parsed.error;
  const { name, type, content } = parsed.value;

  const reportRef = reportRefFor(projectId, reportId);
  const now = Timestamp.now();

  const result = await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef);
    if (!reportSnap.exists) {
      return { status: 404, body: { error: "report_not_found" } };
    }
    if (reportSnap.get("type") !== type) {
      return { status: 400, body: { error: "type_mismatch", type: reportSnap.get("type") } };
    }

    tx.update(reportRef, { name, content, updated_at: now });
    return {
      status: 200,
      body: {
        id: reportId,
        name,
        type,
        updated_at: now.toDate().toISOString(),
      },
    };
  });

  return Response.json(result.body, { status: result.status });
}
