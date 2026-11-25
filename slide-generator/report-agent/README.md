# Report Agent

Project State → LLM → Markdown report. Optional inputs: writing brief, accepted merge history and fixed-commit repository excerpts.

[Website setup](../README.md) · [Schema](../schemas/README.md) · [Tests](../TESTING.md)

## Run

Configure a provider in `slide-generator/.env.local` using the setup guide. From `report-agent`:

```sh
node --env-file=../.env.local cli.js ../schemas/examples/normal.json report.md
```

Optional third argument: the writing brief. Output files must not already exist. The standalone CLI needs Node 20.6+; use the application requirements for the complete website.

## Module interface

```js
import { generateReport } from './index.js';
import { createClient } from './llm.js';

const report = await generateReport(state, {
  complete: createClient(),
  focus: 'Summarize recent results for a non-technical manager.'
});
```

Inject `complete(messages)` to test without an API. Keep real provider calls and keys on the server.

| File | Responsibility |
| --- | --- |
| `state.js`, `evidence.js` | Prepare and check evidence |
| `prompt.js` | Writing instructions and input |
| `llm.js` | Gemini/Groq/OpenAI requests and HTTP retries |
| `index.js`, `report-format.js` | Validate output and render Markdown |
| `repository-context.js`, `merge-history.js` | Optional repository/history evidence |
| `http.js`, `operation.js` | Local HTTP adapter, cancellation and budgets |

## Output and checks

Model JSON: `{pages:[{title,bullets,script,source_ids?}]}`. Each report page needs a title and nonempty notes; Sources is optional. The writing brief controls section order/count. Default: project introduction, recent results and evidenced outstanding issues.

- Validate structure and supplied source identifiers; ask for at most one correction.
- Preserve missing assessments; one trigger means one merge.
- Repo evidence stays at the selected SHA: at most 4 excerpts, 180 lines each, 24,000 characters total.
- Report HTTP operations: 120 seconds, at most 4 model calls. Provider HTTP 500/502/503/504 can retry twice; 429/auth/model errors and timeouts are not automatically retried.
- Checks cannot prove factual accuracy. Review claims and citations manually.

## Retained revision module

The website hides conversation editing, but the module/API/CLI remains:

```sh
node --env-file=../.env.local revise-cli.js ../schemas/examples/normal.json report.md report-revised.md "Shorten the speaker notes"
```

`reviseReport({state,report,request,history}, {complete})` returns `{report,message}`. Pass the latest manual edits; history is optional, oldest first. Replacements must match exact, unique, non-overlapping text. Invalid output gets one correction; persistent failure preserves the original. The function never changes State or saves history.

## Local HTTP

- `POST /api/reports/generate`: `{state,focus?,useRepository?,mockDatasetId?,replayId?,mergeRange?}`.
- `POST /api/reports/revise`: same evidence fields plus `report,request,history`; retained, not exposed in the UI.
- Accepted Mock/replay inputs are reloaded server-side. Ranges are inclusive, end at the selected State and contain at most 100 merges.
- Errors return a safe code/message; rejected model text and keys are not exposed.

Run `node --test` here for offline tests. These local adapters remain disabled in production.
