# Project State Schema

The Intent Supervisor submits one Project State snapshot to the Slide Generator every time a PR is merged into the default branch. This page explains every field in [`project_state.schema.json`](project_state.schema.json). See [`examples/`](examples/) for three consecutive snapshots of a made-up project, from `gh-run-1001.json` to `gh-run-1003.json`.

A snapshot has two parts:

- **Fields that the workflow script fills**, such as the event ID, the previous snapshot and the merged PR. The server checks their format and uses them to detect resubmissions, keep the order and list snapshots.
- **`content`**, the project's state written as Markdown. The server stores it as is and does not check its structure.

## Fields

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `event_id` | Yes | ID of this submission, e.g. `gh-run-<github.run_id>`. Must not contain `/`. | Detects resubmissions: the same `event_id` is stored only once. Also becomes the stored state's ID. |
| `project_id` | Yes | Stable project ID, e.g. `demo-app`. Must equal `{projectId}` in the request URL. | Identifies the project in URLs and in Firestore. The name may change; the ID never does. |
| `project_name` | Yes | Project name. | Shown in the project list and report titles. |
| `repository.full_name` | Yes | GitHub `owner/name`. | Shows which repository the data comes from. |
| `repository.url` | Yes | Repository URL. | Linked from the website. |
| `source_commit_sha` | Yes | The merge commit on the default branch (40-character SHA). | Traces which version of the code a report was based on. |
| `base_state_id` | Yes | `event_id` of the previous snapshot; `null` for the project's first snapshot. | Prevents an old state from overwriting a newer one: the server returns `409` if this is not the current state. |
| `updated_at` | Yes | When the snapshot was built, ISO 8601 with a time zone, e.g. `2026-11-17T14:00:00+08:00`. | Shown as "data as of" on the website and in `report.md`. Used to find the snapshots in a reporting period. |
| `pull_request.number` | Yes | Number of the merged PR. | Shown as "PR #42". |
| `pull_request.title` | Yes | Title of the merged PR. | Shown in the snapshot list. |
| `pull_request.url` | Yes | `https://` link to the PR. | Linked from the website and reports. |
| `pull_request.merged_at` | Yes | When the PR was merged, ISO 8601 with a time zone. | The actual merge time, which can differ from `updated_at`. |
| `generator` | No | Tool `name`, `version` and optional `model` that produced `content`. | Tracing when the data looks wrong. |
| `content` | Yes | The project's state as Markdown, at least one character. | Material for reports. Describe the **whole project as it is now**, not only what the PR changed. |

## Where the script gets each value

For a workflow triggered when a PR is merged (`pull_request` with type `closed` and `github.event.pull_request.merged == true`):

| Field | Source |
| --- | --- |
| `event_id` | `gh-run-${{ github.run_id }}` |
| `project_id`, `project_name` | Fixed in the workflow |
| `repository.full_name` | `${{ github.repository }}` |
| `repository.url` | `${{ github.server_url }}/${{ github.repository }}` |
| `source_commit_sha` | `github.event.pull_request.merge_commit_sha` |
| `base_state_id` | The `event_id` from `GET /api/projects/{projectId}/state`, or `null` if it returns `404` |
| `updated_at` | `date -Iseconds` |
| `pull_request` | `number`, `title`, `html_url` and `merged_at` of `github.event.pull_request` |
| `content` | The Markdown produced by the Intent Supervisor |

Pass the PR title to scripts through an environment variable, not by writing `${{ github.event.pull_request.title }}` inside `run:`. A title can contain shell commands, and GitHub inserts `${{ }}` values into the script before it runs.
