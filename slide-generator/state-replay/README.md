# Historical Project State reconstruction

This is a local bootstrap/analysis tool for public repositories without Project State. It is **not Intent Supervisor**, does not write Firebase, and does not run Git commands or write GitHub resources. It uses the unchanged official Schema. Historical reconstruction is partial and needs human review.

## Install and plan

Requires Node.js 22.12+. From this directory:

```powershell
npm.cmd ci
node cli.js https://github.com/sindresorhus/p-limit --plan --base-branch master
```

`--plan` is the default. It makes anonymous GitHub GET requests, collects all pages of closed PRs, excludes unmerged PRs, and sorts merged PRs by merge time (PR number breaks ties). It records the current default branch and any explicitly supplied historical base names. It **does not call an LLM**. The example includes `master` because that repository renamed its default branch. No repository-specific rules exist in the tool. Branches outside the declared scope appear under `excluded_bases`; they are not silently counted as default-branch merges. Confirm the scope before running analysis.

The plan is frozen with a default-branch head SHA, collection timestamp and complete PR inventory. Every processed merge must be an ancestor of that head. Rebase/squash-merged PRs are included when GitHub supplies their merged commit. GitHub metadata cannot establish every historical default-branch rename automatically; supply old names explicitly. A changed/force-pushed history may require manual investigation rather than automatic continuation.

## Generate and resume

Configure Gemini/Groq/OpenAI in the existing `slide-generator/.env.local` using the Report Agent instructions. Never commit that file. From `state-replay`:

```powershell
node --env-file=../.env.local cli.js https://github.com/sindresorhus/p-limit --run --limit 3
```

`--run` explicitly enables LLM calls. `--limit 3` means **up to three additional successful versions this invocation**, not only three PRs in the inventory. Run the same command again to resume. Already accepted versions are not regenerated. Increase to at most 100 only after checking model quality and API allowance. Normally each version uses one selection call and one State-analysis call; each can have one format correction (four model calls maximum per version). Provider HTTP retries are counted separately. No automatic provider/model changes occur.

Each analysis receives the immediately previous complete State (null for the first), immutable merge message and changed-file patches, the selected commit's file inventory for selection, and only the verified selected file excerpts for analysis. It never receives later States or current mutable PR descriptions. The current repository at the merge is used, not just the patch. Limits match the report reader: four excerpts, 180 lines each, 24,000 characters total; the full repository is **not exhaustively analyzed**. Oversized/truncated inventories or evidence fail explicitly. Bounded excerpts can miss important behavior, so all three assessment sections retain data gaps.

The model returns assessments and a merge summary. The application supplies identity, dates, generator, references and chain metadata, then performs full Draft 2020-12 validation plus relationship/evidence checks. Current code alone is insufficient for newly `done` items: they also need this merged PR and a selected changed-file source. Prior IDs must remain stable; unverified/removed capabilities are retained as `unknown`, not silently dropped. Static risk observations require current evidence and unknown severity. Tests/versions are not evidence of passing CI or publication. These checks establish format and provenance, **not semantic proof of every claim**.

## Saved data

Default location: `state-replay/.local-data/repo-<repository-hash>/`, ignored by Git.

- `states/`: one immutable accepted State per merge.
- `latest.json`: the last successfully accepted State, not necessarily repository HEAD or a fully processed history.
- `index.json`: authoritative checkpoint, frozen plan, original merge times, accepted-version hashes and completion status.
- `audit/`: per-version immutable inputs, selected excerpts, operation metadata and collection time. No credentials or raw rejected responses.
- `run.lock`: single-writer lock, released on ordinary success/failure.

Version files are written before atomically replacing the checkpoint. `latest.json` is a recoverable convenience copy; after a crash between writes, the next invocation reconstructs it from the checkpoint. Readers verify version hashes and chain links. Failures do not advance the checkpoint. Ctrl+C requests cancellation. To remove a crashed process's lock, use `--unlock-stale`; the tool refuses while its PID is alive. Do not manually edit accepted versions/index to resume a corrupt history.

`updated_at` records collection/analysis time, per the official Schema. Historical merge time remains in the index, UI labels and merge-range evidence; it is not falsely presented as the time the tool ran. Generator is `historical-project-state-replay`. No direct commits create their own State; code changes between PR merges can appear in a later snapshot but must not be attributed to that PR without evidence.

After the frozen plan is complete, use `--refresh` to append a newly collected inventory. Repeat historical `--base-branch` options when refreshing. Accepted merge prefixes and branch scope must match; history is never rewritten silently. `--output <directory>` selects another output root; for the website to read that root, configure the same absolute `STATE_REPLAY_DIR` in its environment and restart Next.js. The default needs no extra setting. Keep custom output locations outside versioned source or explicitly ignore them.

GitHub anonymous rate limits apply. A rate-limit/network/model failure stops with the last checkpoint intact. Wait for recovery and resume; no key/payment upgrade is required by this tool. It does not execute downloaded code or repository tests.

## Use in the website

Start the existing Next.js app, open `/reports`, enter the same public repo URL and click **載入已重建的歷史 State**. Partial results are labeled `X/Y` and can be tested before finishing the history. Choose an end snapshot, optionally select an inclusive start (maximum 100 merges), then generate/revise a report. The server reloads accepted State by replay ID/event/commit and validates the stored chain; client State edits do not replace that stored version. Enable repository reading for additional excerpts from exactly the selected end commit. The range supplies dated trigger records; it does not feed future code to old snapshots.

**載入公開 repo** remains the separate current-code-only mode and does not automatically run reconstruction. The website never starts this long job. Production endpoints remain disabled pending authentication, persistence and hosting coordination.

## Offline verification

```powershell
node --test
```

From `slide-generator`, with the existing Next server running:

```powershell
node report-agent/verify.mjs --browser
```

Tests use a small synthetic repo and mocked GitHub/model responses: chronology, first/previous State isolation, no-op planning, resume, failure preservation, locks, schema/ID/source checks, corrupt-chain rejection, latest recovery, inclusive history and actual Next/UI integration. No real LLM or API keys are needed. A public p-limit **plan-only** smoke test collected 21 merges over `main`/`master`; live model output still requires a small manual run and review.
