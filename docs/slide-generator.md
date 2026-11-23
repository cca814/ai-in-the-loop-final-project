# Slide Generator

## 1. Purpose and Design Status

The Slide Generator turns a project's current state into a progress report that a person can review, edit and present. It reads Project State snapshots submitted by the Intent Supervisor, helps the user write `report.md` with an LLM, and converts a confirmed report into a Slidev presentation.

The architecture was recorded in the [Decisions Log](../DECISIONS.md) on 2026-11-11, and the Project State schema on 2026-11-18. This document records what has been implemented so far and what remains to be designed. 

## 2. Goals and Scope

The full workflow should let a user:

- Select a project and view its latest Project State.
- Ask the LLM to generate a report with slide content and a script for each slide.
- Edit the report by hand or ask the LLM to revise it.
- Save `report.md` and `slides.md` by name and open them again later.
- Confirm a version and generate a presentation from it.
- Download `report.md` and the presentation files.

Editing a report never changes the Project State. The Project State is updated only by the Intent Supervisor.

## 3. Project State Interface

### 3.1 Schema

The format is defined in [`schemas/project_state.schema.json`](../slide-generator/schemas/project_state.schema.json) and explained field by field in [`schemas/README.md`](../slide-generator/schemas/README.md). Three chained examples are in [`schemas/examples/`](../slide-generator/schemas/examples/).

Key decisions:

- **Complete snapshots.** Each merged PR produces one snapshot containing the full state of the project, not only the changes from that PR.
- **`trigger` instead of a list of recent changes.** Each snapshot records the merged PR that produced it. To describe what changed in a period, the Slide Generator lists the triggers of all snapshots in that period.
- **Merged PRs only.** Open PRs are not listed, and a feature or milestone can be `done` only if it cites a merged PR.
- **Missing data is explicit.** `data_gaps` marks sections that were not assessed. An empty `risks` array without a data gap means that no risks were found.

### 3.2 Submission Rules

| Rule | Behavior |
| --- | --- |
| Authentication | `Authorization: Bearer <INGEST_TOKEN>`; otherwise `401` |
| Size limit | 800 KB; otherwise `413` |
| Validation | JSON Schema with ajv, then five rules that the schema cannot express; otherwise `400` with every problem listed |
| Idempotency | `event_id` (`gh-run-<github.run_id>`) is the document ID; a repeated `event_id` returns `200` without writing |
| Ordering | `base_state_id` must equal the project's current state; otherwise `409` |
| Atomicity | The duplicate check, the base check and the write run in one Firestore transaction |

The five rules are in [`lib/project-state.ts`](../slide-generator/lib/project-state.ts):

1. `project_id` in the body equals `{projectId}` in the URL.
2. Ids are unique within each array.
3. Every referenced id exists in the snapshot.
4. A `done` feature or milestone cites a pull request.
5. The trigger is a pull request.

### 3.3 API

The full input and output of each endpoint are in [`slide-generator/API.md`](../slide-generator/API.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/{projectId}/states` | Store a snapshot from GitHub Actions |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/{projectId}/state` | Get the current snapshot |
| `GET` | `/api/projects/{projectId}/states` | List snapshot triggers, optionally within `from` and `to` |
| `GET` | `/api/projects/{projectId}/states/{eventId}` | Get one snapshot |
| `GET` | `/api/health` | Check the Firestore connection |

## 4. Report Editing

### 4.1 Saved Files

The user names a `report.md` or `slides.md` in the web page and saves it. Both kinds are stored in `projects/{projectId}/reports/{reportId}`:

| Field | Meaning |
| --- | --- |
| `name` | The name entered by the user |
| `type` | `report` or `slides` |
| `content` | The Markdown text |
| `created_at`, `updated_at` | Set by the server |

Key decisions:

- **The server assigns the id.** The first save creates the file and returns a Firestore auto ID. Later saves of the same file use that id.
- **Only the latest content is kept.** Each save overwrites the file. Earlier content cannot be read back, and if two tabs save the same file, the last save wins.
- **The type is fixed.** A save whose `type` differs from the stored one is rejected, so a `slides.md` cannot overwrite a `report.md`.
- **Files are not tied to a snapshot.** A report can cover several Project State snapshots, so the file does not record which ones it was written from.
- **The list has no content.** The list returns names only, and the content is read when one file is opened.

### 4.2 API

The full input and output are in [`slide-generator/API.md`](../slide-generator/API.md#reports-and-slides).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/{projectId}/reports` | Save a new file and get its id |
| `GET` | `/api/projects/{projectId}/reports` | List saved files by name |
| `GET` | `/api/projects/{projectId}/reports/{reportId}` | Open one file |
| `PUT` | `/api/projects/{projectId}/reports/{reportId}` | Overwrite a saved file |

These endpoints have no authentication, so anyone who knows the URL can read or overwrite a saved file.

## 5. LLM Report Generation and Revision

TBD

## 6. Slidev Presentation Generation

TBD
