# Milestones

Status values: **Done** (acceptance criteria verified), **Partly done** (named criteria still open), **Not started**.

## M0: Environment and project foundation, Done

- [x] Node 24 LTS, Forge CLI 15.1.0, Git, GitHub CLI, Python 3 verified (see SETUP_STATUS)
- [x] Forge CLI authenticated; Forge AI plugin installed
- [x] App registered once (`ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355`), scaffold merged into repo root
- [x] TypeScript backend and frontend, ESLint, Prettier, Vitest
- [x] Domain model defined (`shared/domain/types.ts`)
- [x] Architecture and security model documented
- [x] GitHub Actions CI
- [x] `forge lint` clean, dependencies audited (0 known vulnerabilities after overrides)
- [x] No secrets committed (scanned before commit)

## M1: First working Forge application, Partly done

- [x] Deployed to the Forge development environment
- [x] Installed on `one-atlas-cegq.atlassian.net` (Jira)
- [x] Resolver calls Jira REST API as the user; tested with fakes for success, empty, malformed and 401/403/404/429/5xx
- [x] Dashboard with loading, empty, filtered-empty and error states (verified visually in local preview)
- [x] Changes table: key, summary, type, status, updated, link to Jira; filter and sort
- [x] Connection status
- [x] Future screens labelled as planned
- [x] Demo rehearsal with deterministic rules and tests (pulled forward from M5 as a foundation)
- [ ] **App opened inside Jira and live issues seen** (needs a signed-in browser session; see SETUP_STATUS)
- [ ] Permission-denied path observed live (verified in unit tests and preview only)

## M2: Jira, Confluence and JSM context

Read Confluence recovery pages and JSM services with user permissions; evidence references with source URLs and retrieval time. Acceptance: real runbook page shown with a link back; permission-denied page excluded, not leaked.

## M3: Change-to-recovery intelligence

Match changes to affected runbook steps. Confirmed (rule-based) vs suspected (AI) findings, separated in data and UI. Acceptance: labelled fixture set with false-positive and false-negative tests; failed analysis shows "unknown".

## M4: Recovery readiness graph

Services, changes, runbooks, owners and gaps with an explanation on every edge. Acceptance: no edge without a cited source.

## M5: Interactive recovery simulation

Scenarios generated from a real change and runbook; sessions persisted in Forge Storage; replay produces identical results. Acceptance: audit record reproduces the evaluation.

## M6: Rovo agent and actions

Investigator and facilitator agent with real actions. Acceptance: grounded answers cite evidence; permission checks enforced in actions.

## M7: Multiplayer crisis room

Roles, shared session, Forge Realtime events. Acceptance: two browsers see the same state; decisions attributed and replayable.

## M8: Corrective actions and verification

After-action report, Jira remediation tasks created only after explicit approval, targeted retest. Acceptance: retest result linked to the original finding.

## M9: Bonus integrations

`rovo:mcp` tools, Teamwork Graph API calls, Rovo agent eligibility, Marketplace submission, separately installable judging build.

## M10: Competition release

Security review, coverage, accessibility, judge install test, video under five minutes, Devpost write-up. Deadline: 22 December 2026, 12:00 PT.
