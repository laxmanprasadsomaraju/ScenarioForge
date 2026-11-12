# Current status

As of **2026-11-11**, audited from `integration/lanes-1` @ `26076b1` (plus Lane QA fixes on `qa/review-1`), `m9/mcp` @ `c2b28fc`, `rovo-test/build` @ `77e1262`, `rovo-test/phase2` @ `abbe8d6`, the live-test docs, and read-only `forge environments list` / `forge install list` / `forge variables list`.

Status vocabulary (use only these): **Not started / In progress / Code complete / Automated tests passed / Deployed / Live verified / Accepted / Blocked**. "Accepted" means the owner accepted it within the documented limits.

Docs on other branches are linked on GitHub: `RT1` = [rovo-test/build docs](https://github.com/laxmanprasadsomaraju/ScenarioForge/tree/rovo-test/build/docs), `RT2` = [rovo-test/phase2 docs](https://github.com/laxmanprasadsomaraju/ScenarioForge/tree/rovo-test/phase2/docs).

## Summary

| Milestone                          | Status                                                                                                                                                           | Evidence                                                                                                                                                                        | Limits / open                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| M0 Foundation                      | Accepted                                                                                                                                                         | [SETUP_STATUS.md](SETUP_STATUS.md), [MILESTONES.md](MILESTONES.md)                                                                                                              | none                                                                                                                     |
| M1 First Forge app                 | Accepted                                                                                                                                                         | [MILESTONES.md](MILESTONES.md) M1 (live issues seen in Jira 2026-11-09)                                                                                                         | Console monitoring and live permission-denied path owner-unconfirmed                                                     |
| M2 Jira/Confluence/JSM context     | Accepted (Confluence)                                                                                                                                            | [M2_CONFLUENCE_TEST.md](M2_CONFLUENCE_TEST.md)                                                                                                                                  | JSM not done; Confluence scopes not on `development`                                                                     |
| M3 Change-to-recovery intelligence | Accepted                                                                                                                                                         | [M3_LIVE_TEST.md](M3_LIVE_TEST.md)                                                                                                                                              | Live permission revocation not tested                                                                                    |
| M4 Readiness graph                 | Accepted (impact path); services/teams Blocked                                                                                                                   | [M4_M5_LIVE_TEST.md](M4_M5_LIVE_TEST.md), [M4_PERMISSIONS.md](M4_PERMISSIONS.md)                                                                                                | Services (JSM Assets) and teams (Teamwork Graph) blocked on sources/scopes                                               |
| M5 Simulation                      | Accepted (rehearse real finding)                                                                                                                                 | [M4_M5_LIVE_TEST.md](M4_M5_LIVE_TEST.md)                                                                                                                                        | Persistence only on rovo-test; real service-tier targets need a source                                                   |
| M6 Phase 1 (identity, storage)     | Live verified                                                                                                                                                    | RT1 `M6_PHASE1_ACCEPTANCE.md`                                                                                                                                                   | rovo-test only                                                                                                           |
| M6 Phase 2 (two read-only agents)  | Deployed                                                                                                                                                         | `rovo-test` last deploy 2026-11-10T21:36Z = `abbe8d6`; RT2 `M6_PHASE2_TEST_SCRIPT.md`                                                                                           | AI OFF (`SF_ROVO_TEST_AI` unset); live tests **not run**                                                                 |
| M7 Crisis room                     | Automated tests passed (engine, resolvers, UI; opaque participant ids; storage and `SF_CRISIS` off)                                                              | `shared/crisis`, `test/crisis.test.ts`; merged into `integration/lanes-1` at `c91f644`                                                                                          | Pure engine only: no UI wiring, no Realtime, not deployed                                                                |
| M8 Remediation and verification    | Automated tests passed (request prep, server-issued approvals and mock-tested create path, flag `SF_REMEDIATION_WRITE` off; on `release/judged-full-integrate3`) | `shared/remediation`, `src/remediation`, `test/remediation*.test.ts`, [M8_PLAN.md](M8_PLAN.md), D19                                                                             | No `write:jira-work`; nothing created; approvals live under `remediation-approval:` in `rehearsal-history`, not deployed |
| UI redesign (phases A–E)           | Live verified; sidebar Accepted (primary functionality)                                                                                                          | [UI_REDESIGN_REPORT.md](UI_REDESIGN_REPORT.md), [UI_SIDEBAR_ACCEPTANCE.md](UI_SIDEBAR_ACCEPTANCE.md): owner passed 6 live sidebar checks on `confluence-test` 2.6.0 (`1a517f9`) | Pending, not live-verified: 600px-tall viewport, 200% zoom, drawer focus trap/restore, theme persistence after reload    |
| M9 Bonus (MCP, TWG, Marketplace)   | In progress                                                                                                                                                      | TWG: Automated tests passed, merged flag-gated (`SF_TWG` off) at `6921f03`; MCP: Code complete on `m9/mcp` @ `c2b28fc` (not merged); Marketplace drafts merged at `26076b1`     | No `graph-test` installation, no `rovo:mcp` manifest change, no Marketplace submission                                   |
| M10 Release                        | Not started                                                                                                                                                      | [CODEGEIST_REQUIREMENTS.md](CODEGEIST_REQUIREMENTS.md)                                                                                                                          | Video, write-up, judge install, production deploy all pending                                                            |

App version numbers (2.2.0 on rovo-test, 2.5.0 on confluence-test) come from the deploy records reported by the lead; `forge install list` shows major version 2 on all three installs.

## Milestone audit M6–M10

### M6 Rovo agent and actions

- **Genuinely complete:** Phase 1 identity probe (`accountIdMatch: true`) and 12/12 storage probe steps passed live on rovo-test 2.1.0 (RT1 `M6_PHASE1_ACCEPTANCE.md`); 20 Rovo credits used, extra usage disabled. Agent action contracts, budget governor and grounding checks are in `shared/agents` with tests (`agentActions`, `budget`, `grounding`).
- **Partial:** Phase 2 (two agents, four `GET` actions, cap 300/user/day) is deployed to rovo-test; `SF_ROVO_TEST_AI` is unset, so every action returns `USAGE_LIMITED`. No live test run, no transcript, no credit measurement.
- **Not started:** any agent on `development`/`confluence-test`/production; `propose-remediation` action; write actions (by design none).

### M7 Multiplayer crisis room

- **Automated tests passed:** pure crisis-room core engine in `shared/crisis` (merged at `c91f644`). The UI still shows an honest "planned" Crisis room.
- **Not started:** UI wiring, shared session storage, Forge Realtime, live attribution and replay.

### M8 Corrective actions and verification

- **Complete (code + automated tests):** retest engine and verdicts (D15), live-verified on MC-62 in M5; remediation draft, ADF body, exact request fingerprint `sf-rem-<16 hex>`, trusted links, read-only duplicate check, approval model and preview UI (Lane A3, Lane B).
- **Partial:** retest linked to a stored finding works only where `storage:app` exists (rovo-test history).
- **Automated tests passed:** server-issued approvals (approver from invocation context, server clock, 24 h expiry, bound to request hash, project and source state; stored under `remediation-approval:`), mock-tested create path.
- **Not started:** deploying approval storage, `write:jira-work`, actual work-item creation, Confluence footer comment.

### M9 Bonus integrations

- **Automated tests passed:** Teamwork Graph enrichment behind `SF_TWG` (off by default), merged at `6921f03`. Lane QA (`qa/review-1`) fixed a validation failure when JSM and Teamwork Graph services together exceed `MAX_GRAPH_SERVICES`: combined services are now capped deterministically, with an unassessed note per source for the rest.
  Bonus readiness table: [BONUS_READINESS.md](BONUS_READINESS.md).
- **Code complete:** MCP on `m9/mcp` @ `c2b28fc` (not merged; needs `rovo:mcp` manifest approval).
- **In progress:** Marketplace drafts merged at `26076b1`; no submission (owner decision; blocks installation-link sharing).
- **Not started:** `graph-test` installation and live Teamwork Graph calls.

### M10 Competition release

- **Complete:** CI, dependency audit (0 known vulnerabilities, 2026-11-09), accessibility work in the UI redesign (keyboard-only MC-62 workflow test, forced-colors).
- **In progress:** manifest variants (`manifests/judged-release.yml`, `m7-test.yml`, `m8-write-test.yml`) exist as undeployed files with a test tying them to code-reachable entities.
- **Not started:** final security review, judge installation test, distribution link, demo video (<5 min), Devpost write-up, production deploy.

## Update 2026-11-11 (lead)

| Item                                   | Status                                                                                | Evidence                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Sidebar fix                            | Accepted (primary functionality); 4 edge cases pending                                | docs/UI_SIDEBAR_ACCEPTANCE.md, confluence-test 2.6.0                        |
| M7 Crisis Room (engine, resolvers, UI) | Automated tests passed; storage off in every environment; live multiplayer not tested | m7/crisis-room-ui 91a53b7 merged                                            |
| M8 creation adapter                    | Automated tests passed; hard-disabled (no writer, no write scope)                     | m8/creation-adapter 4d2cd39 merged; approval request in docs/M8_PLAN.md §12 |
| M10 submission prep                    | In progress (docs)                                                                    | docs/submission/                                                            |
| Security                               | Server logs record error names only                                                   | e1d2598                                                                     |

Integration tip after these merges: see `git log -1 integration/lanes-1`. Tests (pre-integration figures; current figures in the release-integrate handoff): 926 root, 172 app; Hallmark 0/0/0; audit 0; forge lint 0 errors.

## Update 2026-11-11 (Lane 2, `m78/integration`)

| Item                                            | Status                                                                                                                                | Evidence                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M7 Crisis Room (engine, resolvers, UI, polling) | Automated tests passed. Storage and `SF_CRISIS` off; not deployed; multiplayer NOT tested by two real users                           | `test/crisis.test.ts`, `test/crisisResolvers.test.ts`, `test/crisisLifecycle.test.ts` (5 roles, role-scoped views, proposals, commander approval, messages, hand-off, reconnect, debrief, history, isolation over the in-memory adapter), `static/app/test/CrisisRoom.test.tsx`; schema proposal [proposals/M7_STORAGE_SCHEMA.md](proposals/M7_STORAGE_SCHEMA.md) |
| M8 browser create path                          | Code complete; Automated tests passed. Build flag `VITE_SF_REMEDIATION_CREATE` off, backend writer null: nothing is ever sent to Jira | `static/app/src/lib/remediationCreator.ts`, `static/app/test/remediationCreator.test.tsx`, `test/remediationCreate.test.ts` (WRITE_NOT_PERMITTED before any read)                                                                                                                                                                                                 |

## Update 2026-11-11 (Lane 3 validation, `release/judged-full-validation`)

| Item                         | Status                                          | Evidence                                                                    |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| MCP tool matrix              | Automated tests passed (not deployed, not live) | `test/mcpTools.test.ts`, [M9_MCP_EXTERNAL_TEST.md](M9_MCP_EXTERNAL_TEST.md) |
| Teamwork Graph hardening     | Automated tests passed (flag off, no scopes)    | `test/twg.test.ts`                                                          |
| Release validation           | Automated tests passed; UI headless checks only | [proposals/M10_RELEASE_VALIDATION.md](proposals/M10_RELEASE_VALIDATION.md)  |
| Log hygiene fix              | Automated tests passed                          | `test/logHygiene.test.ts`                                                   |
| Demo script, bonus checklist | In progress (docs)                              | `docs/submission/DEMO_SCRIPT.md`, `BONUS_EVIDENCE_CHECKLIST.md`             |

## Update 2026-11-11 (integration lane, `release/judged-full-integrate3`)

Merged `m8/server-approvals` (8564c8c) and `release/manifest-variants` (4a14e75) onto `release/judged-full` (054195d) with no conflicts. Automated tests passed: root Vitest 43 files / 1220 tests, component suite 24 files / 200 tests, prettier clean, sloplint clean, `npm audit` 0 vulnerabilities, `forge lint` 0 errors (one MAJOR_VERSION_RULE approval notice against the deployed default environment). Not deployed, not live verified.

## Update 2026-11-12 (`release/unified`, from `release/judged-full` @ e70de12)

- History Session ID row + Copy merged from `ui/history-session-id` (54d9a18), no conflicts: Code complete, Automated tests passed (component tests in `static/app/test/History.test.tsx`; cross-account isolation already asserted in `test/historyResolvers.test.ts` "never shows one user the runs of another user or installation").
- M6 Test 12 routing fix: facilitator prompt Routing section, `explain-outcome` / sibling action descriptions (manifest description text only, 255-char limit respected), clearer sessionId and history-unavailable messages. Code complete, Automated tests passed (root 1230, app 204). **Not live verified**: Rovo's tool selection cannot be proven offline.
- Live test that would confirm: on rovo-test (owner-approved AI/credits only) ask the Exercise Facilitator "Explain the outcome of rehearsal <UUID from History>" and check the action log shows `explain-outcome`, not `find-recovery-risks`.

## Update 2026-11-12 (`verify/unified`, feature-retention check of `release/unified` @ 4e216a7)

- Feature-retention matrix: [proposals/UNIFIED_FEATURE_MATRIX.md](proposals/UNIFIED_FEATURE_MATRIX.md). All 11 feature rows: Automated tests passed, plus dev-preview browser checks on synthetic fixtures (not live). No functional gap against the old `rovo-test/session-id` UI; label and layout differences listed there.
- Fixed a dev-preview-only defect (Crisis room did not load in the Vite preview: `node:crypto` in the browser). Not in the Forge bundle. Two tests added. Not Live verified.
