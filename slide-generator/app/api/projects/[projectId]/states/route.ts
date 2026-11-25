import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { FieldValue, Timestamp, type Query } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { checkProjectState, PROJECT_ID } from "@/lib/project-state";

const MAX_BYTES = 800 * 1024;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_SNAPSHOTS = 200;

type SourceRef = { id: string };

function parseDateTime(value: string | null): Date | null {
  if (!value || !DATE_TIME.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasValidToken(request: Request): boolean {
  const expected = process.env.INGEST_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, wanted);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  if (!hasValidToken(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { state, errors } = checkProjectState(body, projectId);
  if (!state) {
    return Response.json({ error: "invalid_project_state", details: errors }, { status: 400 });
  }

  const projectRef = db.collection("projects").doc(projectId);
  const stateRef = projectRef.collection("states").doc(state.event_id);

  const result = await db.runTransaction(async (tx) => {
    const [stateSnap, projectSnap] = await tx.getAll(stateRef, projectRef);

    if (stateSnap.exists) {
      return { status: 200, body: { ok: true, duplicate: true, state_id: state.event_id } };
    }

    const currentStateId: string | null = projectSnap.get("current_state_id") ?? null;
    if (state.base_state_id !== currentStateId) {
      return {
        status: 409,
        body: { error: "stale_base_state", current_state_id: currentStateId },
      };
    }

    tx.create(stateRef, {
      ...state,
      updated_at_ts: Timestamp.fromDate(new Date(state.updated_at)),
      received_at: FieldValue.serverTimestamp(),
    });
    tx.set(
      projectRef,
      {
        name: state.project_name,
        repository: state.repository,
        current_state_id: state.event_id,
        updated_at_ts: Timestamp.fromDate(new Date(state.updated_at)),
      },
      { merge: true },
    );
    return { status: 201, body: { ok: true, state_id: state.event_id } };
  });

  return Response.json(result.body, { status: result.status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!PROJECT_ID.test(projectId)) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = fromParam === null ? null : parseDateTime(fromParam);
  const to = toParam === null ? null : parseDateTime(toParam);
  if (
    (fromParam !== null && !from) ||
    (toParam !== null && !to) ||
    (from && to && from >= to)
  ) {
    return Response.json(
      { error: "invalid_period", details: "from and to are optional ISO 8601 times with a time zone, and from < to" },
      { status: 400 },
    );
  }

  const projectRef = db.collection("projects").doc(projectId);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  let query: Query = projectRef.collection("states");
  if (from) query = query.where("updated_at_ts", ">=", Timestamp.fromDate(from));
  if (to) query = query.where("updated_at_ts", "<", Timestamp.fromDate(to));

  const snapshot = await query
    .orderBy("updated_at_ts", "asc")
    .select("event_id", "updated_at", "source_commit_sha", "trigger", "source_refs")
    .limit(MAX_SNAPSHOTS + 1)
    .get();

  const docs = snapshot.docs.slice(0, MAX_SNAPSHOTS);
  const snapshots = docs.map((doc) => {
    const trigger = doc.get("trigger");
    const sourceRefs: SourceRef[] = doc.get("source_refs") ?? [];
    return {
      event_id: doc.get("event_id"),
      updated_at: doc.get("updated_at"),
      source_commit_sha: doc.get("source_commit_sha"),
      trigger: {
        summary: trigger.summary,
        feature_ids: trigger.feature_ids ?? [],
        source_ref: sourceRefs.find((ref) => ref.id === trigger.source_ref_id) ?? null,
      },
    };
  });

  return Response.json({
    project_id: projectId,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    snapshots,
    truncated: snapshot.docs.length > MAX_SNAPSHOTS,
  });
}
