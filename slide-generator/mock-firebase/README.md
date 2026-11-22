# Local Mock Firebase

This is a file-backed application adapter, **not Firebase, Firestore, or the Firebase Emulator Suite**. It tests the report workspace's data flow without cloud credentials, Java, or a Firebase account. It does not implement Firestore SDK methods, security rules, cloud transactions, or authentication. Existing `lib/firebase-admin.ts` and `/api/health` are unchanged and still require real Firebase configuration.

Run the existing Next.js application from `slide-generator`:

```powershell
npm.cmd run dev
```

Open `http://localhost:3000/reports`:

1. Enter the State's **Project ID**, then click **載入專案 States**. This fetches all stored States belonging to that project. The browser remembers up to 10 successfully loaded IDs, most recent first, without duplicates. Use **最近載入的 Project ID** to fill the input, then click the load button. This list survives refresh in the same browser; failed loads are not remembered. Only IDs are stored locally, not States or reports; browser storage restrictions do not block loading. To create demo data first, open **Mock 測試資料管理** and click **建立 Mock 範例資料**, then load project `demo-app`. Repeating setup does not erase drafts.
2. The latest stored version is selected automatically. Open **歷史版本／報告區間** only when you need an older State. Generate a report with the existing configured LLM, or paste Markdown to test editing without an API call.
3. Manually edit using Edit/Preview/Split. Conversation editing is currently disabled in the website to keep the walking skeleton focused; revision modules/API/CLI and review components remain in source.
4. Edit the report manually and download Markdown to keep it. Draft save/load and conversation editing are currently disabled in the website; the storage implementation and existing saved data remain available internally.
5. Refresh clears the current report. **載入 Mock 資料** reloads State datasets only; it does not restore a report draft.

You can also import an official Project State JSON with the file input. The backend validates it against the unchanged official schema and checks source relationships. Repository Snapshots remain a separate input type. Mock States with a matching GitHub repository URL/name and full commit SHA support the existing **允許按需讀取此版本 repo** option during generation and revision. The backend reloads the accepted State from Mock before selecting files, verifies the public repo and commit through read-only GitHub GETs, and reads that commit's files; it never silently substitutes today's `main`. Unchecking skips the extra repository reads. Declared support does not guarantee availability: private/deleted repos, rate limits and unavailable commits can still fail. Existing stored datasets acquire this capability when loaded, without changing dataset IDs or drafts. Historical merge aggregation remains a separate integration.

## Project-ID query under test

The agreed behavior is **project ID → all Project States for that project**. The local mock endpoint is `GET /api/reports/storage?projectId=<id>` and returns `{ mode: "mock", projectId, states, datasets }`. `states` contains unchanged official State objects, deduplicated by `event_id` and sorted by `updated_at`, then event ID. Collection timestamps are not merge timestamps. Only exact project matches are returned; Repository Snapshots are excluded. A missing project returns 404, malformed IDs return 400 and conflicting contents for one event ID return 409. No State, draft, GitHub data or model output is created by this query.

`datasets` is extra local workspace metadata for existing snapshot controls, accepted merge dates and server-side State resolution. It is **not** a requirement for the teammate's Firebase API. The actual endpoint, response wrapper, ordering and authentication remain to be coordinated. Replace the adapter when that API is available; do not require the producer to adopt our mock dataset IDs. The query returns all matching stored versions rather than only the latest; report-range aggregation remains bounded to 100 merges and requires actual merge metadata.

## Importing producer data

To simulate the PR team having already stored a project's States, import a directory of accepted Project State JSON files (from `slide-generator`):

```powershell
node mock-firebase/import-states.mjs <directory-containing-state-json-files>
```

This offline setup validates all files before writing, orders snapshots by `base_state_id`, and rejects mixed projects, duplicate commits or broken/branched chains. It preserves the original State content and generator metadata. Reimporting the same snapshots preserves existing drafts. The web UI then reads these States from Mock storage through **載入 Mock 資料**, instead of fetching them from GitHub or calling a model to create them. This simulates the producer's data handoff; it does not implement the PR team's analysis.

Imported historical test snapshots simulate a producer handoff; they are not actual PR-team output. Keep source fixtures and the Mock database in ignored local directories. They are not imported by application code or bundled for deployment. Use **載入 Mock 資料** for imported States; **建立 Mock 範例資料** creates the separate schema demo dataset. Select a snapshot to generate and manually edit a report, then download Markdown. Draft save/load and conversation editing remain disabled in the website.

For inclusive report ranges, import the separately collected merge metadata too:

```powershell
node mock-firebase/import-states.mjs <directory-containing-state-json-files> --merges <merge-inventory.json>
```

The inventory shape is `{ "repository": "owner/repo", "entries": [{ "source_commit_sha": "40-character SHA", "pr": 1, "merged_at": "ISO timestamp" }] }`. It must match every State's repository, commit, PR number and predecessor chain; merges must be chronological. Metadata is stored beside the States, not added to the official schema. `updated_at` is never substituted for a missing merge time. Reimporting metadata preserves IDs and existing drafts when the snapshots are unchanged. Reimporting those States alone does not erase accepted merge metadata.

Open **歷史版本／報告區間**, choose the end snapshot, enable **彙整合併區間**, and choose the inclusive start. Both generation and revision reload the selected summaries, actual merge times and PR sources from Mock on the server, up to 100 merges. Without the checkbox, only the selected State's trigger is supplied. History does not depend on enabling repo reads; file excerpts, if requested, still belong to the end version only. Unrecorded design rationale is not invented. Saved drafts include the selected range and restore it on load. Datasets without merge metadata still support version selection but cannot enable range aggregation.

The following storage contract is retained internally; its save/load buttons are disabled in the current website. Storage is explicit, not automatic. Unsaved changes, undo/redo stacks, unaccepted revision proposals, generated slides and playback URLs are not persisted. Every snapshot has an independent draft. Saving does not change its Project State. Load an existing draft's revision before updating it. Concurrent updates with a stale revision receive a 409 conflict instead of silently overwriting.

Data lives in `mock-firebase/.local-data/database.json`, ignored by Git, and survives a server restart. `MOCK_FIREBASE_DIR` optionally selects a different local data directory for tests; no API keys belong in these files. Invalid/corrupted data is not reset automatically. Writes use a lock and atomic rename. A process killed during a write may leave `database.json.lock`; after confirming that no storage writer is running, remove only that stale lock in your editor. This simple adapter is for local single-server testing, not deployment.

The mock endpoint rejects production mode, external hostnames and cross-origin browser calls. It is not an authenticated cloud endpoint. There is no need to configure Firebase environment variables for `/reports` or the mock routes. Report generation/revision still needs your existing LLM configuration; saving/loading does not call an LLM.

Application contract for the future Firebase adapter:

| Method | Meaning |
| --- | --- |
| `listDatasets()` | List projects and their accepted snapshots |
| `putDataset(dataset)` | Validate and register snapshots; content determines dataset ID |
| `getState(datasetId, snapshotId)` | Read accepted input; report APIs reload it on the server |
| `getHistory(datasetId, snapshotId, range)` | Validate inclusive endpoints and read accepted merge summaries, times and sources |
| `getDraft(datasetId, snapshotId)` | Return draft with revision, or null |
| `saveDraft(datasetId, snapshotId, draft, expectedRevision)` | Save Markdown, conversation and requirements together; reject stale revision |

`GET /api/reports/storage` lists datasets; add `datasetId` and `snapshotId` query parameters to read a draft. POST actions are `seed`, `dataset`, and `save`. The JSON response contains `datasets`, `dataset`, or `draft`; errors contain `code` and `error`. This provisional report-workspace interface is isolated here for discussion with the teammate implementing Firebase. It does not define or replace the Intent Supervisor ingestion API.

From `slide-generator`, without paid LLM calls:

```powershell
node --test mock-firebase/store.test.js
node report-agent/verify.mjs
# With the existing Next dev server running:
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/slide-export/node_modules/.playwright-browsers"
node mock-firebase/browser-check.mjs
node mock-firebase/history-browser-check.mjs
```

Browser checks write a uniquely named mock test dataset using the real Next storage endpoint and disk, while intercepting only model responses. They verify State loading, selected report ranges, manual edits, hidden draft controls and report clearing on refresh. The previous storage UI checks remain archived behind the disabled controls. Each check removes its own dataset and drafts in `finally`, including ordinary test failures. After a forcibly terminated process, run `node mock-firebase/cleanup-browser-tests.mjs` from `slide-generator` to remove leftovers. Cleanup requires both the exact test label pattern and matching snapshot IDs; other datasets and drafts remain unchanged. This maintenance function is not exposed as an HTTP API. Unit tests cover persistence, revision conflicts, adapter restart, corrupted files, write contention, schema rejection and server-side State reloading using temporary directories. Real Firebase connectivity and access rules require separate integration tests later.
