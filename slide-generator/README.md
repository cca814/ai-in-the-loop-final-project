# Slide Generator

Project State -> report -> manual editing -> editable slides -> web / PPTX / portable ZIP.

Local Mock workflow only; formal Firebase integration and deployment are outside this contribution. Conversation editing and draft save/load remain implemented but hidden. Report edits never change Project State.

## Install

Use **Node.js 24.12+** for the merged dependencies. From the repository root:

```sh
cd slide-generator
npm ci
cd slide-export
npm ci
cd ../state-replay
npm ci
cd ..
npm run dev
```

Windows: use `npm.cmd` if `npm.ps1` is blocked. Open **http://localhost:3000/reports** (or the printed port); keep the server running.

### Chromium

Needed for PPTX, browser tests and overflow checks, not web builds. From `slide-generator/slide-export`:

```sh
# macOS/Linux
export PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.playwright-browsers"
node node_modules/playwright-chromium/cli.js install chromium
```

```powershell
# Windows PowerShell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'node_modules/.playwright-browsers'
node node_modules/playwright-chromium/cli.js install chromium
```

## First run — no key needed

1. Open **Mock 測試資料管理 → 建立 Mock 範例資料**.
2. Load project ID **`demo-app`**: expect 3 fictional States.
3. Paste this into **直接編輯 Markdown**:

```markdown
# Local workflow check

- This page tests manual editing and presentation conversion.

## Speaker Notes

Explain the local demonstration and manually entered report.
```

4. Try **編輯 / 檢視 / 雙欄**, undo/redo and download. Split scrolling is proportional.
5. Choose fixed **Fade**, confirm, then **產生 Slidev 原稿 → 建立網頁簡報 → 開啟播放**.
6. Expand **檢查 Slidev Markdown** to edit/download slides. Playback, PPTX, ZIP and overflow checks use these edits.

Report pages need a title and nonempty notes; Sources is optional. Format, citation, density and gap reminders run automatically, without rewriting facts. Report generation/automatic effects call a model; this fixed-transition walkthrough does not.

## LLM settings

Create `slide-generator/.env.local`, then restart:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace-locally
GEMINI_MODEL=replace-with-an-available-model
```

| Provider | Key | Model |
| --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | `GEMINI_MODEL` |
| `groq` | `GROQ_API_KEY` | `GROQ_MODEL` |
| `openai` (default) | `OPENAI_API_KEY` | `OPENAI_MODEL` |

Use an account-available model. Terminal variables override the file. Never commit keys.

Set the report brief; default: project introduction, recent outcomes and evidenced outstanding issues. Repo reading supplies bounded excerpts from the selected commit, never later main changes. **Disable「允許按需讀取此版本 repo」for fictional examples.**

## Data and editing

| Entry | Meaning |
| --- | --- |
| Project ID | All accepted Mock States; latest selected by default. The browser remembers 10 successful IDs. |
| History/range | Older versions or an inclusive range of up to 100 merges; excerpts use the end State's commit. |
| JSON import | Validated producer State; directory import is in the [Mock guide](mock-firebase/README.md). |
| Public repo URL | Current code at a fixed commit; Repo Snapshot, not assessed Project State. |
| Reconstructed history | Reads existing [replay CLI](state-replay/README.md) output; does not start reconstruction. |

One trigger is one merge; collection time is not merge time. Counts refer to the selected State: features include unfinished/unknown capabilities, risks are recorded observations, and data gaps are missing assessments, not code errors.

- Reports/slides and up to 20 undo versions stay in page memory. **Download before refresh.** Mock/replay data persists in ignored `.local-data` folders.
- Slide edits invalidate playback/check results. Report/transition changes require regeneration and confirmation before replacing edited slides.
- Web links last about two hours and require Next.js. Portable ZIP: unzip, enter `presentation`, run `node serve.mjs` (macOS/Linux) or `start.cmd` (Windows); Node is required, no key/package install.
- PPTX needs Chromium; browser animations are not preserved. Review fonts, layout and notes manually.
- Source/citation checks do not prove facts. Semantic verification, richer layouts, image packaging and model-quality evaluation remain open. See [supported slide syntax](slide-export/README.md#source-editing).

## Check and troubleshoot

Run `node report-agent/verify.mjs` here: 116 tests, lint and TypeScript, without model/Firebase calls. See [TESTING.md](TESTING.md) for browser/render checks and recorded results.

| Problem | Action |
| --- | --- |
| Windows `EPERM` | Stop this project's dev processes; retry `npm.cmd ci`. |
| Missing AJV after merge | Reinstall in `slide-generator`, not only `state-replay`. |
| Unknown project | Seed examples; bundled ID is `demo-app`. |
| Provider error | Check key/model/quota; edits remain. |
| Missing Chromium | Install above; use the same browser path in the test terminal. |
| Firebase error on build/health | Use `npm run dev` and `/reports` for this local workflow. |

Report/presentation routes reject production mode. Exclude keys, databases, generated exports and downloaded demo States from the PR. Review with the repository PR template and test results below.

Module guides: [Report Agent](report-agent/README.md), [exports](slide-export/README.md), [Mock](mock-firebase/README.md), [replay](state-replay/README.md).

## Original Next.js scaffold instructions

The original scaffold instructions are retained below; the report workflow above is local-only.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
