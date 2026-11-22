# Slide Generator API

The Slide Generator stores Project State snapshots in Firestore and serves them over HTTP.

- **GitHub Actions** (Intent Supervisor) submit a snapshot after each merged PR.
- **The frontend** reads projects, the current state and the snapshot history.

The format of a snapshot is defined in [`schemas/project_state.schema.json`](schemas/project_state.schema.json) and explained field by field in [`schemas/README.md`](schemas/README.md). Example snapshots are in [`schemas/examples/`](schemas/examples/).

## Endpoints

| Method | Path | Used by | Auth |
| --- | --- | --- | --- |
| `POST` | `/api/projects/{projectId}/states` | GitHub Actions | Bearer token |
| `GET` | `/api/projects` | Frontend | None |
| `GET` | `/api/projects/{projectId}/state` | Frontend, GitHub Actions | None |
| `GET` | `/api/projects/{projectId}/states` | Frontend | None |
| `GET` | `/api/projects/{projectId}/states/{eventId}` | Frontend | None |
| `GET` | `/api/health` | Anyone | None |

## Conventions

- **Base URL:** `http://localhost:3000` in local development. The Vercel URL will be added after deployment.
- **Format:** Requests and responses are JSON.
- **Errors:** Every error response has an `error` code. Some also have `details`.

  ```json
  { "error": "project_not_found" }
  ```

- **Times:** Times are ISO 8601 with a time zone offset, such as `2026-11-15T10:35:00+08:00` or `2026-11-15T02:35:00Z`. A time without an offset is rejected.
- **URL encoding:** In a query string, `+` means a space. Encode `+08:00` as `%2B08:00` with `URLSearchParams` or `encodeURIComponent`, or use `curl -G --data-urlencode`.
- **`projectId`:** 2 to 63 characters: lowercase letters, digits and `-`, starting with a letter or digit. For example, `demo-app`.
- **Snapshots are complete:** Each snapshot is the full state of the project when a PR was merged, not only the changes from that PR. `trigger` is the PR that produced it.

---

## For GitHub Actions: submitting a snapshot

### Setup

| Name | Where | Value |
| --- | --- | --- |
| `INGEST_TOKEN` | Repository secret | The shared token. Ask Eddy for it. Never put it in the workflow file or in chat. |
| `SLIDE_API_URL` | Repository variable | The base URL, without a trailing `/` |

### Flow

1. Call `GET /api/projects/{projectId}/state`.
   - `200`: Use its `event_id` as `base_state_id` in the new snapshot.
   - `404`: This is the project's first snapshot. Use `"base_state_id": null`.
2. Build the new complete snapshot. Use `"event_id": "gh-run-<github.run_id>"`. It stays the same when the run is re-run, so a repeated submission is not stored twice.
3. Call `POST /api/projects/{projectId}/states`.

Only one run per project should submit at a time. Otherwise, two runs can read the same base and the second one gets `409`.

---

## Endpoint reference

### `POST /api/projects/{projectId}/states`

Stores a new snapshot and makes it the project's current state.

#### Request

| Part | Value |
| --- | --- |
| Header | `Authorization: Bearer <INGEST_TOKEN>` |
| Header | `Content-Type: application/json` |
| Body | One Project State snapshot, at most 800 KB |

Besides the JSON Schema, the server checks these rules:

1. `project_id` in the body equals `{projectId}` in the URL.
2. Ids are unique within `milestones`, `features`, `risks` and `source_refs`.
3. Every `source_ref_ids` entry, `milestone_id` and `trigger.feature_ids` entry refers to an item in the snapshot.
4. A `done` feature or milestone cites at least one `pull_request`.
5. `trigger.source_ref_id` refers to a `pull_request` in `source_refs`.

#### Responses

| Status | Meaning | Body |
| --- | --- | --- |
| `201` | Stored. It is now the current state. | `{ "ok": true, "state_id": "gh-run-1002" }` |
| `200` | A snapshot with this `event_id` was already stored. Nothing changed. | `{ "ok": true, "duplicate": true, "state_id": "gh-run-1002" }` |
| `400` | The body is not valid JSON. | `{ "error": "invalid_json" }` |
| `400` | The snapshot breaks the schema or a rule above. | `{ "error": "invalid_project_state", "details": [ ... ] }` |
| `401` | The token is missing or wrong. | `{ "error": "unauthorized" }` |
| `409` | `base_state_id` is not the project's current state. Not stored. | `{ "error": "stale_base_state", "current_state_id": "gh-run-1003" }` |
| `413` | The body is larger than 800 KB. | `{ "error": "payload_too_large" }` |

`details` lists every problem found. Schema errors are reported first; the rules are checked only after the schema passes.

```json
{
  "error": "invalid_project_state",
  "details": [
    "features \"feature-login\": unknown source_ref_id \"nope\"",
    "features \"feature-login\": done must cite a pull_request",
    "trigger.source_ref_id must refer to a pull_request in source_refs"
  ]
}
```

### `GET /api/projects`

Lists all projects, most recently updated first.

Response `200`:

```json
{
  "projects": [
    {
      "id": "demo-app",
      "name": "Demo App",
      "repository": {
        "full_name": "example-org/demo-app",
        "url": "https://github.com/example-org/demo-app"
      },
      "current_state_id": "gh-run-1003",
      "updated_at": "2026-11-17T10:00:00.000Z"
    }
  ]
}
```

`updated_at` is the `updated_at` of the current snapshot, converted to UTC.

### `GET /api/projects/{projectId}/state`

Returns the project's current snapshot.

Response `200`:

The full snapshot, in the same format as the POST body. See [`schemas/examples/feature_done.json`](schemas/examples/feature_done.json).

| Status | Body |
| --- | --- |
| `404` | `{ "error": "project_not_found" }`: the project has no snapshot yet. |

### `GET /api/projects/{projectId}/states`

Lists the project's snapshots, oldest first. Each item has only the trigger, not the full snapshot. To read one in full, call `GET /api/projects/{projectId}/states/{eventId}`.

#### Query parameters

| Name | Required | Meaning |
| --- | --- | --- |
| `from` | No | Include snapshots with `updated_at` at or after this time. |
| `to` | No | Include snapshots with `updated_at` before this time. |

Without `from` and `to`, all snapshots are listed. The range is `from <= updated_at < to`, so two adjacent periods never share a snapshot.

```text
GET /api/projects/demo-app/states?from=2026-11-14T00:00:00%2B08:00&to=2026-11-18T00:00:00%2B08:00
```

Response `200`:

```json
{
  "project_id": "demo-app",
  "from": "2026-11-13T16:00:00.000Z",
  "to": "2026-11-17T16:00:00.000Z",
  "snapshots": [
    {
      "event_id": "gh-run-1002",
      "updated_at": "2026-11-15T10:35:00+08:00",
      "source_commit_sha": "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
      "trigger": {
        "summary": "Added Markdown preview to the report editor.",
        "feature_ids": ["feature-report-editor"],
        "source_ref": {
          "id": "pr-41",
          "type": "pull_request",
          "url": "https://github.com/example-org/demo-app/pull/41",
          "title": "Add Markdown preview",
          "number": 41
        }
      }
    },
    {
      "event_id": "gh-run-1003",
      "updated_at": "2026-11-17T18:00:00+08:00",
      "source_commit_sha": "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
      "trigger": {
        "summary": "Added saving of report versions, which completes the report editor.",
        "feature_ids": ["feature-report-editor"],
        "source_ref": {
          "id": "pr-42",
          "type": "pull_request",
          "url": "https://github.com/example-org/demo-app/pull/42",
          "title": "Save report versions",
          "number": 42
        }
      }
    }
  ],
  "truncated": false
}
```

| Field | Meaning |
| --- | --- |
| `from`, `to` | The requested range in UTC, or `null` if not given. |
| `snapshots[].updated_at` | As submitted, with its original offset. |
| `snapshots[].trigger.source_ref` | The merged PR that produced the snapshot. |
| `truncated` | `true` if more than 200 snapshots match. Only the oldest 200 are returned; narrow the range to see the rest. |

| Status | Body |
| --- | --- |
| `400` | `{ "error": "invalid_period", "details": "..." }`: `from` or `to` is not a valid time, or `from` is not before `to`. |
| `404` | `{ "error": "project_not_found" }` |

### `GET /api/projects/{projectId}/states/{eventId}`

Returns one full snapshot, in the same format as the POST body.

| Status | Body |
| --- | --- |
| `200` | The snapshot. |
| `404` | `{ "error": "state_not_found" }` |

### `GET /api/health`

Checks that the server can reach Firestore.

Response `200`:

```json
{ "ok": true, "firestore": true }
```

---

## For the frontend: common tasks

| Task | Call |
| --- | --- |
| Show the project list | `GET /api/projects` |
| Show a project's current milestones, features and risks | `GET /api/projects/{projectId}/state` |
| List what was merged in a reporting period | `GET /api/projects/{projectId}/states?from=...&to=...`, then read each `trigger` |
| Open one snapshot from the list | `GET /api/projects/{projectId}/states/{eventId}` |

```ts
const params = new URLSearchParams({
  from: "2026-11-14T00:00:00+08:00",
  to: "2026-11-18T00:00:00+08:00",
});
const res = await fetch(`/api/projects/${projectId}/states?${params}`);
const { snapshots, truncated } = await res.json();
```
