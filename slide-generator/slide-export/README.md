# Slide export

Confirmed report → editable Slidev Markdown → web / PPTX / portable ZIP.

[Installation](../README.md) · [Tests](../TESTING.md) · [Official Slidev skill](https://github.com/slidevjs/slidev/blob/main/skills/slidev/SKILL.md)

## CLI

Requires Node 22.12+ and this package's dependencies. From `slide-export`:

```sh
node cli.js ../report-agent/report.md slides.md --transition fade
node node_modules/@slidev/cli/bin/slidev.mjs export slides.md --format pptx --output slides.pptx
```

Output must not exist. Omit transition for the default; supported transitions: fade, fade-out, slide-left/right/up/down. For LLM-chosen effects:

```sh
node --env-file=../.env.local cli.js ../report-agent/report.md slides-ai.md --ai
```

Input pages need a `#` title, one nonempty `## Speaker Notes` (or supported Chinese equivalent), and optional Sources afterward. Sources must contain HTTPS Markdown links. Conversion preserves report text and turns notes into trailing Slidev comments.

## Website outputs

Generate slides after confirming the report, then edit **檢查 Slidev Markdown → 編輯 slides.md**. Downloads, playback, PPTX, ZIP and layout checks use the edited source directly. Report/State is unchanged. Edits clear old playback/check results; regeneration confirms before overwriting them.

| Output | Behavior |
| --- | --- |
| Web | Real Slidev transitions/reveals; local link lasts about two hours and needs Next.js |
| `pptx` | Slide images; text is not editable/clickable |
| `pptx-editable` | Attempts editable text/shapes; unsupported parts may fall back to images |
| Portable ZIP | Unzip and run `node serve.mjs` in `presentation` on macOS/Linux, or `start.cmd` on Windows |

PPTX does not preserve browser animations. Website exports use the final click state, not a slide for every click. Inspect fonts, wrapping and notes manually. Portable playback needs Node but no repository, API key or package install.

## Source editing

Supported: Markdown, page breaks, title, one nonempty trailing notes comment per page, paired `<v-clicks>`, layout slots, HTTPS links, default theme, built-in text layouts, transitions, click animations and zoom 0.1–1.

Arbitrary Vue/HTML, imports, custom themes, images and code fences are rejected before rendering. Invalid edits remain available for correction. Download `slides.md` before refresh.

## Local API

| POST route | Result |
| --- | --- |
| `/api/reports/slides` | `{slides,presentationPlan?,operation}` |
| `/api/reports/web` | `{url,expiresAt}` |
| `/api/reports/export` | Binary PPTX |
| `/api/reports/portable` | Binary ZIP |
| `/api/reports/layout` | Page overflow diagnostics |

Generation accepts `{report,transition?,presentationPlan?}`; `transition:"auto"` requests an effects plan. Render routes also accept `slides?` for edited source; export adds `format` (`pptx` or `pptx-editable`). Without `slides`, they convert the report. Rendering never calls a model.

## Runtime and checks

PPTX/overflow inspection requires [Chromium](../README.md#chromium); web builds do not. Jobs are isolated, bounded to two concurrent renders per process and a 150-second operation budget. API keys are not forwarded. Overflow checks measure actual DOM bounds; they do not repair layout.

Run `node --test` here. Full real-render verification is `node report-agent/verify.mjs --render` from `slide-generator` with the dev server running. APIs remain local-only and reject production mode.
