# Slide Generator PR handoff

## Proposed PR scope

Title: **Add report workspace, historical state reconstruction and Slidev exports**

Deliverables: a walking skeleton for State access, report generation, manual editing, Markdown downloads and Slidev exports; Gemini/Groq/OpenAI support; bounded/synchronized Markdown preview; undo/cancel/provenance; pinned public GitHub evidence; local historical State reconstruction/resume/latest; version/range report inputs; Slidev web, editable/image PPTX and portable ZIP; render/overflow checks; tests and documentation. Draft persistence and conversation revision implementations remain available internally, but draft save/load and chat/review are disabled in the current web UI and are not part of its acceptance flow. Existing saved data remains intact. Mock browser checks clean up their own test datasets.

The app no longer imports p-limit data, archive maps or repository-specific adapters. Old downloaded third-party fixtures were moved to ignored local legacy storage. Generated States, indexes, audit evidence, exports, node_modules and credentials must not enter the PR. Generic unit/browser tests and tiny synthetic fixtures should remain in the PR.

## What to tell teammates

> 我這邊目前交付 walking skeleton：讀取 State、生成報告、手動編輯，以及 Slidev 網頁／PPTX／可攜式 ZIP 匯出。草稿儲存／載入及對話修改與審閱的底層功能、API 和測試保留，但已從網頁停用，不列入這次的操作流程。另有公開 repo 的本機歷史重建工具，沿用既有 Schema，保留逐版與最後成功版本並支援續跑；不取代 Intent Supervisor，也尚未接上真正 Firebase。p-limit 測試 States 僅存於忽略的本機目錄。請一起確認正式 State／草稿的授權與儲存介面，以及 Slidev 渲染的部署位置。production 入口目前仍禁用，不應直接解除開關上線。

## Interfaces to coordinate

1. **Intent Supervisor:** unchanged `schemas/project_state.schema.json`; full snapshots, stable feature/milestone IDs, `base_state_id`, trustworthy merged-PR references, `data_gaps`. Historical reconstruction is an explicitly separate bootstrap producer, not a replacement implementation. Merge date is separate from `updated_at` collection time.
2. **State access:** confirmed behavior is project ID in, all States for that project out. The Mock website now tests this through `GET /api/reports/storage?projectId=...`, including project isolation and unknown-ID handling. Its extra `datasets` metadata is local adapter detail, not a required Firebase response. Coordinate the real URL, wrapper, ordering and authorization. `WorkspaceDataset[]` remains the internal UI boundary. Local history uses `replayId` + event ID/commit to reload/validate server data. Formal APIs should similarly resolve authorized State IDs rather than trust arbitrary client JSON.
3. **Drafts/conversation:** teammate-owned storage must save report, State/range provenance, conversation and version. Use expected-version updates to prevent lost writes. Current undo/redo is in-memory only.
4. **Rendering/hosting:** Node/Slidev/Chromium execution, job limits, worker versus web process, access controls, artifact storage and expiry. Temporary local playback and disk checkpoints are not durable Vercel storage. Do not remove production guards without those decisions.

## Review and merge gates

- Review final diff against updated main; no p-limit test-only application references, downloaded historical payloads or secrets.
- Install shared Next dependencies and both independent packages: `npm.cmd ci` in `slide-generator`, `slide-export`, `state-replay`.
- `node report-agent/verify.mjs --render`: offline/core/schema tests, lint/TypeScript, mocked browser/compiled-route checks and real Slidev/PPTX/ZIP/layout checks. Existing Next dev server and local Chromium required.
- Manually reconstruct a few merges with the chosen provider, inspect chain/latest/unknown fields and citations, then load them in the website. Mocked model tests do not establish real model quality or availability.
- Full Next production build needs teammate-provided Firebase configuration. Firebase/auth/persistence/hosting limitations must be explicit in the PR; get agreement on whether this local-module scope is accepted for merge or those integrations must land first.
- No changes to official Schema, Firebase, deployment config or GitHub workflows are included without coordination.

## Verification record (2026-11-22)

- 116 offline tests passed: 69 Report Agent, 29 slide-export, 6 generic replay and 12 Mock storage tests. Project-ID query tests cover all versions, deduplication, cross-project isolation, missing/malformed IDs, conflicts and unchanged saved data. Actual Next GET smoke checks returned all 21 local p-limit States and all 3 schema demo States with unchanged content. Edited Slidev source is tested across web/PPTX/portable/layout paths, including validation before rendering.
- Current walking skeleton browser checks passed: generation/manual editing, disabled conversation and draft controls, Markdown/slides downloads, refresh behavior, public repo import, historical ranges and compiled routes. Lint/TypeScript passed. All LLM calls mocked.
- Full `verify.mjs --render` passed after adding the slide source editor: real Slidev playback displays edited text, both PPTX formats include edited notes, editable PPTX includes edited text, portable ZIP retains the exact edited source, and overflow positive/negative controls pass. Report content remains unchanged. Retained conversation review tests are outside the current web acceptance flow.
- Real anonymous GitHub plan smoke test: 21 p-limit merges across declared main/master scope. Earliest/latest merge inputs, ancestor checks, file inventories and README blob integrity verified. No live LLM analysis was run.
- `npm.cmd run build`: compilation and TypeScript passed; configuration collection failed at existing `/api/health` because `FIREBASE_PROJECT_ID` is missing. Full production build is **not passed**. Runtime-read tracing in our modules was fixed without changing shared Next config. Generated report-route NFT manifests were checked for local-data/legacy/env paths; final hosting still needs its own artifact validation.
- Compared with the locally available origin/main, `slide-generator/test-data/p-limit` has no final file diff: downloaded fixtures are absent from the candidate tree. Fetch freshness and staging/commit are user actions; do not interpret this as an up-to-date remote comparison.

All Git/GitHub mutations remain the user's actions. After the final changes are committed and base freshness is checked, the user can push `feat/report-agent` and create a normal (non-draft) PR. Use the final scope and validation results in its description; creation is not permission to merge. Review, required checks and team agreement determine merge readiness.
## Mock storage follow-up

A local file-backed report-workspace storage adapter and `/api/reports/storage` support accepted Project State, drafts and retained conversations. Accepted merge metadata enables inclusive report ranges; saved drafts restore the selected range. Conversation revision and its full-screen review component remain in source but are disabled in the web walking skeleton. This is development-only, not a Firebase SDK implementation or the Supervisor ingestion endpoint. The teammate-owned Firebase initializer and health route remain unchanged. Please align the storage methods documented in `mock-firebase/README.md` with the real Firebase implementation before deployment; cloud auth/rules and real Firebase integration remain open.
