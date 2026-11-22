# Report Agent

See the [2026-11-22 optimization and verification record](../app/reports/OPTIMIZATIONS.md) for current safeguards, limits and outstanding work.

Generate a reviewable Markdown report from one Project State snapshot, optionally with verified merge-history and repository context. Start with the [local workspace setup and acceptance guide](../app/reports/README.md) for the complete website workflow. Requires Node.js 20 or newer. The project state is expected to conform to PR #11's schema; ingestion should validate it against the official schema before calling this module. This module checks source relationships and HTTPS links, but does not implement complete JSON Schema validation.

For Gemini, select a model available to your Google AI Studio project that supports `generateContent` and JSON output, then set these environment variables in PowerShell and run from this directory:

```powershell
$env:LLM_PROVIDER = 'gemini'
$env:GEMINI_API_KEY = '<your Gemini API key>'
$env:GEMINI_MODEL = '<Gemini model ID>'
node cli.js ../schemas/examples/normal.json report.md
```

For persistent local settings, create `slide-generator/.env.local` in an editor (or add the following names if it already exists):

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=your-gemini-model-id
```

Replace the placeholders locally. Never share or commit this file. From the `report-agent` directory, load it using Node's `--env-file` option (Node.js 20.6 or newer):

```powershell
node --env-file=../.env.local cli.js ../schemas/examples/normal.json report.md
```

The parent `slide-generator/.gitignore` ignores `.env.local`. Already-set environment variables take precedence over values in the file, so an existing `LLM_PROVIDER`, `GEMINI_API_KEY`, or `GEMINI_MODEL` in the terminal can override it. This flag is for the standalone CLI; server integration should use the hosting application's own environment configuration.

Free-tier availability and limits vary by model and project; check [Google's pricing](https://ai.google.dev/gemini-api/docs/pricing) and your account before use. Google states that free-tier content may be used to improve its products; review its terms before sending project data. The key is sent in a request header to the Gemini Developer API.

For Groq, select a model supporting JSON mode that is available in your Groq account:

```powershell
$env:LLM_PROVIDER = 'groq'
$env:GROQ_API_KEY = '<your Groq API key>'
$env:GROQ_MODEL = '<Groq model ID>'
node cli.js ../schemas/examples/normal.json report.md
```

The output file must not already exist. Do not commit keys, real snapshots, or generated reports containing confidential data. The snapshot is sent to the LLM provider; ensure the provider is appropriate for the project's data.

To use OpenAI instead, set `LLM_PROVIDER` to `openai`, and set `OPENAI_API_KEY` and `OPENAI_MODEL`. OpenAI remains the default when `LLM_PROVIDER` is unset. Keys are provider-specific. For server integration, import `generateReport` from `index.js` and `createClient` from `llm.js`; call `await generateReport(state, { complete: createClient() })`. Alternatively inject an async `complete(messages)` returning a JSON string. Keep this call and the key on the server. Core generation/revision functions do not persist data; `http.js` supplies the local API adapter. Firestore persistence remains separate integration work.

Run `node --test` for offline tests. The tests read the three examples in `../schemas/examples/`. No API key or network access is needed.

The provider adapter retries explicit HTTP 500/502/503/504 failures at most twice (three attempts total), waiting one then two seconds by default. It respects `Retry-After` up to ten seconds; longer requested waits end the attempt instead of immediately retrying. HTTP 429, authentication/model errors, network failures, timeouts and malformed successful outputs are not automatically retried. Each attempt has a 45-second timeout. Callers may override `maxRetries`, `timeoutMs` and the injected `sleep` function in `createClient` for testing. Retries use the identical payload and never switch models or providers. A failed revision leaves the current report and conversation unchanged. Repeated upstream failures cannot be resolved by local retries alone.

Web API errors distinguish unavailable providers (`PROVIDER_UNAVAILABLE`), rate limits (`PROVIDER_RATE_LIMIT`), timeouts (`PROVIDER_TIMEOUT`), missing configuration (`MODEL_CONFIGURATION`) and invalid model output (`MODEL_OUTPUT_INVALID`). The browser shows the error code and keeps the draft and unsent request. Error bodies and credentials from the provider are not returned or logged.

Each page contains bullets and speaker notes, with source links added where useful. The LLM is instructed to respect gaps and identify the trigger as a single merge. Links and required page structure are checked, but generated wording and whether each citation supports a claim cannot be proven by these checks. A human must review facts, completeness, data-gap wording and sources before accepting a report. A single snapshot cannot establish all changes in a reporting period. This module does not alter the input snapshot.

Report section titles, ordering and count are chosen from **報告生成需求**, rather than requiring Project Overview / Feature Progress / Recent Changes / Risks and Issues. A focused request may generate just one section. Without a request, the writing brief is a concise engineer-to-supervisor progress update in Traditional Chinese, with sections chosen for the available evidence. It leads with results, current situation and implications, and any evidenced open item; it does not manufacture next steps to fill a template. A request may specify another language, audience or structure.

Generation permits multi-paragraph speaker notes; titles and individual bullet strings remain single-line text. If generated report JSON, structure, content fields or source IDs fail validation, the application asks for one corrected full JSON report against the original evidence, naming the failing field and providing the exact allowed source identifiers. It does not invent or automatically accept unknown citations. Direct callers can set `maxCorrectionRetries: 0`; by default the maximum is one additional model call, separate from provider HTTP retries. No report is returned or applied until the whole result passes. Failures distinguish `GENERATION_JSON_INVALID`, `GENERATION_STRUCTURE_INVALID`, `GENERATION_CONTENT_INVALID` and `GENERATION_SOURCE_INVALID`, with the section number/field where applicable. Rejected report text is not logged or exposed in errors. Provider-level incomplete, empty or malformed responses are identified separately as `PROVIDER_RESPONSE_INCOMPLETE`, `PROVIDER_RESPONSE_EMPTY` and `PROVIDER_RESPONSE_INVALID`; the correction loop does not resend those provider errors.

Narrative should explain work outcomes using human-readable feature names, avoiding branch names such as `main`, commit hashes, feature IDs, raw status enums and schema terminology unless explicitly requested. “Implementation completed” is distinct from released, deployed or tested successfully. Dates and per-PR details belong in the narrative only when useful for the requested report; source links remain available for traceability. Repository-assisted generation and chat revisions share the same audience guidance, while revisions still preserve unrelated text. This is prompt guidance, not a guarantee that every model response has the desired tone.

The internal JSON stays `{pages:[{title,bullets,script,source_ids}]}` and each section requires speaker notes; `source_ids` may be omitted or empty, and Sources is included only where useful so existing editing and Slidev conversion continue to work. Validation accepts any nonempty set of evidence-based sections and rejects an empty report. For CLI generation, an optional third argument supplies the same request, for example:

```powershell
node --env-file=../.env.local cli.js ../schemas/examples/normal.json report-manager.md "用繁體中文向主管報告近期成果與待確認事項，分成兩節，避免程式碼細節。"
```

## Report revision

Use `reviseReport` from `revision.js` on the server:

```js
const { report: revised, message } = await reviseReport(
  { state, report: currentMarkdown, request: userRequest, history },
  { complete: createClient() }
);
```

Pass the latest Markdown, including any manual edits, on every turn. `history` is an optional array of `{ role: 'user' | 'assistant', content: '...' }` entries, oldest first; pass the relevant earlier requests and assistant replies. The caller owns draft and history persistence and must preserve the appropriate state snapshot. The function returns revised Markdown and an explanatory message, without mutating the state. It validates exact, unique, non-overlapping replacement ranges, so text outside those ranges remains unchanged. The LLM may nevertheless change an overly broad range or introduce unsupported claims; review the diff and factual evidence before accepting it. If the requested change cannot be supported, it may return the original report with an explanation.

For a standalone single turn, run from this directory:

```powershell
node --env-file=../.env.local revise-cli.js ../schemas/examples/normal.json report.md report-revised.md "Shorten the speaker notes on Project Overview"
```

For the next turn, use the latest output as the input report and a new output filename. Optionally provide a final argument containing a JSON history array. The CLI does not store history or overwrite files. API requests send the state, current report, request and history to the selected provider.

## Local Next.js workspace

Start the existing Next.js app and open `/reports`. Enter a public GitHub root URL to load its current code snapshot, or run the [historical reconstruction tool](../state-replay/README.md) and load its accepted States. No repository-specific dataset is bundled into the page. The workspace supports report generation, manual editing, multi-turn revision, synchronized Markdown previews and before/after review, undo/redo, and Slidev web/PPTX/portable exports. Drafts and conversation are page memory only. The [workspace guide](../app/reports/README.md) covers installation and acceptance; [PR handoff](../app/reports/PR-HANDOFF.md) records coordination requirements.

`POST /api/reports/generate` accepts `{state,focus?,useRepository?,replayId?,mergeRange?}`. `POST /api/reports/revise` accepts `{state,report,request,history,useRepository?,replayId?,mergeRange?}`. A local replay ID causes the server to reload its validated State; the supplied event ID/commit must identify an accepted version. `mergeRange:{startCommit,endCommit}` is inclusive, at most 100 accepted merges, ending at the selected State. Only selected dated triggers become separate merge evidence; code comes from the end commit. Current State statuses are not replaced by older ones. Client-injected `repository_context`/`merge_history` are rejected.

The current-code-only importer returns a distinct Repo Snapshot, not an official State. The history importer reads local reconstruction results without starting an LLM job. All report and presentation routes remain local-development-only until authentication, persistence and hosting are coordinated. Firebase access and complete production-build configuration belong to the infrastructure owner. This workspace does not use Firebase yet.

## Optional repository evidence

Enable repository reading to let the model choose up to four ranges from the selected commit's eligible text-file inventory. The backend downloads and verifies only selected blobs, supplies at most 180 lines per range / 24,000 characters total, and returns a safe read trace without full file bodies. Only fixed GitHub GET endpoints are used; the model cannot open arbitrary links, run code or change commits. File text is untrusted evidence. A source or test definition is not proof of factual claims or passing tests.

An uncached enabled operation normally adds one selection call even if no files are needed. Invalid selection formats/paths/ranges can receive one bounded correction; provider and integrity failures are not repaired as JSON errors. The writer uses `{pages:[{title,bullets,script,source_ids?}]}` and the revision agent uses exact `{changes:[{old,new}],message}`. Unknown source IDs/URLs fail. Excerpts never mutate State. Direct report/revision CLIs remain State-only unless a caller injects context.

Every headed report page requires a nonempty speaker-notes section; Sources is optional. New/split/merged pages are validated as a whole. One correction uses the ORIGINAL current report, retaining manual edits and unrelated content; persistent failure preserves the draft. Errors expose safe code/stage metadata rather than raw rejected model content. The app does not claim success when no revision was applied.

## Current review, budget and verification controls

State-only revisions now use the same source URL allowlist as context-assisted revisions. Explicit page-count requests are checked after generation/revision, with one bounded correction. Whole-report translation checks no longer miss requests containing a scope phrase such as "only change language". Requests naming only one page are checked against changes to other pages. These are deterministic format/scope checks, not proof of factual accuracy.

`quality.js` produces advisory flags, estimated speaking time and a provenance manifest (State/commit/range/request, available sources and page references). ISO dates absent from supplied evidence, repeated notes, dense content, jargon, risk-gap conflicts and possible simplified Chinese are review prompts, never automatic fact rewrites. The workspace defaults to diff review before applying a revision and supports up to 20 in-memory operation versions with undo/redo. It does not implement Firestore persistence.

`operation.js` bounds report operations to 120 seconds and four model calls; the provider still limits individual HTTP attempts. It combines cancellation signals, limits request body bytes while reading, and limits serialized model context to 220,000 characters. `conversation.js` retains up to 16 recent turns / 24,000 characters and discloses omitted turns. Metadata reports call/attempt counts, elapsed time and available token usage without logging keys or rejected bodies. Non-streaming operation is retained; provider availability and successful cancellation of already processed requests are not guaranteed.

From `slide-generator`, run `node report-agent/verify.mjs` for all offline tests, lint and TypeScript. With the existing development server running, add `--browser` for UI and compiled-route checks or `--render` for actual Slidev/PPTX/ZIP and overflow checks. All model responses are mocked.

## Public repository evidence

The web workspace also accepts a public GitHub root URL. `public-repository.js` supplies anonymous, bounded GET-only metadata/tree/blob loading and `repositoryImportHandler`; `evidence.js` distinguishes repository-only snapshots from official Project State. `reportHandler` rebuilds repository metadata on the server at the pinned SHA and uses the same report-generation/revision JSON and validators. Official `prepareState` and the teammate-owned schema retain their existing contract. Do not send Repo Snapshots to Project State ingestion or claim that their empty assessment arrays mean no risks or completed work.

`retrieveRepositoryContext` loaders may now return an inventory with `{sha,size}` entries and an async `readFile(path)` function instead of eagerly loaded bodies. Only selected files are downloaded; selected excerpts retain exact-commit URLs. Existing eager fixture loaders remain compatible. See `../app/reports/README.md` for the UI workflow, public-only scope, rate/size limits and tests.

## Audience adaptation

Non-technical audience requests explicitly permit replacing jargon or briefly explaining concepts already in the report, in bullets and speaker notes, without changing implementation facts or adding unsupported outcomes. The response message should follow the request's language. For recognized plain-language requests, empty, identical and whitespace-only edits trigger one correction; a persistent no-op returns `REVISION_NO_EFFECT` and preserves the draft. Other legitimate no-op or clarification requests remain supported. This narrow check detects lack of an edit, not whether a rewrite is readable, complete or factually correct; review the proposed changes before accepting.
# Page allocation and directory descriptions

Current website scope: the walking skeleton exposes generation and manual editing only. Conversation/review UI is disabled in `app/reports/workspace.tsx`; revision modules, API, CLI, unit tests and `optimizations-browser-check.mjs` remain for future work. The archived conversation browser check requires re-enabling that UI in code and is deliberately excluded from the default browser verification. `verify.mjs --browser` instead runs `skeleton-browser-check.mjs` to assert no chat entry point or revision request, plus manual editing, cancellation and slides generation. Backend revision tests continue running normally.

`一個資料夾一頁` / `1 page per directory` is a per-directory allocation, not a final one-page total. Explicit requests such as `整份報告改成一頁` still constrain the final page count. Generation and revision receive normalized requirements before the first report-model call; revision also receives the current page count. A failed total-count check reports the expected and actual counts while preserving the draft.

For directory descriptions, enable repo reading. The reader supplies a bounded directory inventory from the selected commit's Git tree, separately from up to four selected file excerpts. Directory names prove existence only; descriptions of purpose need file/State evidence. Nested directories use full paths, root-level files are not directories, and partial inventories are marked incomplete. `repo-tree` is an allowed citation for the inventory. The report workspace shows this inventory in **本次 repo 讀取紀錄** after a successful operation. With reading disabled, the model must explain missing evidence rather than invent conventional folders. These rules and mechanical checks do not prove semantic correctness; review the proposed pages.
