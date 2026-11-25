# Slide Generator API

The Slide Generator stores Project State snapshots, `report.md` files and `slides.md` files in Firestore and serves them over HTTP.

- **GitHub Actions** (Intent Supervisor) submit a snapshot after each merged PR.
- **The frontend** reads projects, the current state and the snapshot history, and saves and opens `report.md` and `slides.md`.

The format of a snapshot is defined in [`schemas/project_state.schema.json`](schemas/project_state.schema.json) and explained field by field in [`schemas/README.md`](schemas/README.md). Example snapshots are in [`schemas/examples/`](schemas/examples/).

## Endpoints

| Method | Path | Used by | Auth |
| --- | --- | --- | --- |
| `POST` | `/api/projects/{projectId}/states` | GitHub Actions | Bearer token |
| `GET` | `/api/projects` | Frontend | None |
| `GET` | `/api/projects/{projectId}/state` | Frontend, GitHub Actions | None |
| `GET` | `/api/projects/{projectId}/states` | Frontend | None |
| `GET` | `/api/projects/{projectId}/states/{eventId}` | Frontend | None |
| `POST` | `/api/projects/{projectId}/reports` | Frontend | None |
| `GET` | `/api/projects/{projectId}/reports` | Frontend | None |
| `GET` | `/api/projects/{projectId}/reports/{reportId}` | Frontend | None |
| `PUT` | `/api/projects/{projectId}/reports/{reportId}` | Frontend | None |
| `GET` | `/api/health` | Anyone | None |

## Conventions

- **Base URL:** `https://slide-generator-delta.vercel.app` in production, `http://localhost:3000` in local development.
- **Format:** Requests and responses are JSON.
- **Errors:** Every error response has an `error` code. Some also have `details`.

  ```json
  { "error": "project_not_found" }
  ```

- **Times:** Times are ISO 8601 with a time zone offset, such as `2026-11-15T10:35:00+08:00` or `2026-11-15T02:35:00Z`. A time without an offset is rejected.
- **URL encoding:** In a query string, `+` means a space. Encode `+08:00` as `%2B08:00` with `URLSearchParams` or `encodeURIComponent`, or use `curl -G --data-urlencode`.
- **`projectId`:** 2 to 63 characters: lowercase letters, digits and `-`, starting with a letter or digit. For example, `demo-app`.
- **Snapshots are complete:** Each snapshot describes the whole project when a PR was merged, not only the changes from that PR. `pull_request` is the PR that produced it, and `content` is the state as Markdown.

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
2. Build the new snapshot: fill the fields as described in [`schemas/README.md`](schemas/README.md#where-the-script-gets-each-value), and put the Markdown in `content`. Use `"event_id": "gh-run-<github.run_id>"`. It stays the same when the run is re-run, so a repeated submission is not stored twice.
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

Besides the JSON Schema, the server checks that `project_id` in the body equals `{projectId}` in the URL. It does not check the structure of `content`.

#### Responses

| Status | Meaning | Body |
| --- | --- | --- |
| `201` | Stored. It is now the current state. | `{ "ok": true, "state_id": "gh-run-1002" }` |
| `200` | A snapshot with this `event_id` was already stored. Nothing changed. | `{ "ok": true, "duplicate": true, "state_id": "gh-run-1002" }` |
| `400` | The body is not valid JSON. | `{ "error": "invalid_json" }` |
| `400` | The snapshot breaks the schema, or `project_id` does not match the URL. | `{ "error": "invalid_project_state", "details": [ ... ] }` |
| `401` | The token is missing or wrong. | `{ "error": "unauthorized" }` |
| `409` | `base_state_id` is not the project's current state. Not stored. | `{ "error": "stale_base_state", "current_state_id": "gh-run-1003" }` |
| `413` | The body is larger than 800 KB. | `{ "error": "payload_too_large" }` |

`details` lists every schema problem found. `project_id` is compared with the URL only after the schema passes.

```json
{
  "error": "invalid_project_state",
  "details": [
    "/pull_request must have required property 'merged_at'",
    "/content must NOT have fewer than 1 characters"
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

The full snapshot, in the same format as the POST body. See [`schemas/examples/gh-run-1003.json`](schemas/examples/gh-run-1003.json).

| Status | Body |
| --- | --- |
| `404` | `{ "error": "project_not_found" }`: the project has no snapshot yet. |

### `GET /api/projects/{projectId}/states`

Lists the project's snapshots, oldest first. Each item has only the merged PR, not `content`. To read one in full, call `GET /api/projects/{projectId}/states/{eventId}`.

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
      "pull_request": {
        "number": 41,
        "title": "Add Markdown preview",
        "url": "https://github.com/example-org/demo-app/pull/41",
        "merged_at": "2026-11-15T02:30:12Z"
      }
    },
    {
      "event_id": "gh-run-1003",
      "updated_at": "2026-11-17T18:00:00+08:00",
      "source_commit_sha": "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
      "pull_request": {
        "number": 42,
        "title": "Save report versions",
        "url": "https://github.com/example-org/demo-app/pull/42",
        "merged_at": "2026-11-17T09:55:03Z"
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
| `snapshots[].pull_request` | The merged PR that produced the snapshot. |
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

### Reports and slides

A saved file is either a `report.md` (`"type": "report"`) or a `slides.md` (`"type": "slides"`). Both kinds are stored together and share these endpoints.

Only the latest content is kept. Each save overwrites the previous content, and earlier content cannot be read back. If two tabs save the same file, the last save wins.

### `POST /api/projects/{projectId}/reports`

Saves a new file and returns its `id`. Use this the first time a file is saved, and `PUT` with the `id` after that.

Request body, at most 800 KB:

```json
{
  "name": "Week 12 progress report",
  "type": "report",
  "content": "# Progress\n\n..."
}
```

| Field | Rule |
| --- | --- |
| `name` | 1 to 200 characters. Names do not need to be unique. |
| `type` | `report` or `slides`. It cannot change after the file is created. |
| `content` | The Markdown text. It may be empty. |

Responses:

| Status | Body |
| --- | --- |
| `201` | `{ "id": "8ZPWLqiGyWY6fm0jQImO", "name": "Week 12 progress report", "type": "report", "updated_at": "2026-11-23T14:53:59.446Z" }` |
| `400` | `{ "error": "invalid_json" }` |
| `400` | `{ "error": "invalid_report", "details": [ ... ] }`: a field is missing or breaks a rule above, or there is an extra field. |
| `404` | `{ "error": "project_not_found" }` |
| `413` | `{ "error": "payload_too_large" }` |

### `GET /api/projects/{projectId}/reports`

Lists the project's saved files, most recently updated first. Each item has no `content`. To read the content, call `GET /api/projects/{projectId}/reports/{reportId}`.

Response `200`:

```json
{
  "reports": [
    {
      "id": "8ZPWLqiGyWY6fm0jQImO",
      "name": "Week 12 slides",
      "type": "slides",
      "updated_at": "2026-11-23T14:56:39.447Z"
    },
    {
      "id": "FVcPYaDRxstqWjVHAlPS",
      "name": "Week 12 progress report",
      "type": "report",
      "updated_at": "2026-11-23T14:42:07.525Z"
    }
  ]
}
```

| Status | Body |
| --- | --- |
| `404` | `{ "error": "project_not_found" }` |

### `GET /api/projects/{projectId}/reports/{reportId}`

Returns one file with its content.

Response `200`:

```json
{
  "id": "8ZPWLqiGyWY6fm0jQImO",
  "name": "Week 12 slides",
  "type": "slides",
  "content": "# Progress\n\n...",
  "created_at": "2026-11-23T14:53:59.446Z",
  "updated_at": "2026-11-23T14:56:39.447Z"
}
```

| Status | Body |
| --- | --- |
| `404` | `{ "error": "report_not_found" }` |

### `PUT /api/projects/{projectId}/reports/{reportId}`

Overwrites the name and content of a saved file. The body is the same as for `POST`, and `type` must equal the type the file was created with.

| Status | Body |
| --- | --- |
| `200` | `{ "id": "8ZPWLqiGyWY6fm0jQImO", "name": "Week 12 slides", "type": "slides", "updated_at": "2026-11-23T14:56:39.447Z" }` |
| `400` | `{ "error": "invalid_json" }` |
| `400` | `{ "error": "invalid_report", "details": [ ... ] }` |
| `400` | `{ "error": "type_mismatch", "type": "slides" }`: the file was created with another type, shown in `type`. Nothing changed. |
| `404` | `{ "error": "report_not_found" }` |
| `413` | `{ "error": "payload_too_large" }` |

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
| Show a project's current state | `GET /api/projects/{projectId}/state`, then render `content` as Markdown |
| List what was merged in a reporting period | `GET /api/projects/{projectId}/states?from=...&to=...`, then read each `pull_request` |
| Open one snapshot from the list | `GET /api/projects/{projectId}/states/{eventId}` |
| Save a `report.md` or `slides.md` for the first time | `POST /api/projects/{projectId}/reports`, then keep the returned `id` |
| Save it again | `PUT /api/projects/{projectId}/reports/{reportId}` |
| List saved files by name | `GET /api/projects/{projectId}/reports` |
| Open a saved file | `GET /api/projects/{projectId}/reports/{reportId}` |

```ts
const params = new URLSearchParams({
  from: "2026-11-14T00:00:00+08:00",
  to: "2026-11-18T00:00:00+08:00",
});
const res = await fetch(`/api/projects/${projectId}/states?${params}`);
const { snapshots, truncated } = await res.json();
```

```ts
// First save: create the file and keep its id.
const created = await fetch(`/api/projects/${projectId}/reports`, {
  method: "POST",
  body: JSON.stringify({ name, type: "slides", content }),
});
const { id } = await created.json();

// Later saves: overwrite the same file.
await fetch(`/api/projects/${projectId}/reports/${id}`, {
  method: "PUT",
  body: JSON.stringify({ name, type: "slides", content }),
});
```
