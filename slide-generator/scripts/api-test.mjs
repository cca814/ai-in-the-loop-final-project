// End-to-end test of the Slide Generator API: submits Project State snapshots,
// reads them back, then saves, lists, opens and updates a report.
//
// Run from slide-generator/ while `npm run dev` is running:
//   npm run test:api
// To test the deployed site instead (needs the production INGEST_TOKEN in .env.local):
//   BASE_URL=https://slide-generator-delta.vercel.app npm run test:api
//
// Each run uses a new project, api-test-<time>, and deletes it from Firestore at the end.
// The snapshots are the examples in schemas/examples, moved to that project.

import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PROJECT = `api-test-${Date.now()}`;
const PROJECT_URL = `${BASE_URL}/api/projects/${PROJECT}`;
const AUTH = { authorization: `Bearer ${process.env.INGEST_TOKEN}` };

// An example snapshot (gh-run-1001, gh-run-1002 or gh-run-1003) with this run's project_id.
// gh-run-1001 is the first snapshot; each later one is built on the one before it.
function example(eventId) {
  const file = new URL(`../schemas/examples/${eventId}.json`, import.meta.url);
  return { ...JSON.parse(readFileSync(file, "utf8")), project_id: PROJECT };
}

async function call(method, path, body, headers = {}) {
  const response = await fetch(`${PROJECT_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

after(async () => {
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    console.log(`No Firebase values found; delete projects/${PROJECT} by hand.`);
    return;
  }
  const app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  await getFirestore(app).recursiveDelete(getFirestore(app).doc(`projects/${PROJECT}`));
});

// Project State

test("the server can reach Firestore", async () => {
  const response = await fetch(`${BASE_URL}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, firestore: true });
});

test("a snapshot without the token is rejected with 401", async () => {
  const { status } = await call("POST", "/states", example("gh-run-1001"));
  assert.equal(status, 401);
});

test("the first snapshot is stored with 201", async () => {
  const { status, body } = await call("POST", "/states", example("gh-run-1001"), AUTH);
  assert.equal(status, 201);
  assert.equal(body.state_id, "gh-run-1001");
});

test("a repeated event_id returns 200 and is not stored twice", async () => {
  const { status, body } = await call("POST", "/states", example("gh-run-1001"), AUTH);
  assert.equal(status, 200);
  assert.equal(body.duplicate, true);
});

test("a snapshot built on an old base is rejected with 409", async () => {
  // gh-run-1003 is built on gh-run-1002, but the current state is still gh-run-1001.
  const { status, body } = await call("POST", "/states", example("gh-run-1003"), AUTH);
  assert.equal(status, 409);
  assert.equal(body.current_state_id, "gh-run-1001");
});

test("a snapshot that breaks the schema is rejected with 400", async () => {
  const bad = { ...example("gh-run-1002"), content: "" };
  const { status, body } = await call("POST", "/states", bad, AUTH);
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_project_state");
  assert.ok(body.details.length > 0);
});

test("a project_id that differs from the URL is rejected with 400", async () => {
  const bad = { ...example("gh-run-1002"), project_id: "another-project" };
  const { status } = await call("POST", "/states", bad, AUTH);
  assert.equal(status, 400);
});

test("later snapshots are stored in order", async () => {
  assert.equal((await call("POST", "/states", example("gh-run-1002"), AUTH)).status, 201);
  assert.equal((await call("POST", "/states", example("gh-run-1003"), AUTH)).status, 201);
});

test("the list returns every snapshot's PR, oldest first", async () => {
  const { status, body } = await call("GET", "/states");
  assert.equal(status, 200);
  assert.deepEqual(
    body.snapshots.map((s) => s.event_id),
    ["gh-run-1001", "gh-run-1002", "gh-run-1003"],
  );
  assert.deepEqual(body.snapshots[0].pull_request, example("gh-run-1001").pull_request);
});

test("the list can be limited to a period", async () => {
  // Only gh-run-1002 (updated_at 2026-11-15) falls between the other two examples.
  const period = new URLSearchParams({
    from: "2026-11-14T00:00:00+08:00",
    to: "2026-11-16T00:00:00+08:00",
  });
  const { status, body } = await call("GET", `/states?${period}`);
  assert.equal(status, 200);
  assert.deepEqual(body.snapshots.map((s) => s.event_id), ["gh-run-1002"]);
});

test("the current state is the latest snapshot, with its Markdown", async () => {
  const { status, body } = await call("GET", "/state");
  assert.equal(status, 200);
  assert.equal(body.event_id, "gh-run-1003");
  assert.equal(body.updated_at, example("gh-run-1003").updated_at);
  assert.equal(body.content, example("gh-run-1003").content);
});

test("one snapshot can be read by its event_id", async () => {
  const { status, body } = await call("GET", "/states/gh-run-1001");
  assert.equal(status, 200);
  assert.equal(body.base_state_id, null);
});

// Reports and slides

let reportId;

test("a new report is saved with 201 and gets an id", async () => {
  const { status, body } = await call("POST", "/reports", {
    name: "Week 12 report",
    type: "report",
    content: "# Progress",
  });
  assert.equal(status, 201);
  assert.match(body.id, /^[A-Za-z0-9]{20}$/);
  reportId = body.id;
});

test("the report list has the name but not the content", async () => {
  const { status, body } = await call("GET", "/reports");
  assert.equal(status, 200);
  const item = body.reports.find((r) => r.id === reportId);
  assert.equal(item.name, "Week 12 report");
  assert.equal(item.content, undefined);
});

test("saving again with the same id overwrites the report", async () => {
  const saved = await call("PUT", `/reports/${reportId}`, {
    name: "Week 12 report v2",
    type: "report",
    content: "# Progress, revised",
  });
  assert.equal(saved.status, 200);

  const { body } = await call("GET", `/reports/${reportId}`);
  assert.equal(body.name, "Week 12 report v2");
  assert.equal(body.content, "# Progress, revised");
});

test("a save with a different type is rejected with 400", async () => {
  const { status, body } = await call("PUT", `/reports/${reportId}`, {
    name: "x",
    type: "slides",
    content: "y",
  });
  assert.equal(status, 400);
  assert.equal(body.error, "type_mismatch");
});

test("an unknown report returns 404", async () => {
  const { status } = await call("GET", "/reports/AAAAAAAAAAAAAAAAAAAA");
  assert.equal(status, 404);
});
