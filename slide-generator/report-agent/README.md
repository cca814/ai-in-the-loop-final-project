# Report Agent

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

From the existing `slide-generator` directory, run `npm.cmd run dev`, then open `http://localhost:3000/reports` (or the URL and port printed by Next.js). Next.js loads the existing `.env.local`; the CLI's `--env-file` flag is not needed. This workspace does not call Firebase. Select either the three schema examples or the 21 [p-limit historical merge snapshots](../test-data/p-limit/README.md) using **選擇專案資料**. Each generation uses one selected end State, optionally with separate verified merge records from a selected range. The workspace generates a report, accepts manual Markdown edits, sends multi-turn revision requests, and downloads the current Markdown. Drafts and conversation are held in page memory and are lost on refresh. Switching projects/snapshots or regenerating a report prompts before discarding the current report. Switching projects/snapshots clears the draft, conversation and slide bundle after confirmation. Keep a downloaded copy as needed.

`POST /api/reports/generate` accepts `{ state }` and returns `{ report }`. `POST /api/reports/revise` accepts `{ state, report, request, history }` and returns `{ report, message }`. Error responses contain `{ error, code, stage, retryable }` for processing failures; input validation responses may contain only `{ error }`. Provider credentials remain on the server. The routes are disabled in production until authentication and usage controls are integrated; they are local development endpoints, not deployment-ready public APIs. Complete schema validation remains the ingestion boundary's responsibility.

The page and routes are in `app/reports/` and `app/api/reports/`; they reuse this module. After reviewing a report, check the confirmation box and generate a Slidev draft. Build a Slidev web presentation (the default), download a portable web ZIP, download the draft, or choose image-based/editable PPTX. Report or transition changes invalidate the draft until it is regenerated. Web presentations are temporary local snapshots served by Next.js, with a playback link valid for about two hours. Local PPTX downloads require the dependencies and Chromium installed under `slide-export` (see its README). Firebase state loading and durable drafts/history are not connected yet. The existing `/api/health` still requires the teammate-owned Firebase configuration for a complete production build.

The report editor offers **編輯** (Markdown source), **檢視** (rendered report), and **雙欄** (source with live preview). Both panels use the same report state as chat revisions, downloads and exports; switching modes does not edit or discard content. On narrow screens, split mode stacks the panels vertically. Preview supports headings, links, lists, GFM tables, task lists and code blocks using `react-markdown` and `remark-gfm`. It does not execute HTML or Vue. This is a report preview, not an exact Slidev layout preview; the slide converter's supported report format still applies. No LLM request is needed to preview Markdown.

## Optional repository evidence (p-limit historical snapshots)

By default the model sees Project State, not the contents behind its source links. On `/reports`, select **p-limit**, choose a historical snapshot, and enable **允許按需讀取此版本 repo**. Optionally enter **報告生成需求（選填）**, for example: “Explain clearQueue implementation and its limitations.” This focus is used on the next generation; chat revisions follow the current **修改要求** instead. Both operations can read repository excerpts when the checkbox is enabled. Changing snapshots clears the draft and last read trace after confirmation. Changing projects also resets the checkbox and generation focus.

`repository-context.js` resolves `repository.full_name` and `source_commit_sha` against the fixed 21-entry archive inventory, with no Git operation or GitHub network request. It never resolves arbitrary local paths, URLs or branches. The archived files remain on the server. A first LLM call receives State, task, limited conversation/report context, and file metadata (names and line counts), then returns JSON selecting up to four ranges. Only those selected, blob-hash-verified excerpts are attached to the existing writer/revision call. Each range is limited to 180 lines and all selected content to 24,000 characters. Invalid paths, sensitive filenames, corrupt files, unknown snapshots and invalid selections fail explicitly rather than silently reading other versions or falling back to State-only output. No `.env.local` is read by the retrieval layer.

`repository-archives.js` explicitly maps each archived filename to a literal asset URL. Keep this map in sync with the fixture inventory when adding versions. Do not replace it with a templated `new URL(...)`: in this Next/Turbopack version, bundling that expression incorrectly resolved later snapshots to the first PR's asset. Unit tests verify map coverage and archive identity. For the compiled-runtime regression check, keep the existing Next.js development server running and execute `node repository-next-check.mjs` from this directory (optionally set `REPORT_TEST_URL` if the server uses a different URL). This compiles routes with GET requests, then exercises the actual compiled generation/revision handlers in an isolated Node process for all 21 versions. Model requests are intercepted with fake replies and fake credentials; no provider requests or `.env.local` reads occur. This check complements the browser test, whose API interception alone cannot detect a bundler asset-resolution error.

The planner may select no files for wording-only or translation requests. **An enabled operation still adds one model selection call even when no file is selected**; the usual successful total is two calls instead of one, plus any existing provider retries. JSON planning works through the existing Gemini/Groq/OpenAI `complete(messages)` adapter; provider-specific tool-calling support is not required. This is a bounded selection step, not unlimited browsing or a live repository connection. Invalid selection JSON, unavailable paths, invalid/oversized line ranges, duplicate ranges or an excessive content budget trigger at most one correction against the same State and task. The correction receives exact file metadata and limits, never raw rejected output or additional code. Persistent failure stops before report writing; the API exposes a safe `selectionIssue` category. Provider failures and archive integrity failures do not trigger this correction. Set `maxCorrectionRetries: 0` on `retrieveRepositoryContext` to disable it.

Selected excerpts are separate `repository_context`, never written into or used to mutate Project State. Generation keeps its `{pages:[...]}` model JSON format and validates excerpt source IDs alongside existing State sources. Revision keeps `{changes:[...],message}` with exact replacements, and rejects new URLs outside supplied sources or links already present in the report. New code details must cite supplied commit-and-line URLs. Prompts prohibit treating file text as instructions, assuming tests passed, inventing releases/deadlines/completion, overriding State statuses or clearing data gaps. Source and format checks do not prove semantic correctness of every model claim; review new explanations against the cited code.

Both existing local endpoints accept optional `useRepository: boolean`. Generation also accepts `focus: string` (up to 4,000 characters). The server creates repository context; a client-supplied `repository_context` is rejected. Successful enabled responses include `repository: {commit,status,files}`, with status `read` or `not_needed`; the trace contains paths, line ranges and source URLs, not full file contents. The UI shows this as **本次 repo 讀取紀錄**, representing only the most recent successful operation. An error preserves the last successful report and trace.

## Selected merge interval

For p-limit, enable **彙整合併區間** and choose **區間開始快照（含）**. The existing **選擇合併快照** is the end snapshot; both endpoints are inclusive. The UI shows the merge count, and only offers starting snapshots up to the end. Changing the end to an earlier version clamps the start to a valid version. Changing projects resets the interval option. Changing the selection does not rewrite a current report; regenerate it or explicitly request a change such as “Recent Changes 包含所選區間每次 merge，逐筆列出日期、PR 與摘要”.

Both local report endpoints accept `mergeRange: {startCommit, endCommit}`. `endCommit` must equal the selected State's `source_commit_sha`, both SHAs must be in the p-limit fixture inventory, and the interval must be in chronological order. `merge-history.js` reads each saved State via explicit server-only asset URLs in `historical-state-urls.js`, verifies identities and the previous-State chain within the interval, and supplies only the selected dated triggers as separate `merge_history`. Client-injected history is rejected. This does not require an LLM call or enabling repository reads. Current feature/risk status still comes from the end State, and optional repository excerpts still come from the end commit. Historical State files and the original State are never modified.

Generation organizes the supplied merges into relevant outcomes and themes according to the report request. If the user explicitly asks for every merge or a chronological log, it should cover each supplied merge with its date, PR number and citation; otherwise it does not automatically dump a technical change log or require a Recent Changes heading. Revision uses the interval only as evidence for the current request, preserving unrelated content. These are recorded PR merges, not a complete commit/release history: unmerged PRs, out-of-range merges and direct commits are not invented or included. A successful response includes `mergeRange: {startCommit,endCommit,count}`; invalid ranges return `MERGE_RANGE_INVALID` before calling the model. Without this option, the original single-State behavior remains. Core integrations can pass verified `mergeHistory` separately to `generateReport` or `reviseReport`.

## Revision validation and one correction attempt

Revision still applies exact, unique, non-overlapping replacements against the latest report, including manual edits. If the model returns invalid modification JSON, mismatched/overlapping patches, an unverified source URL, or an obviously incomplete whole-report Chinese translation, the application asks it to correct the result **at most once**, against the unchanged original report. Provider/network errors are not resent by this correction loop; existing provider HTTP retry rules remain separate. An enabled repo request can therefore use up to two selection calls plus up to two revision calls, before provider retries. Direct callers can set `maxCorrectionRetries: 0` to disable the correction attempt.

Whole-report translation instructions explicitly include page titles, bullets and speaker notes, preserving technical identifiers and source URLs. A narrow check rejects the original four English page titles or obvious English prose outside Sources after a whole-report Chinese translation request. Notes-only translation requests can retain English titles. This check detects the observed partial/no-op failure; it is not a full language or translation-quality evaluator.

The response also exposes `changed: boolean`. When the report did not change, the UI says **本次未修改報告** rather than claiming a modification was applied. Failures preserve the current report and unsent request, and distinguish `REPOSITORY_SELECTION_INVALID`, `REVISION_JSON_INVALID`, `REVISION_MATCH_FAILED`, `REVISION_OVERLAP`, `REVISION_SOURCE_INVALID` and `REVISION_TRANSLATION_INCOMPLETE` without exposing raw rejected model output. The screenshot's older generic error cannot identify which validation failed retrospectively; future errors identify the failed stage.

Core module integration remains injectable: `generateReport(state, {complete, repositoryContext, focus})` and `reviseReport(args, {complete, repositoryContext})`. Obtain context using `retrieveRepositoryContext({state,mode,request,report,history},{complete})`; the HTTP layer already coordinates this. Calls without these options, including existing CLI commands, retain State-only behavior. The direct CLI has no automatic `--repo` option at present. Other repositories, latest-branch browsing, changes to Intent Supervisor, and Firestore storage of read traces are outside this implementation.

For optional browser QA, after installing dependencies in both the existing Next.js project and `slide-export`, run `node web-check.mjs` from this directory. Set `PLAYWRIGHT_BROWSERS_PATH` if Chromium is installed in a custom location. By default this test starts its own Next.js development server in `NODE_ENV=test` (which skips `.env.local`), intercepts LLM requests with fixture responses and shuts down afterward. If a development server is already running, set `REPORT_TEST_URL` to its local URL to reuse it without loading any env file in the test runner. Set `REPORT_TEST_PPTX=1` to exercise both real PPTX formats; set `REPORT_TEST_WEB=1` to exercise a real Slidev web build, playback, fade transition and direct slide reload. The test uses the Chromium dependency from `slide-export`, without calling a paid API.

Every Markdown page starts with a `#` title and requires one nonempty speaker-notes section. Revision validates the complete result after adding, splitting or merging pages; missing notes trigger one correction attempt against the original draft. If correction fails, the original draft is retained. Missing `---` separators before subsequent page titles are restored without rewriting content. Sources is optional per page; existing citations are preserved unless removal or consolidation is requested.

Failure responses include a safe `stage` value (`preparation`, `repository_selection`, `report_generation`, or `report_revision`) so provider failures can be located without logging prompts, keys or response bodies. The workspace clears stale success messages when a request begins, preserves existing drafts on failure, rejects empty successful report responses, and reports whether a draft exists. Persistent HTTP 503 responses remain provider availability failures; local formatting corrections do not resolve them.
