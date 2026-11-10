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

| Path                                            | Responsibility                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.yml`                                  | `global:fullPage` module, resolver function, scopes, CSP for Atlaskit styles                                                                           |
| `src/index.ts`                                  | Resolvers: `getConnectionStatus`, `listRecentChanges`, `listRecoveryPages`, `getRecoveryProcedure`, `analyzeChange`. Return `ApiResult`                |
| `src/validation.ts`                             | Validates untrusted payloads; builds JQL from enum values only                                                                                         |
| `src/jira/client.ts`                            | Jira calls behind a `JiraGateway` interface (testable without Forge)                                                                                   |
| `src/jira/mapping.ts`                           | Maps Jira responses defensively; maps HTTP status to user-safe errors                                                                                  |
| `src/confluence/client.ts`                      | Confluence calls behind a `ConfluenceGateway` interface: recovery page search, procedure excerpt with evidence                                         |
| `src/confluence/mapping.ts`                     | Maps Confluence responses; strips markup to plain text (never rendered); extracts ordered-list steps                                                   |
| `shared/api.ts`                                 | Request/response contract for UI ↔ resolver                                                                                                            |
| `shared/domain/types.ts`                        | Domain model: service, change, procedure, finding, evidence, scenario, decision, objective, session, remediation, retest                               |
| `shared/simulation/engine.ts`                   | Deterministic exercise engine (pure functions, no clock, no randomness, no AI)                                                                         |
| `shared/simulation/scenarios/`                  | Authored scenarios. Currently one synthetic demo                                                                                                       |
| `shared/simulation/remediation.ts`, `retest.ts` | Applies approved remediations as a new scenario version; compares a retest with the original using fixed rules (resolved, still failing, inconclusive) |
| `shared/simulation/replay.ts`, `scoring.ts`     | Replays sessions, builds and verifies tamper-evident audit records, and scores objectives                                                              |
| `shared/agents/contracts.ts`                    | Types only: proposed Rovo action and MCP tool contracts (Lane D)                                                                                       |
| `shared/issueFilters.ts`                        | Pure filter and sort for the Changes table                                                                                                             |
| `static/app/src/lib`                            | Bridge wrappers, router (Forge history), site context, session exercise log                                                                            |
| `static/app/src/pages`, `components`            | Screens and UI components                                                                                                                              |
| `static/app/src/dev`                            | Development-only preview fixtures and bridge stub (never in production builds)                                                                         |

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

- **Least privilege:** `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`. No write scopes until remediation (M8), and then only with explicit approval in the UI.
- **asUser everywhere:** users only see Jira data they can already browse. No app-level credentials reach the browser.
- **No client JQL:** the browser sends enum values; the backend builds the query.
- **Errors are explicit:** resolvers never throw to the client and never fabricate success. Unknown readiness stays "Not assessed".
- **Tenant isolation:** no storage yet. When Forge Storage arrives (M5) it is per-installation by platform design.
- **CSP:** only `styles: unsafe-inline` (required by Atlaskit). No external fetch or fonts.
- **Data separation:** every entity carries `origin: 'live' | 'demo'`, rendered as a visible label.

## Jira APIs used

| Call                                                                              | Scope            | Purpose                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /rest/api/3/search/jql`                                                      | `read:jira-work` | Recent issues (summary, status, type, updated, project)                                                               |
| `GET /rest/api/3/myself`                                                          | `read:jira-user` | Connection check (display name only is returned to the UI)                                                            |
| `GET /rest/api/3/issue/{key}?fields=summary,description,status,issuetype,updated` | `read:jira-work` | Change analysis (M3): one change, description flattened from ADF (`src/jira/adf.ts`)                                  |
| `GET /rest/api/3/issue/{key}/remotelink`                                          | `read:jira-work` | Change analysis (M3): remote links (title, http(s) URL) as cross-references; a 404 (issue linking off) means no links |

## Confluence APIs used

Both run `asUser`. The browser sends enumerated recovery terms and an optional validated space key; the resolver builds the CQL. A 404 is reported as `NOT_FOUND` ("Confluence is not available on this site") because the demo site may not have Confluence.

| Call                                              | Scope                  | Purpose                                                       |
| ------------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `GET /wiki/rest/api/search` (CQL, v1)             | `search:confluence`    | Find recovery pages: id, title, space key, last updated, link |
| `GET /wiki/api/v2/pages/{id}?body-format=storage` | `read:page:confluence` | Read one page body; plain-text excerpt and ordered steps      |

### Change analysis (M3, `analyzeChange` resolver)

`src/analysis/analyzeChange.ts` orchestrates, with the pure engine (`shared/analysis`) injected as an `AnalysisEngine`. The browser sends only `{ issueKey }` (validated with the issue key pattern). Steps, all `asUser`, no AI:

1. Read the issue and its remote links. Any Jira failure is an `ApiResult` error.
2. The engine extracts change subjects. None: the engine's `not-assessed` result is returned and Confluence is not called.
3. Subject search terms from the engine are re-validated (`^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$`, at most 5) and quoted with `cqlString`: `type = page AND (text ~ "runbook" OR text ~ "recovery" OR text ~ "failover" OR text ~ "disaster recovery") AND (text ~ "<term>" OR ...)`, limit 25.
4. Up to `MAX_RUNBOOKS_READ` (5) pages are read with the same storage-to-text mapping as `getRecoveryProcedure`. Pages not read (limit, permission, any error) count as `coverage.pagesSkipped`.
5. A Confluence search failure, or no page read, gives `not-assessed` with `notAssessedReason` and the subjects kept, never an error that hides the subjects and never `no-findings`.

Text is quoted as retrieved. The only change is whitespace: block boundaries and hard breaks end a line, whitespace and control characters within a line collapse to one space, empty lines are dropped. No list or heading markers are added. ADF limits: depth 32, 10,000 nodes, 50,000 characters.

## Planned integrations

Confluence pages and JSM services (M2), readiness analysis (M3), Teamwork Graph (M4/M9), Rovo agent and actions (M6), Forge Realtime crisis room (M7), Jira remediation with approval (M8), Atlassian MCP `rovo:mcp` tools (M9).
