// End-to-end test of the Slide Generator API: submits Project State snapshots,
// reads them back, then saves, lists, opens and updates a report.
//
// Run from slide-generator/ while `npm run dev` is running:
//   npm run test:api
// To test the deployed site instead (needs the production INGEST_TOKEN in .env.local):
//   BASE_URL=https://slide-generator-delta.vercel.app npm run test:api
//
// Each run uses a new project, api-test-<time>, and deletes it from Firestore at the end.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PROJECT = `api-test-${Date.now()}`;
const PROJECT_URL = `${BASE_URL}/api/projects/${PROJECT}`;
const AUTH = { authorization: `Bearer ${process.env.INGEST_TOKEN}` };

// Snapshot n (1001, 1002, ...) as the Intent Supervisor would submit it.
function snapshot(n, base) {
  const day = n - 1000; // 1001 -> Nov 11, 1002 -> Nov 12, ...
  const pr = n - 960;
  return {
    event_id: `gh-run-${n}`,
    project_id: PROJECT,
    project_name: "API Test",
    repository: { full_name: "example-org/api-test", url: "https://github.com/example-org/api-test" },
    source_commit_sha: String(n).padStart(40, "0"),
    base_state_id: base,
    updated_at: `2026-11-${10 + day}T10:00:00+08:00`,
    pull_request: {
      number: pr,
      title: `Test PR ${pr}`,
      url: `https://github.com/example-org/api-test/pull/${pr}`,
      merged_at: `2026-11-${10 + day}T01:55:00Z`,
    },
    content: `# API Test\n\nState after PR #${pr}.\n`,
  };
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
  const { status } = await call("POST", "/states", snapshot(1001, null));
  assert.equal(status, 401);
});

test("the first snapshot is stored with 201", async () => {
  const { status, body } = await call("POST", "/states", snapshot(1001, null), AUTH);
  assert.equal(status, 201);
  assert.equal(body.state_id, "gh-run-1001");
});

test("a repeated event_id returns 200 and is not stored twice", async () => {
  const { status, body } = await call("POST", "/states", snapshot(1001, null), AUTH);
  assert.equal(status, 200);
  assert.equal(body.duplicate, true);
});

test("a snapshot built on an old base is rejected with 409", async () => {
  const { status, body } = await call("POST", "/states", snapshot(1003, "gh-run-1002"), AUTH);
  assert.equal(status, 409);
  assert.equal(body.current_state_id, "gh-run-1001");
});

test("a snapshot that breaks the schema is rejected with 400", async () => {
  const bad = { ...snapshot(1002, "gh-run-1001"), content: "" };
  const { status, body } = await call("POST", "/states", bad, AUTH);
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_project_state");
  assert.ok(body.details.length > 0);
});

test("a project_id that differs from the URL is rejected with 400", async () => {
  const bad = { ...snapshot(1002, "gh-run-1001"), project_id: "another-project" };
  const { status } = await call("POST", "/states", bad, AUTH);
  assert.equal(status, 400);
});

test("later snapshots are stored in order", async () => {
  assert.equal((await call("POST", "/states", snapshot(1002, "gh-run-1001"), AUTH)).status, 201);
  assert.equal((await call("POST", "/states", snapshot(1003, "gh-run-1002"), AUTH)).status, 201);
});

test("the list returns every snapshot's PR, oldest first", async () => {
  const { status, body } = await call("GET", "/states");
  assert.equal(status, 200);
  assert.deepEqual(
    body.snapshots.map((s) => s.event_id),
    ["gh-run-1001", "gh-run-1002", "gh-run-1003"],
  );
  assert.equal(body.snapshots[0].pull_request.number, 41);
});

test("the list can be limited to a period", async () => {
  const period = new URLSearchParams({
    from: "2026-11-12T00:00:00+08:00",
    to: "2026-11-13T00:00:00+08:00",
  });
  const { status, body } = await call("GET", `/states?${period}`);
  assert.equal(status, 200);
  assert.deepEqual(body.snapshots.map((s) => s.event_id), ["gh-run-1002"]);
});

test("the current state is the latest snapshot, with its Markdown", async () => {
  const { status, body } = await call("GET", "/state");
  assert.equal(status, 200);
  assert.equal(body.event_id, "gh-run-1003");
  assert.match(body.content, /PR #43/);
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
