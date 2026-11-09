# ScenarioForge AI

**When things change, prove you're still prepared.**

ScenarioForge is an Atlassian Forge app for Jira. It turns software and infrastructure changes into short, evidence-backed recovery rehearsals, so engineering teams can check whether their recovery procedures still work after the systems around them have changed.

```
Change → Recovery risk → Rehearsal → Evaluation → Remediation → Retest
```

Built for Atlassian Codegeist 2026 (Apps for Software Teams).

## What works today (M0 + M1)

| Area                                                                   | Status                               |
| ---------------------------------------------------------------------- | ------------------------------------ |
| Jira global page with eight-screen navigation                          | Working                              |
| Live Jira changes (search, filter, sort, link to Jira)                 | Working, runs as the signed-in user  |
| Jira connection status                                                 | Working                              |
| Recovery rehearsal: briefing, time rail, objectives, evidence, debrief | Working, **synthetic demo scenario** |
| Reports for rehearsals in the current session                          | Working, demo data, not persisted    |
| Recovery plans, readiness checks, crisis room                          | Labelled as planned (M2, M3, M7)     |
| Confluence, JSM, Rovo, MCP, Teamwork Graph                             | Not built yet                        |

Nothing in the app presents a readiness score or finding without evidence. Demo data is labelled wherever it appears.

## Repository layout

```
manifest.yml            Forge manifest (global page, resolver, scopes)
src/                    Forge backend: resolvers, Jira gateway, validation
shared/                 Domain model, API contract, simulation engine, scenarios (used by backend and UI)
static/app/             Custom UI (React 18, TypeScript, Vite, Atlaskit)
test/                   Vitest unit tests
docs/                   Product, architecture, milestones, decisions, compliance, test strategy
.github/workflows/      CI
```

## Prerequisites

- Node.js 24 (`nvm install 24 && nvm use 24`)
- Forge CLI (`npm install -g @forge/cli@latest`) and `forge login` with an Atlassian API token
- An Atlassian site you are an admin of (a Forge demo site from `forge site provision` works)

## Setup

```bash
npm install
npm install --prefix static/app
npm run verify           # typecheck, lint, tests, frontend build
```

## Deploy to your development environment

```bash
npm run frontend:build
forge deploy -e development
forge install --site <your-site>.atlassian.net --product jira -e development
```

Open Jira, choose **Apps → ScenarioForge**. The first visit asks you to allow the app to read Jira as you.

## Local UI preview

Forge Custom UI only talks to Jira inside Jira. For layout work without Jira:

```bash
cd static/app
SF_PREVIEW=1 npx vite        # then open http://localhost:3000/?preview=fixtures
```

`?preview=fixtures|empty|error` swaps in development-only fixtures and shows a banner saying so. The preview code is excluded from production builds (CI checks this).

## Documentation

- [Product vision](docs/PRODUCT_VISION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Milestones](docs/MILESTONES.md)
- [Decisions](docs/DECISIONS.md)
- [Setup status](docs/SETUP_STATUS.md)
- [Contest compliance](docs/CONTEST_COMPLIANCE.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Security and dependency audit](docs/SECURITY.md)
- [Design system](docs/DESIGN.md)
