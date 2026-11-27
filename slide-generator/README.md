# Slide Generator frontend

Requires Node.js 24.12+ for the shared dependencies. From the repository root:

```sh
cd slide-generator
npm ci
npm run dev
```

Windows: use `npm.cmd` if PowerShell blocks `npm.ps1`. Open **http://localhost:3000/reports** (or the printed port).

- Edit reports as plain-text Markdown with undo/redo.
- Edit and download `report.md`; generated `slides.md` is read-only and downloadable. Refreshing clears edits.
- State loading, LLM generation and presentation exports are disabled until the backend integration PR. This frontend needs no API key or Mock Firebase.

After integration, successful project loads are remembered in the browser (up to 10 IDs). Reports keep up to 20 undo checkpoints in page memory. Public repo loading and repo reading are not exposed.

## Frontend integration

`app/reports/workspace-types.ts` reuses the shared `ProjectState` type. A client-side adapter supplies `WorkspaceActions`: load all full States for a project, generate a report from the selected State/range and brief, generate slides, and deliver exports. The adapter owns validation, pagination and request timeouts. Ordinary callbacks cannot be passed from a server page.

Known failures reject with `WorkspaceActionError` and a defined code; the UI supplies its message. Other errors show a generic message, never the raw error text.

Generation replaces content only after success. Reports retain their generated State/range source through manual edits and undo/redo. Selecting another source warns without discarding edits and blocks presentation creation until the selection matches or the report is regenerated. Report or effects changes make previous slides stale. Unconnected settings and actions are disabled.

## Check

From `slide-generator`:

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js app/reports
```

In `/reports`, check editing, undo/redo, exact Markdown downloads and mobile layout. Slides must be read-only; editing a confirmed report must clear confirmation. Unconnected actions remain disabled. No browser-testing dependency is required. These checks do not verify backend integration.

Project IDs accept 2–63 lowercase letters, digits or hyphens, beginning with a letter or digit. Verified valid: `ab`, `demo-app`, `project-01`. Verified invalid: empty, `a`, `INVALID/ID`, `bad_id`, `-ab`, spaces and 64 characters.

Callback checks passed with a temporary fixture adapter. Repeat these checks after connecting an adapter, using two validated States A and B for the same project:

| Operation | Expected result |
| --- | --- |
| Generate from B, edit, select A | Preserve edits, warn about source, block slides; selecting B clears the warning. |
| Generate from inclusive range A–B; undo/redo | Receive both States in order; restore report text and source together. |
| Reject load/generation, or return empty output | Keep existing content; unknown error details stay hidden. |
| Generate slides, toggle effects | Block export until regenerated; export the new source. |
| Submit twice while the first call is pending | Start only one operation. |

These are frontend acceptance cases, not a committed automated suite. The temporary adapter and runner are not included; Firebase, Gemini and Slidev integration remain unverified.

The existing `/api/projects` and `/api/health` endpoints retain their Firebase requirements; this PR does not change them. A full production build may still need the environment described in [API.md](API.md).

## Original Next.js scaffold instructions

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
