# Project State Schema

The Intent Supervisor submits one Project State snapshot to the Slide Generator every time a PR is merged into the default branch. This page explains every field in [`project_state.schema.json`](project_state.schema.json). See [`examples/`](examples/) for three consecutive snapshots of a made-up project.

## Top level

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
| `generator` | No | Tool `name`, `version` and optional `model` that produced the snapshot. | Tracing when the data looks wrong. |
| `milestones` | Yes | All milestones, up to 50. | See [Milestones](#milestones). |
| `features` | Yes | All features, including finished ones, up to 100. | See [Features](#features). |
| `trigger` | Yes | The PR merge that produced this snapshot. | See [Trigger](#trigger). |
| `risks` | Yes | All current risks, up to 50. | See [Risks](#risks). |
| `source_refs` | Yes | Every source cited anywhere in the snapshot, up to 300. | See [Source refs](#source-refs). |
| `data_gaps` | Yes | Sections that were not assessed; `[]` if none. | See [Data gaps](#data-gaps). |

`milestones`, `features`, `risks` and `source_refs` always describe the **whole project as it is now**, not only what changed. `trigger` describes **what just happened**.

## Milestones

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `id` | Yes | e.g. `milestone-mvp`. Keep the same ID in every snapshot. | Referenced by `features[].milestone_id`. |
| `name` | Yes | Milestone name. | Shown on slides and in reports. |
| `status` | Yes | `planned`, `in_progress`, `done`, `blocked` or `unknown`. `done` requires at least one cited PR. | Reports separate finished, ongoing, planned and unconfirmed work. |
| `target_date` | No | `YYYY-MM-DD`, **only if a source states it**. | Reports must not invent dates, so leave it out rather than guess. |
| `summary` | No | Short description. | Material for the script. |
| `source_ref_ids` | Yes | 1 to 20 IDs from `source_refs`. | Every slide can link to its sources. |

## Features

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `id` | Yes | e.g. `feature-report-editor`. Keep the same ID in every snapshot. | Referenced by `trigger.feature_ids`. |
| `name` | Yes | Feature name. | Shown on slides. |
| `status` | Yes | Same values as milestones. `done` requires at least one cited PR; an issue or document alone is not enough. | Unmerged work never counts as finished. |
| `summary` | Yes | What is done and what is left. | Main material for the "feature progress" slides. |
| `milestone_id` | No | ID of a milestone in this snapshot. | Lets reports group features by milestone. |
| `source_ref_ids` | Yes | 1 to 20 IDs from `source_refs`. Cite the most relevant ones, not every PR the feature ever had. | Links to sources, and evidence for `done`. |

## Trigger

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `source_ref_id` | Yes | ID of the merged PR, which must be a `pull_request` entry in `source_refs`. | Identifies the merge that produced this snapshot. |
| `summary` | Yes | What the merged code changed, not what the workflow did. | Main material for "progress this period": the Slide Generator collects the `trigger` of every snapshot in the reporting period. |
| `feature_ids` | No | IDs of features this PR moved forward. | Lets reports describe the change under the right feature. |

## Risks

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `id` | Yes | e.g. `risk-export-env`. Keep the same ID in every snapshot. | Identifies the risk across snapshots. |
| `kind` | Yes | `risk`, `blocker` (blocks progress) or `design_drift` (deviates from the design). | Reports can place each kind on a different slide. |
| `title` | Yes | One-line title. | The bullet point on a slide. |
| `description` | Yes | Details. | Material for the script. |
| `impact` | No | What it affects and how. | Managers care about this most. |
| `severity` | Yes | `low`, `medium`, `high` or `unknown`. | Ordering, and deciding what goes on slides. |
| `source_ref_ids` | Yes | 1 to 20 IDs from `source_refs`. | Links to sources. |

## Source refs

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `id` | Yes | e.g. `pr-42`, `issue-7`, `doc-roadmap`. | Referenced by every `source_ref_ids` and by `trigger.source_ref_id`. |
| `type` | Yes | `pull_request` (merged PRs only, never open ones), `issue` or `document`. | Decides which other fields are required. |
| `url` | Yes | `https://` link. | The "sources" links in reports. |
| `title` | No | Title. | Link text. |
| `number` | PR, issue | PR or issue number. | Shown as "PR #42". |
| `status` | Issue only | `open` or `closed`. PRs have no status because they are always merged. | Shows whether an issue is still open. |
| `path` | Document only | Path in the repository, e.g. `ROADMAP.md`. | Identifies the document. |

List only sources that are cited somewhere in the snapshot.

## Data gaps

| Field | Required | What to fill in | Purpose |
| --- | --- | --- | --- |
| `section` | Yes | `milestones`, `features` or `risks`. | Tells the AI that a section is unassessed, not empty. An empty `risks` array without a data gap means "assessed, no risks found". |
| `reason` | Yes | Why the section was not assessed. | Reports can state the gap, e.g. "risks were not assessed this time". |
