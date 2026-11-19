import { db } from "@/lib/firebase-admin";

export async function GET() {
  const ref = db.collection("_health").doc("ping");
  await ref.set({ checked_at: new Date() });
  const snapshot = await ref.get();
  return Response.json({ ok: true, firestore: snapshot.exists });
}
