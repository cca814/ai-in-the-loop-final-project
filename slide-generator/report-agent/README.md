# Report Agent

Generate a reviewable Markdown report from one Project State snapshot. Requires Node.js 20 or newer. The project state is expected to conform to PR #11's schema; ingestion should validate it against the official schema before calling this module. This module checks source relationships and HTTPS links, but does not implement complete JSON Schema validation.

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

To use OpenAI instead, set `LLM_PROVIDER` to `openai`, and set `OPENAI_API_KEY` and `OPENAI_MODEL`. OpenAI remains the default when `LLM_PROVIDER` is unset. Keys are provider-specific. For server integration, import `generateReport` from `index.js` and `createClient` from `llm.js`; call `await generateReport(state, { complete: createClient() })`. Alternatively inject an async `complete(messages)` returning a JSON string. Keep this call and the key on the server. Persistence and API routes are outside this module.

Run `node --test` for offline tests. The tests read the three examples in `../schemas/examples/`. No API key or network access is needed.

Each page contains bullets, speaker notes and links. The LLM is instructed to respect gaps and identify the trigger as a single merge. Links and required page structure are checked, but generated wording and whether each citation supports a claim cannot be proven by these checks. A human must review facts, completeness, data-gap wording and sources before accepting a report. A single snapshot cannot establish all changes in a reporting period. This module does not alter the input snapshot.

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
