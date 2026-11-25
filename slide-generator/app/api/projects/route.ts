import { connection } from "next/server";
import { db } from "@/lib/firebase-admin";

export async function GET() {
  await connection();

  const snapshot = await db.collection("projects").orderBy("updated_at_ts", "desc").get();
  const projects = snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.get("name"),
    repository: doc.get("repository"),
    current_state_id: doc.get("current_state_id"),
    updated_at: doc.get("updated_at_ts")?.toDate().toISOString() ?? null,
  }));

  return Response.json({ projects });
}
