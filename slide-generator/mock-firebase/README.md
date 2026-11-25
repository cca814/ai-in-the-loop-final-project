# Local Mock storage

File-backed test data for the report workspace; **not Firebase or its emulator**. No cloud credentials are needed.

[Setup](../README.md) · [Tests](../TESTING.md)

## Use

1. Start the existing app and open `/reports`.
2. **建立 Mock 範例資料**, then load Project ID **`demo-app`**: expect 3 States.
3. For other data, import one official-schema JSON in the website or use the directory importer below.
4. Generate/manual-edit a report and download it. Website draft save/load controls are disabled.

States persist in ignored `mock-firebase/.local-data/database.json`. Reports/slides in the page do not. `MOCK_FIREBASE_DIR` selects a different storage root.

## Importing producer data

From `slide-generator` (replace paths with real local files):

```sh
node mock-firebase/import-states.mjs /path/to/states --merges /path/to/merges.json
```

`--merges` is optional. Import validates the schema, project identity and predecessor chain without changing State content. Reimporting the same snapshots preserves drafts.

Merge inventory:

```json
{
  "repository": "owner/repo",
  "entries": [
    {"source_commit_sha": "40-character SHA", "pr": 1, "merged_at": "ISO timestamp"}
  ]
}
```

Metadata must match every State. It enables inclusive report ranges up to 100 merges; collection timestamps are not merge dates. Imported test States simulate a producer handoff, not official producer output.

## Local HTTP contract

| Request | Result |
| --- | --- |
| GET `/api/reports/storage?projectId=<id>` | `{mode,projectId,states,datasets}`: all matching full States plus local UI metadata |
| GET `/api/reports/storage` | Dataset list |
| GET with `datasetId,snapshotId` | Retained draft or null |
| POST `{action:"seed"}` | Create bundled examples |
| POST `{action:"dataset",dataset}` | Validate/register States |
| POST `{action:"save",datasetId,snapshotId,draft,expectedRevision}` | Retained draft-storage API |

Project queries deduplicate event IDs and sort by collection time. Missing project: 404; malformed ID: 400; conflicting event contents: 409. Queries never mutate States. Repository Snapshots are excluded.

Report APIs reload accepted input by Mock ID. Repo reading, when enabled, stays at its commit. The local contract does not define the separate [Firebase API](../API.md).

## Storage and tests

Writes use a lock/atomic rename. Draft revisions reject stale writes with 409. Corrupt data is not silently reset. Remove a stale lock only after confirming no writer is running.

`node --test` here covers storage and project isolation. Browser checks clean their own temporary datasets. After forced termination, run `node mock-firebase/cleanup-browser-tests.mjs` from `slide-generator`; it preserves other projects.

The endpoint accepts local development only and rejects production/cross-origin requests. Real Firebase connectivity and deployment are outside this module.
