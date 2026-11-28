# Slide Generator frontend

Requires Node.js 24.12+ for the shared dependencies. From the repository root:

```sh
cd slide-generator
npm ci
npm run dev
```

Windows: use `npm.cmd` if PowerShell blocks `npm.ps1`. Open **http://localhost:3000/reports** (or the printed port).

Keep the terminal running; Ctrl+C stops the server. The `/` homepage is still the original scaffold. No `.env.local`, Firebase credentials, LLM key or separate Slidev install is needed for this frontend check.

## Quick walkthrough

1. Open `/reports` and paste the following into **Edit Markdown**:

   ```markdown
   # Project Overview

   | Feature | Status |
   | --- | --- |
   | Report editor | Ready |

   - [x] Review the report
   - [ ] Connect the backend

   ## Speaker Notes

   Explain the current frontend and the planned backend integration.
   ```

2. Select **Preview**: expect a heading, table and two read-only task checkboxes. Raw HTML is not rendered.
3. Select **Split**: expect the source and preview together. Repeat the sample until both panes scroll; scrolling either pane should move the other by the same percentage. Preview height is capped at 560px, or 420px on mobile where the panes stack.
4. Switch back to **Edit**: the source must be unchanged. Click **Download Markdown**: `report.md` must contain that source.
5. Expect Project ID, Report brief, generation and export controls to be disabled. Slide source is empty and read-only until backend integration. Refreshing clears the report; accept the browser's leave-page confirmation if shown.

Public repo loading and repo reading are not exposed. After integration, the browser will remember up to 10 successful project IDs, and generated slides will be downloadable as `slides.md`.

## Frontend integration

`app/reports/workspace-types.ts` reuses the shared `ProjectState` type. A client-side adapter supplies `WorkspaceActions`: load all full States for a project, generate a report from the selected State/range and brief, generate slides, and deliver exports. The adapter owns validation, pagination and request timeouts. Ordinary callbacks cannot be passed from a server page.

Known failures reject with `WorkspaceActionError` and a defined code; the UI supplies its message. Other errors show a generic message, never the raw error text.

## Check

From `slide-generator`:

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js app/reports
```

Use the walkthrough above for manual checks. Project IDs accept 2–63 lowercase letters, digits or hyphens, beginning with a letter or digit: `ab` and `demo-app` pass; empty, `a`, `INVALID/ID`, `bad_id`, `-ab`, spaces and 64 characters fail.

Callback checks passed with a temporary fixture adapter. Repeat these checks after connecting an adapter, using two validated States A and B for the same project:

| Operation | Expected result |
| --- | --- |
| Generate from B, edit, select A | Preserve edits, warn about source, block slides; selecting B clears the warning. |
| Generate from inclusive range A–B | Receive both States in order; record that range as the report source. |
| Reject load/generation, or return empty output | Keep existing content; unknown error details stay hidden. |
| Edit a confirmed report | Clear confirmation and block export until reviewed and slides regenerated. |
| Generate slides, change the report or effects | Block export until regenerated; export the new source. |
| Submit twice while the first call is pending | Start only one operation. |

These are frontend acceptance cases, not a committed automated suite. No browser-testing dependency, fixture adapter or runner is included. Firebase, Gemini and Slidev integration remain unverified.

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
