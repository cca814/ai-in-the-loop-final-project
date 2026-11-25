# Historical State reconstruction

Optional CLI for public repos without Project State. Each accepted merge produces one complete State based on the previous State and that merge's code. Results are partial reconstructions requiring human review.

[Website setup](../README.md) · [Schema](../schemas/README.md) · [Tests](../TESTING.md)

## Plan, generate and resume

Install this package and configure `slide-generator/.env.local` as in the setup guide. From `state-replay` (replace the URL with a real public repository):

```sh
node cli.js https://github.com/owner/repo --plan
node --env-file=../.env.local cli.js https://github.com/owner/repo --run --limit 3
```

- Plan uses read-only GitHub requests and no LLM; it freezes the branch head and ordered merge inventory.
- Run processes up to 3 additional versions. Repeat the command to resume; accepted versions are not regenerated.
- Normally each version uses selection and assessment calls, with at most one correction each.
- `--base-branch <name>` includes a historical base name explicitly.
- `--refresh` appends a new inventory after the frozen plan completes.
- `--output <directory>` changes storage; configure the same `STATE_REPLAY_DIR` for the website.
- `--unlock-stale` removes a crashed writer's lock only if its PID is no longer running.

The standalone tool requires Node 22.12+; follow application requirements for the full website.

## Saved files

Ignored directory: `state-replay/.local-data/repo-<hash>/`.

| File | Purpose |
| --- | --- |
| `states/` | Accepted immutable versions |
| `latest.json` | Last successfully accepted State, not necessarily current repo HEAD |
| `index.json` | Frozen inventory, hashes, progress and checkpoint |
| `audit/` | Accepted input/evidence metadata |
| `run.lock` | Single-writer protection |

Failures preserve the checkpoint. Readers verify hashes and chain links. Do not edit accepted versions/index to repair a failed run.

## Website

Enter the same repo URL → **載入已重建的歷史 State**. This only reads saved results; it never starts a reconstruction job. Partial results show `X/Y`. Choose a version or inclusive range of at most 100 merges, then generate/manual-edit the report.

## Limits

- Only the previous State and selected merge's evidence are supplied; never future States.
- Excerpts are bounded to 4 ranges, 180 lines each and 24,000 characters total.
- Full schema/reference validation cannot prove every claim. Gaps remain explicit.
- Collection time (`updated_at`) and historical merge time are separate.
- Unmerged PRs/direct commits do not create separate States. Missing historical branch names need explicit input.
- GitHub limits or model failures stop safely; downloaded code/tests are never executed.
- No Git/GitHub writes or Firebase writes occur. This is optional bootstrap work, not the production State producer.

Run `node --test` here. The bundled Mock examples can test the website without this tool or external historical data.
