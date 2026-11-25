# Testing

Run from `slide-generator` after the [three-package install](README.md#install).

## Offline

```sh
node report-agent/verify.mjs
```

Expected: **116 tests + lint + TypeScript pass**, exit 0. No server, keys, GitHub, Firebase or Chromium needed.

| Package | Tests |
| --- | --- |
| Report Agent | 69 |
| Slide export | 29 |
| State replay | 6 |
| Mock storage | 12 |

Coverage includes source/format validation, provider failures, exact revisions, edited-slide exports, project isolation, history/resume and storage conflicts. Run `node --test` inside one package to check it separately.

## Browser and rendering

Install [Chromium](README.md#chromium). In terminal A, run `npm run dev`. In terminal B, set the browser path from `slide-generator`:

```sh
# macOS/Linux
export PLAYWRIGHT_BROWSERS_PATH="$PWD/slide-export/node_modules/.playwright-browsers"
```

```powershell
# Windows PowerShell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'slide-export/node_modules/.playwright-browsers'
```

Then choose:

```sh
node report-agent/verify.mjs --browser
node report-agent/verify.mjs --render
```

- `--browser`: offline checks plus editor/undo/cancel, State/repo/range loading and compiled routes.
- `--render`: all above plus real Slidev playback, edited-source PPTX/notes, portable ZIP and normal/overflow controls. Allow several minutes.
- Both mock model/GitHub responses; no paid-model or Firestore calls.
- Default server: `http://localhost:3000`. Set `REPORT_TEST_URL` for another local port. Use the same storage roots; do not target a shared server.
- Mock tests clean their own datasets. After forced termination: `node mock-firebase/cleanup-browser-tests.mjs`; it preserves user projects.
- Archived conversation browser checks are excluded because that UI is disabled; backend revision tests still run.

## Manual acceptance

Follow [First run](README.md#first-run--no-key-needed). For optional live LLM checks, configure a provider, disable repo reading for fictional examples, and test normal/missing-risk/done States. Review facts and gaps yourself. Open exported PPTX and portable playback on the target computer; automatic checks cannot guarantee visual quality.

## Recorded results

- After main merge: 116 tests, lint and TypeScript passed on Windows / Node 22.22.3, with the documented Firebase engine warnings.
- On 2026-11-25, the documented sample passed real Mock loading (3 States), manual editing, fixed Fade conversion and real Slidev playback with empty model keys and no generation call.
- Full browser/PPTX/ZIP/overflow checks also passed before the main merge.
- Fresh Node 24/macOS installation, Firebase connectivity and production deployment are **not claimed as verified**. The latter two are outside this PR.
