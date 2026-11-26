# Bridging Code and Intent

An AI collaboration layer for software teams. It detects significant changes and design drift across pull requests, issues, and commits, then turns them into the right updates for the right people: technical context for engineers, progress and risk reports for managers.

## Components

| Component | What it does | Guide |
| --- | --- | --- |
| Intent Supervisor | GitHub Actions that analyse each pull request and submit the project's state after it is merged | [docs/intent-supervisor.md](docs/intent-supervisor.md) |
| Slide Generator | Stores Project State snapshots, and turns them into reports and slides that users can edit | [slide-generator/README.md](slide-generator/README.md) |

## Quick start: Slide Generator

Production: <https://slide-generator-delta.vercel.app>

To run it locally, you need Node.js 22 or later and the Firebase values described in the [setup guide](slide-generator/README.md#run-it-locally).

```bash
cd slide-generator
npm ci
cp .env.example .env.local   # fill in the values, see the setup guide
npm run dev
```

Then open <http://localhost:3000/api/health>. To check the whole flow, run `npm run test:api` in a second terminal, or follow [Try the main flow](slide-generator/README.md#try-the-main-flow).

## Documentation

- [Slide Generator API](slide-generator/API.md)
- [Project State schema](slide-generator/schemas/README.md)
- Design: [Slide Generator](docs/slide-generator.md), [Intent Supervisor](docs/intent-supervisor.md)
- [Decisions log](DECISIONS.md)
- [AI usage guidelines](ai_usage_guidelines.md)
