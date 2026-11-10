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
- [x] **App opened inside Jira and live issues seen** (2026-11-09, owner in Jira dark mode: "Connected to Jira as laxman prasad somaraju", live MC-10, MC-9, MC-7, MC-42 with real statuses; no resolver error lines in `forge logs` over 2 h)
- [ ] Developer console monitoring shows successful `resolver` invocations (owner to confirm; not readable from the CLI)
- [ ] Changes page "Fetched … with `updated >= …`" line seen in Jira (owner to confirm)
- [ ] Demo rehearsal played to the debrief inside Jira (verified in local preview and unit tests; owner to confirm in Jira)
- [ ] Permission-denied path observed live (verified in unit tests and preview only)

## M2: Jira, Confluence and JSM context, Done for Confluence (JSM pending)

- [x] Confluence recovery-page search and page read as the user (`search:confluence`, `read:page:confluence`), live-verified on `confluence-test` 2026-11-10
- [x] Ordered-step extraction; no guessing when a page has no numbered list (live)
- [x] Evidence with source link, page updated and read-at times (live)
- [x] Space filtering and input validation (live and automated)
- [x] Permission-denied handling (automated only; live revocation deferred, see docs/M2_CONFLUENCE_TEST.md)
- [ ] JSM services and owners
- [ ] Confluence scopes on the `development` install (needs owner approval: major version, consent)

## M3: Change-to-recovery intelligence, Done (live-verified on confluence-test)

- [x] Deterministic, AI-free engine: subjects (retire, replace, migrate, rename, disable, upgrade), step matching with word boundaries, confirmed only with an explicit cross-reference
- [x] Cancelled, historical, partial, replacement-only and ambiguous changes handled; 34 labelled synthetic cases, precision 1.000, recall 0.923
- [x] Exact quotes from Jira and Confluence (tested as substrings of the source)
- [x] "No findings" reported with coverage, never as a pass; unreadable or step-less runbooks give "Not assessed"
- [x] Readiness checks screen with Confirmed / Suspected / Not assessed in words
- [x] Live test on real Jira and Confluence: MC-62 suspected then confirmed, MC-63 and MC-42 not assessed (docs/M3_LIVE_TEST.md)
- [x] Evidence: runbook links, pages checked, Jira summary and link in every analysis

## M4: Recovery readiness graph, Partly done (path live-verified; services and teams pending sources)

- [x] Evidence-backed graph contract and validator (no edge without evidence, no invented service or team)
- [x] Impact path on the readiness check, live-verified on MC-62 (docs/M4_M5_LIVE_TEST.md)
- [x] Unassessed links and source status shown in words
- [ ] Service links from JSM (no-new-scope field probe in progress; Assets scopes need approval)
- [ ] Owning teams from Teamwork Graph (scopes and org admin need approval)

## M5: Interactive recovery simulation, Partly done (rehearse a real finding live-verified)

- [x] Deterministic engine, remediation variants, targeted retest, replay and audit
- [x] Rehearsal generated from a real M3 finding (real change text and runbook step; restore target from the user)
- [x] Detect → Rehearse → Fix → Verify completed live on MC-62: 26 min 3/4 → retest 11 min 4/4, "Gap resolved"
- [ ] Persisted, auditable sessions (needs `storage:app`, deferred to M6)
- [ ] Restore targets from a real service tier (needs a service source)

## M6: Rovo agent and actions

Investigator and facilitator agent with real actions. Acceptance: grounded answers cite evidence; permission checks enforced in actions.

## M7: Multiplayer crisis room

Roles, shared session, Forge Realtime events. Acceptance: two browsers see the same state; decisions attributed and replayable.

## M8: Corrective actions and verification, Partly done

Retest engine and UI verdict exist for the demo scenario. Open: Jira work-item creation with explicit approval, retest linked to a stored finding.

After-action report, Jira remediation tasks created only after explicit approval, targeted retest. Acceptance: retest result linked to the original finding.

## M9: Bonus integrations

`rovo:mcp` tools, Teamwork Graph API calls, Rovo agent eligibility, Marketplace submission, separately installable judging build.

## M10: Competition release

Security review, coverage, accessibility, judge install test, video under five minutes, Devpost write-up. Deadline: 22 December 2026, 12:00 PT.
