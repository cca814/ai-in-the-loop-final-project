# Slide export

Convert a confirmed Report Agent report to Slidev Markdown and export it to PPTX. See the [workspace setup and acceptance guide](../app/reports/README.md) for the complete local workflow. Automatic presentation styling calls the existing LLM provider for a validated effects plan; conversion preserves the confirmed text and never updates Project State. Manual conversion does not call an LLM.

Requires Node.js 22.12 or later. Install dependencies from this directory with `npm install`. Slidev uses Playwright Chromium for export; its installation downloads a browser. Consult the [official Slidev skill](https://github.com/slidevjs/slidev/blob/main/skills/slidev/SKILL.md) and [export documentation](https://sli.dev/guide/exporting).

```powershell
node cli.js ../report-agent/report.md slides.md
node node_modules/@slidev/cli/bin/slidev.mjs export slides.md --format pptx --output slides.pptx
```

The converter refuses to overwrite an existing output. It accepts pages separated by `---`, with a title, exactly one nonempty speaker-notes section and an optional sources section. When supplied, Sources follows the notes and contains at least one HTTPS Markdown link. A subsequent `#` title starts a new page even if its `---` separator was omitted. Notes headings may be `## Speaker Notes`, `## 講者備忘`, `## 講者備註`, `## 講者筆記`, or `## 講稿`; sources headings may be `## Sources`, `## 來源`, `## 來源連結`, `## 參考來源`, or `## 參考資料`. English and Chinese headings can be mixed without translating or rewriting the report. It rejects fenced code and notes containing HTML comment delimiters; edit the report into the supported format before converting. Speaker notes become Slidev presenter notes, and source URLs are printed on slides alongside the original Markdown links.

Choose either export format:

- `--format pptx` renders slide content as images: source addresses remain visible, but links and slide text are not editable or clickable. Presenter notes are included.
- `--format pptx-editable` attempts to rebuild content as editable PowerPoint text and shapes. For the normal report sample, an actual export contained four slides, four sets of notes, selectable title text, and hyperlink relationships. The output may differ from browser rendering; unsupported elements or whole slides can fall back to images. Fonts are not embedded, so recipients may need to install them. Review text wrapping, layout, links and content in PowerPoint.

Example editable export (after generating `slides.md`):

```powershell
node node_modules/@slidev/cli/bin/slidev.mjs export slides.md --format pptx-editable --output slides-editable.pptx
```

Long content can overflow slides in either format, so preview the exported presentation before sharing.

For browser presentations, optionally choose a global built-in transition when generating slides, for example `node cli.js ../report-agent/report.md slides.md --transition slide-left`. Supported values are `fade`, `fade-out`, `slide-left`, `slide-right`, `slide-up`, and `slide-down`. Omit the option for Slidev's default. You can edit the generated slides to add per-slide transitions or click animations; see [Slidev animations](https://sli.dev/guide/animations.html). Automatic mode lets the LLM choose click reveals, click animation presets, per-page transitions and default/center layouts. Manual mode does not add click reveals.

The browser plays transitions and click reveals. In the tested fixture, neither PPTX format preserved Slidev transitions as PowerPoint animations. By default both PPTX formats export each click step as an additional static slide; `--with-clicks false` disables that expansion. For a reproducible local check, run `node animations-browser-check.mjs` after installation and, if using a custom browser location, set `PLAYWRIGHT_BROWSERS_PATH` as described below. The fixture `animations-fixture.md` also supports a manual preview.

If Chromium was installed into a custom location, set `PLAYWRIGHT_BROWSERS_PATH` to the same path before exporting. Locally generated slides and PPTX files, dependencies, and the optional local npm cache are ignored by Git. Run `node --test` for offline converter tests.

## Local website integration

The `/reports` workspace calls `POST /api/reports/slides` with `{ report, transition: "auto" }` to generate `{ slides, presentationPlan }`. `POST /api/reports/export` accepts `{ report, transition, presentationPlan, format }` and returns a binary PPTX download. Both endpoints are local development only, reject cross-origin requests and are disabled in production until access controls and hosting are integrated. Reports must use the converter's supported Markdown format; executable HTML/Vue markup is rejected by the web endpoints.

The exporter runs the installed Slidev CLI in a separate Node process with a two-minute timeout. Each export gets its own ignored `.exports/job-*` directory, which is removed after completion or failure. API keys are not forwarded to the renderer. If Chromium exists in `node_modules/.playwright-browsers`, the website exporter uses that local installation automatically; otherwise it uses Playwright's default browser location. Website PPTX export uses `--with-clicks false` to export the final state of each report page, and it does not call an LLM. Online Vercel execution has not been validated.

## Slidev web playback

In `/reports`, the default presentation form is **Slidev 網頁簡報**. Confirm the report, keep the default automatic effects option (or select a manual transition), generate its Slidev draft, then build the web presentation. If you change the transition after generating the draft, regenerate it before building. Click **開啟播放** to present in a new tab using the arrow keys. PowerPoint remains an optional output form.

`POST /api/reports/web` accepts `{ report, transition, presentationPlan }`, uses the same converter, and runs `slidev build` with a per-deck base URL. It returns `{ url, expiresAt }`. The built SPA and assets are served under `/api/reports/present/<id>/` by the existing Next.js development server. A browser navigation directly to a slide falls back to the SPA HTML entry. No separate Slidev development server stays running, and Chromium is not required to build this web output. The playback uses the original Slidev browser runtime and preserves supported browser transitions and interactive behavior; automatic plans can add click reveals; manual conversion does not add them.

Decks are immutable snapshots in ignored `node_modules/.report-presentations/<id>/` directories, keeping compiled vendor assets out of source checks. Playback lasts about two hours while Next.js remains available; expired directories are cleaned when another deck is built. Report or transition changes hide the old playback link until rebuilding. Links are local temporary previews, not published or portable exports. The endpoints remain disabled in production; persistent hosting and online deployment are separate integration work. Building does not receive LLM credentials.

## Portable presentation folder

All three presentation forms remain available in `/reports`: web playback, PowerPoint download, and **可攜式網頁資料夾（ZIP）**. Confirm the report and generate the Slidev draft, then select the portable form and download. Unzip the entire archive. On Windows, double-click `presentation/start.cmd`; on other systems, run `node serve.mjs` inside `presentation`. Open the local URL printed in the terminal, and keep the terminal open during playback. The destination computer requires Node.js 22.12 or newer, but does not need the original repository, Next.js, an API key, or dependency installation. This is not a standalone executable or an HTML file that can be double-clicked directly.

`POST /api/reports/portable` accepts `{ report, transition, presentationPlan }` and returns a ZIP containing the built `site/`, unchanged `slides.md`, a Node built-in-only `serve.mjs`, Windows launcher, and instructions. The build uses base `/` and [disables remote font imports](https://sli.dev/custom/config-fonts#providers), so text presentations and transitions work offline using the computer's system fonts. Fonts may differ from the original website. External source links still require internet access. Image embedding is currently rejected rather than shipping an incomplete offline deck. Editing `slides.md` does not update the prebuilt website; regenerate to apply changes. The server only listens on loopback, serves `site/`, and supports direct slide navigation. API keys and environment files are excluded from the archive. Temporary build files are removed after packaging, including failures. The endpoint has the same local-only and same-origin restrictions as the other export endpoints.

Optional browser verification from this directory, with the Next.js development server already running:

```powershell
$env:REPORT_TEST_URL = 'http://localhost:3000'
$env:REPORT_TEST_WEB = '1'
$env:REPORT_TEST_PPTX = '1'
$env:REPORT_TEST_PORTABLE = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'node_modules/.playwright-browsers'
node ../report-agent/web-check.mjs
```

LLM calls are mocked. The portable check downloads and extracts the archive, starts its included server, blocks external network requests, and verifies slide navigation and direct slide reload independently of Next.js.


## LLM-arranged transitions and effects

The website defaults to automatic mode. It reuses `LLM_PROVIDER`, provider model and API key from the existing server environment (including Next.js `.env.local`). Each generation sends confirmed page text and notes to that provider. The model chooses a small JSON plan: `{pages:[{transition,layout,reveal,clickAnimation}]}`. It cannot rewrite report text or inject arbitrary Markdown, scripts, CSS or Vue. Page count/order, enum values, booleans and allowed fields are validated. One correction is allowed for malformed model output; provider errors use the existing adapter policy. Failure retains the draft and any previous slides.

Allowed transitions: fade, fade-out, slide-left/right/up/down. Layouts: default, center. Click presets: none, fade, fade-in, up/down/left/right, scale. A reveal wraps the existing page body (excluding title, notes and sources) in Slidev's built-in `<v-clicks>`. Notes and source links are unchanged. Effects may be omitted by the model where the content does not benefit from them.

The generated plan is stored with the draft in the current browser page and forwarded to web, PPTX and portable endpoints. These endpoints validate the plan and deterministically rebuild the same slides; they never call the model again or accept arbitrary generated Slidev code from the client. Automatic exports without a plan are rejected. Manual transitions remain available without a model call. Changing the report or transition requires regenerating slides. PPTX remains static and exports the final revealed state, without browser animations.

From `slide-export`, CLI automatic mode uses the same provider settings:

```powershell
node --env-file=../.env.local cli.js ../report-agent/report.md slides-ai.md --ai
```

The original CLI without `--ai` remains deterministic. Output files are created without overwriting existing files. No shared Next.js/Firebase dependencies or schema changes are required.


Optional end-to-end check (existing Next development server on port 3000): set `PLAYWRIGHT_BROWSERS_PATH` if using a custom Chromium location, then run `node auto-effects-browser-check.mjs` from this directory. It mocks every LLM response, checks the default UI and exact report preservation, builds a real web deck, verifies click reveals and transitions in Chromium, exports both PPTX forms (two final-state pages with notes), checks the portable ZIP source, and verifies stale link invalidation and failed-regeneration preservation. It does not load API keys or call a provider.


## Layout review and resource controls

After generating a current slide draft, use the workspace's layout-check button (`POST /api/reports/layout`). It builds an isolated temporary SPA, opens each visible slide in Chromium with click content revealed, and compares content bounds against the fixed slide canvas. It returns page numbers with possible horizontal/vertical overflow. Temporary files, server and browser are cleaned up. This is advisory: no confirmed text is automatically changed, and DOM bounds cannot guarantee typography, image availability or PPTX fidelity. Unlike a basic web build, this optional check requires Chromium. The ready web deck can also be previewed in an iframe inside the workspace.

Within one Node process, at most two web/portable/PPTX/layout render jobs run concurrently. Excess requests return `RENDER_BUSY` and Retry-After; this is a local renderer limit, not a model-provider failure. A 150-second operation deadline and cancellation signal are forwarded to CLI subprocesses. There is no distributed queue or resume-from-stage implementation. Automatic effect planning uses at most two model calls and reports usage when available.

See the [optimization record](../app/reports/OPTIMIZATIONS.md) for verification and remaining limitations.
