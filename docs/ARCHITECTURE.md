# Architecture

## Overview

```
Jira (browser)                         Forge platform (Atlassian-hosted)
┌──────────────────────────┐           ┌──────────────────────────────────┐
│ Custom UI iframe          │  invoke   │ resolver function (nodejs24.x)   │
│ static/app (React + TS)   ├──────────►│ src/index.ts                     │
│  - pages, components      │           │  - validation.ts (enum-only)     │
│  - simulation UI          │◄──────────┤  - jira/client.ts, mapping.ts    │
│  - shared/ engine (pure)  │ ApiResult │                                  │
└──────────────────────────┘           │ api.asUser().requestJira ───────►│ Jira Cloud REST API
                                        └──────────────────────────────────┘
```

## Modules

| Path                                 | Responsibility                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `manifest.yml`                       | `global:fullPage` module, resolver function, scopes, CSP for Atlaskit styles                                             |
| `src/index.ts`                       | Resolver definitions: `getConnectionStatus`, `listRecentChanges`. Catches all errors and returns `ApiResult`             |
| `src/validation.ts`                  | Validates untrusted payloads; builds JQL from enum values only                                                           |
| `src/jira/client.ts`                 | Jira calls behind a `JiraGateway` interface (testable without Forge)                                                     |
| `src/jira/mapping.ts`                | Maps Jira responses defensively; maps HTTP status to user-safe errors                                                    |
| `shared/api.ts`                      | Request/response contract for UI ↔ resolver                                                                              |
| `shared/domain/types.ts`             | Domain model: service, change, procedure, finding, evidence, scenario, decision, objective, session, remediation, retest |
| `shared/simulation/engine.ts`        | Deterministic exercise engine (pure functions, no clock, no randomness, no AI)                                           |
| `shared/simulation/scenarios/`       | Authored scenarios. Currently one synthetic demo                                                                         |
| `shared/issueFilters.ts`             | Pure filter and sort for the Changes table                                                                               |
| `static/app/src/lib`                 | Bridge wrappers, router (Forge history), site context, session exercise log                                              |
| `static/app/src/pages`, `components` | Screens and UI components                                                                                                |
| `static/app/src/dev`                 | Development-only preview fixtures and bridge stub (never in production builds)                                           |

## Data flow: live changes

1. UI calls `invoke('listRecentChanges', { updatedWithin: '30d', maxResults: 25 })`.
2. Resolver validates the payload (enum window, integer 1..50). Invalid input returns `INVALID_REQUEST`.
3. Resolver builds `updated >= -30d ORDER BY updated DESC` and calls `GET /rest/api/3/search/jql` **as the user**.
4. Response is mapped field by field; missing fields become `Unknown`, issues without a valid key are dropped.
5. Non-2xx responses become typed errors (`UNAUTHENTICATED`, `FORBIDDEN`, `RATE_LIMITED`, ...). The UI shows an error panel with retry, never placeholder rows.

## Data flow: rehearsal

1. UI starts a session from a scenario with `startSession(scenario, id, startedAt)`.
2. Each choice calls `applyDecision`, which returns a new immutable session: elapsed minutes, flags (with the minute each was set), decision log.
3. `objectiveProgress` drives the live objective panel; `evaluateSession` produces the final result.
4. Same scenario version plus same decisions always gives the same result (tested).

The engine is in `shared/` so it can move server-side in M5 (persisted, auditable sessions) and M7 (multiplayer) without changes.

## Security model

- **Least privilege:** `read:jira-work`, `read:jira-user`. No write scopes until remediation (M8), and then only with explicit approval in the UI.
- **asUser everywhere:** users only see Jira data they can already browse. No app-level credentials reach the browser.
- **No client JQL:** the browser sends enum values; the backend builds the query.
- **Errors are explicit:** resolvers never throw to the client and never fabricate success. Unknown readiness stays "Not assessed".
- **Tenant isolation:** no storage yet. When Forge Storage arrives (M5) it is per-installation by platform design.
- **CSP:** only `styles: unsafe-inline` (required by Atlaskit). No external fetch or fonts.
- **Data separation:** every entity carries `origin: 'live' | 'demo'`, rendered as a visible label.

## Jira APIs used

| Call                         | Scope            | Purpose                                                    |
| ---------------------------- | ---------------- | ---------------------------------------------------------- |
| `GET /rest/api/3/search/jql` | `read:jira-work` | Recent issues (summary, status, type, updated, project)    |
| `GET /rest/api/3/myself`     | `read:jira-user` | Connection check (display name only is returned to the UI) |

## Planned integrations

Confluence pages and JSM services (M2), readiness analysis (M3), Teamwork Graph (M4/M9), Rovo agent and actions (M6), Forge Realtime crisis room (M7), Jira remediation with approval (M8), Atlassian MCP `rovo:mcp` tools (M9).
