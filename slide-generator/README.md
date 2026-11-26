# Slide Generator

The Slide Generator stores the Project State snapshots that the Intent Supervisor submits after each merged PR, and the `report.md` and `slides.md` files that users save. The data is kept in Firestore and served by a Next.js API, described in [API.md](API.md).

- **Production:** <https://slide-generator-delta.vercel.app>
- **Health check:** <https://slide-generator-delta.vercel.app/api/health> returns `{"ok":true,"firestore":true}` when the server can reach Firestore.

## Run it locally

### Before you start

- Node.js 22 or later, with npm.
- The three Firebase values for `.env.local`. Ask Eddy for them in a private message. Never commit them, or paste them into an issue, a PR or a group chat.

Local development connects to **the same Firestore database as production**. Anything you write locally also appears on the deployed site, so use the example project `demo-app` for tests.

### Steps

From the repository root:

```bash
cd slide-generator
npm ci
cp .env.example .env.local
```

Open `.env.local` and fill in:

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | From Eddy |
| `FIREBASE_CLIENT_EMAIL` | From Eddy |
| `FIREBASE_PRIVATE_KEY` | From Eddy. Keep the surrounding double quotes and the `\n` sequences on one line. |
| `INGEST_TOKEN` | Any long random string for local use, for example the output of `openssl rand -hex 32` |

Start the server:

```bash
npm run dev
```

Open <http://localhost:3000/api/health>. It should show `{"ok":true,"firestore":true}`. If it shows an error, check the three Firebase values.

After you change `.env.local` or any file in `schemas/`, stop the server with Ctrl+C and start it again.

### Try the main flow

Run these from `slide-generator/` while the server is running.

**1. Submit three example snapshots**, as the Intent Supervisor does after each merged PR:

```bash
TOKEN=$(grep '^INGEST_TOKEN=' .env.local | cut -d= -f2- | tr -d '"')
P=http://localhost:3000/api/projects/demo-app
for n in 1001 1002 1003; do
  curl -s -X POST "$P/states" -H "Authorization: Bearer $TOKEN" --data-binary @schemas/examples/gh-run-$n.json; echo
done
```

Each line should show `"ok":true`. If the snapshots were stored before, it shows `"duplicate":true`, which is also fine. A `409` means the project already has a newer snapshot; you can still read it in the next step.

**2. Read the project's state:**

```bash
curl -s "$P/states"; echo   # one line per merged PR, oldest first
curl -s "$P/state"; echo    # the latest snapshot, with its Markdown content
```

**3. Save a report and open it again:**

```bash
curl -s -X POST "$P/reports" -d '{"name":"Test report","type":"report","content":"# Hello"}'; echo
curl -s "$P/reports"; echo
```

The first command returns the new report's `id`. Open it with `curl -s "$P/reports/<id>"`.

### Run the API tests

With the server running, in a second terminal:

```bash
cd slide-generator
npm run test:api
```

[`scripts/api-test.mjs`](scripts/api-test.mjs) runs 17 checks through the whole flow: submitting snapshots (including a resubmission, an out-of-order snapshot and invalid ones), listing and reading them, and saving, listing, overwriting and opening a report. Each run uses a new project, `api-test-<time>`, and deletes it from Firestore when it finishes. Expected result: `pass 17`, `fail 0`.

To test the deployed site, run `BASE_URL=https://slide-generator-delta.vercel.app npm run test:api`. This needs the production `INGEST_TOKEN` in `.env.local`.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run test:api` | Runs the API tests against a running server |
| `npm run lint` | Runs ESLint |
| `npm run build` | Builds for production. It needs a filled-in `.env.local`. |

## Deployment

Every push to `main` that changes `slide-generator/` is deployed to Vercel production by [`.github/workflows/deploy-slide-generator.yaml`](../.github/workflows/deploy-slide-generator.yaml), which then calls `/api/health`. To deploy without a new commit, open **Actions → Deploy Slide Generator → Run workflow**.

- The Firebase values and `INGEST_TOKEN` for production are stored in the Vercel project settings.
- The workflow uses the repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`, and the variable `SLIDE_API_URL`. Only the repository owner can change them.

## Where things are

| Path | Contents |
| --- | --- |
| `app/api/` | The API routes |
| `lib/` | Firestore connection and request validation |
| `scripts/api-test.mjs` | The API tests |
| `schemas/` | The Project State JSON Schema, its field guide and example snapshots |
| `API.md` | Input and output of every endpoint |
