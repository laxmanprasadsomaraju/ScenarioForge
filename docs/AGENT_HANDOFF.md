# Agent handoff

Update at the end of every session. Last update: 2026-11-11 (Lane QA, branch `qa/review-1`).

## Key branches

| Branch                     | SHA                 | Role                                                                                                                                                |
| -------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature/m0-m1-foundation` | `d279245`           | Remote default branch; M1 as deployed to `development`                                                                                              |
| `integration/lanes-1`      | `26076b1`           | Integration: lanes, UI redesign, sidebar fix, M7 core, M9 TWG (flag off), Marketplace drafts; `confluence-test` 2.6.0 deployed from `1a517f9`       |
| `qa/review-1`              | on top of `26076b1` | Lane QA review fixes (combined JSM + TWG service cap)                                                                                               |
| `m9/mcp`                   | `c2b28fc`           | M9 MCP; Code complete, not merged (needs `rovo:mcp` approval)                                                                                       |
| `rovo-test/build`          | `77e1262`           | M6 Phase 1 (probes) + acceptance doc; rovo-test only                                                                                                |
| `rovo-test/phase2`         | `abbe8d6`           | M6 Phase 2 agents; deployed to `rovo-test`; never merge into other envs                                                                             |
| `ui/sidebar-fix`           | `980b2db`           | Merged at `1a517f9`; Deployed to `confluence-test` 2.6.0; Accepted for primary functionality ([UI_SIDEBAR_ACCEPTANCE.md](UI_SIDEBAR_ACCEPTANCE.md)) |
| `m7/crisis-room-core`      | `0eabd5c`           | M7 core engine; merged at `c91f644`; Automated tests passed                                                                                         |
| `docs/project-memory`      | this PR             | Project memory and milestone audit                                                                                                                  |

Older lane branches (`lane-*`, `ui/c1…ui/e-polish`, `ui/redesign*`) are merged into `integration/lanes-1`. There is no `main` branch on the remote.

## Active work

- Sidebar fix Accepted (6 live checks on confluence-test 2.6.0). Pending, not live-verified: 600px-tall viewport, 200% zoom, drawer focus trap/restore, theme persistence after reload.
- M7 crisis room: core engine merged (Automated tests passed); UI and Realtime Not started.
- M9: TWG merged behind `SF_TWG` (off); MCP on `m9/mcp` @ `c2b28fc`; Marketplace drafts merged.
- Lane QA review on `qa/review-1`.
- M6 Phase 2 live test waiting on owner.

## Approval proposals (docs lane, 2026-11-11, branch `docs/approval-proposals`)

Each has an APPROVAL REQUEST block for the owner. None is approved.

- [proposals/M10_JUDGING_RELEASE.md](proposals/M10_JUDGING_RELEASE.md): production deploy of `integration/lanes-1` (four scopes), Sharing link, second-site test, tag, rollback.
- [proposals/M7_TEST_DEPLOY.md](proposals/M7_TEST_DEPLOY.md): `crisis-room` entity + Realtime on `rovo-test`.
- [proposals/M8_TEST_DEPLOY.md](proposals/M8_TEST_DEPLOY.md): `storage:app` + `write:jira-work` on a new isolated `write-test` env (supersedes `confluence-test` in M8_PLAN §12).
- [proposals/M9_MARKETPLACE_ELIGIBILITY.md](proposals/M9_MARKETPLACE_ELIGIBILITY.md): support questions, two app ids, listing gaps, timeline.

Observed: `forge environments list` shows `confluence-test` last deployed 2026-11-11T15:41:53Z (newer than ENVIRONMENTS.md records).

## Pending owner approvals

1. Turn AI on for rovo-test (`SF_ROVO_TEST_AI=enabled`) and spend Rovo credits for the Phase 2 live test (RT2 `M6_PHASE2_TEST_SCRIPT.md`).
2. Run the four pending sidebar checks on `confluence-test` 2.6.0: 600px-tall viewport, 200% zoom, drawer focus trap/restore, theme persistence after reload.
3. Any `storage:app` / Rovo modules outside rovo-test (major version, permanent entities).
4. `write:jira-work` for M8 work-item creation.
5. Confluence scopes on `development` (or retire `development`).
6. `graph-test` install with `read:graph:*` scopes; org admin for Teamwork Graph.
7. JSM Assets scopes for M4 services.
8. `rovo:mcp` module (M9).
9. Marketplace submission (decision; blocks installation link).
10. Production deploy, distribution link, Devpost submission (M10).
11. Revoke the API token exposed in chat on 2026-11-09 (owner action, open).

## Next safe actions (no approval needed)

- M7 domain model and pure-logic tests in `shared/` (no manifest change).
- M10 prep: Devpost write-up draft, video script, judge-install checklist.
- Owner reads the Devpost rules page and fills the "confirmed on page" column in [CONTEST_RULES_CHECKLIST.md](CONTEST_RULES_CHECKLIST.md).

## Handoff 2026-11-11 (lead)

No lanes running. All unblocked work for M7, M8, M9 prep and M10 docs is merged. Remaining work needs owner approvals (see docs/BONUS_READINESS.md, docs/M8_PLAN.md §12, docs/M7_PLAN.md §5, docs/submission/FINAL_CHECKLIST.md). Known small gaps: M7 observers see proposals as "A decision"; no per-user room-creation limit; M8 browser call path to the create resolver not written (first step after write:jira-work approval).

## Handoff 2026-11-11 (docs lane, branch `docs/feature-complete-release` from `integration/lanes-1` @ `a013f1e`)

- New [proposals/M10_FEATURE_COMPLETE_RELEASE.md](proposals/M10_FEATURE_COMPLETE_RELEASE.md): feature-complete judged build on app `113a7a88-…` (five scopes, four permanent entities, 2 agents, 4 actions, `rovo:mcp`; no `write:jira-work`, no `read:graph:*` recommended). Approval lines F1–F9; **none approved**.
- [proposals/M9_MARKETPLACE_ELIGIBILITY.md](proposals/M9_MARKETPLACE_ELIGIBILITY.md) "Verification 2026-11-12": Forge app-compatibility page says multiple-app apps with a required app "can only be listed on Marketplace as paid apps; free listings are not supported" — affects the listed app id. Gmail restriction confirmed only for Partner Portal access; individual KYC uncertain.
- Devpost: all four pages HTTP 403 again; owner-confirm list unchanged.
- M6 Phase 2 Block A passed (user-facing) 2026-11-11; AI activation still pending owner approval.
- Next safe action: owner reviews F1–F9 and sends support questions 1–10.

## Handoff 2026-11-11 (lead, M6 Test 3)

- `rovo-test` runs app 2.4.0 = `rovo-test/phase2-confluence-403` @ `e8550cd` (message and status-only log; manifest, five scopes, variables unchanged). Not merged anywhere.
- Test 3 on MC-62 failed safe twice; the app log shows the Confluence search returned HTTP 403. Cause (Confluence not connected to the `rovo-test` install) is probable, not confirmed. See [M6_PHASE2_LIVE_TEST](M6_PHASE2_LIVE_TEST.md).
- M6 Phase 2 is **not accepted**. Test 4 and injection Blocks B–D not run.
- Pending owner approval: the exact Confluence installation change on `rovo-test` (proposal sent in chat).
- `release/judged-full` @ `13513d5`: two documentation corrections pushed; not merged or deployed.

## Update 2026-11-11 (lead, Test 3 passed)

- Owner connected Confluence to the existing `rovo-test` installation (`64f87111…`, now Jira + Confluence, version 2). Test 3 on MC-62 **passed, live verified by the owner**. Not accepted overall: Test 4 and Blocks B–D pending.
- Minor gap: `appPath` is a relative route, so the agent shows no clickable link. Fix needs a code change and deploy (not approved).
- `rovo-test/phase2-confluence-403` (`e8550cd`, deployed as 2.4.0) is still unmerged.
- Next: owner runs Test 4 and reports the result; no injection tests before then.

## Update 2026-11-11 (lead, Test 4 passed)

- Test 4 (service impact on MC-62) passed live, owner-reported. Tests 3 and 4 are live verified for user-facing behaviour; M6 Phase 2 is not accepted.
- Next: Blocks B 5–8, C, D, E. Block B needs two synthetic fixtures (a Confluence page and a Jira issue) that only the owner may create; approval requested in chat. Credit meter reading pending from the owner.

## Update 2026-11-11 (lead, owner approval for fixtures)

- Owner approved, in their own words, hand-creating exactly three synthetic fixtures (RB-AUTH-02 page, MC-INJ issue with link, SESSION-MINE) and running user-run Tests 5 to 12. Tests 13 and 16 BLOCKED; 14 and 15 need separate approval. No deploys, scopes, MCP or other environments.
- Created ids are recorded in [M6_PHASE2_LIVE_TEST](M6_PHASE2_LIVE_TEST.md) as the owner reports them. Credit meter reading is a precondition for each group.

## Update 2026-11-11 (lead, Lane 1 deep links)

- `rovo-test/deeplinks` @ `850f363` (from `rovo-test/phase2-confluence-403`): absolute `appUrl` on find-recovery-risks, get-service-readiness and prepare-rehearsal; `explain-outcome` has none (no route for a stored outcome). **Automated tests passed** (968 root, 91 app, forge lint clean, manifest diff empty). Not deployed, not live verified.
- URL format from the Forge docs (read 2026-11-11): `{site}/apps/full-page/{installation-id}/{route-prefix}/{app-route}`. The installation id comes from the runtime (`getAppContext()`), the site from `GET /rest/api/3/serverInfo` as the user, accepted only for `https://<label>.atlassian.net`. Unverified until a live call: that `getAppContext()` works inside a Rovo action, that query strings reach the in-app router. If any piece is missing, `appUrl` is null and `appPath` remains.
- Sloplint was not run (no UI change). Not merged anywhere.
- Deployment proposal (needs owner approval): `forge deploy -e rovo-test` from `rovo-test/deeplinks`; no install, variables or manifest change; then the owner checks the link on MC-62 after Tests 9 to 12.

## Update 2026-11-11 (lead, integrated judged release)

- `release/judged-full` is now `606347c` (was `13513d5`; rollback point). It merges `rovo-test/phase2-confluence-403` (e8550cd), `rovo-test/deeplinks` (850f363), `m78/integration` (ad3d3e0) and `release/judged-full-validation` (3ec8633), plus one review fix (`buildAppUrl` canonical form). Intermediate branches: `release/judged-full-integrate` aef911c, `review/judged-full-integrate` 606347c.
- Status: **Automated tests passed** (1113 root, 186 app, prettier, sloplint, audit, forge lint 0 errors with the `storage:app` major-version notice). Independent review: no high or medium defects. Manifest, scopes, entities and package files identical to 13513d5. Not deployed; not live verified; not merged into `integration/lanes-1` or `main`.
- Review notes: one extra `serverInfo` call per successful action (no caching); crisis timeline shows actor account ids to room participants who already receive them in `participants`; `logHygiene` test is narrow.
- Pending owner approvals: deep-link deploy to `rovo-test`; M7 storage test; M8 `write-test`; MCP test; entity choices; Marketplace option and Devpost check; API token revocation.

## Update 2026-11-11 (lead, release/judged-full 054195d)

- `release/judged-full` is now `054195d` (fast-forward from `606347c`; rollback point `606347c`, earlier `13513d5`). Contents: M8 write gateway (`m8/write-gateway` 0dbb5c1), security hardening (`sec/hardening` 5bfd27d), release quality (`release/quality` 96713e7), merged as `release/judged-full-integrate2` 9a0a4fd, plus four low-severity review fixes (`review/integrate2` 054195d).
- Status: **Automated tests passed** (1160 root, 199 app, prettier, sloplint, audit, forge lint 0 errors with the `storage:app` major-version notice). Manifest and package files identical to `606347c`. Independent review found no way to write to Jira unless `SF_REMEDIATION_WRITE` and `SF_STORAGE` are both exactly `enabled`, and the manifest has no write scope. Not deployed, not live verified.
- Review fixes: stored work item no longer revealed to a different request for the same label; log checker gaps closed; audit lines capped at 200; crisis assign-role/hand-off check seating first.
- Open design limit: approval records (`approvedAt`, `approver`) come from the browser, so the 24 h age check is forgeable. Not an escalation (actor must equal approver), but fix with server-issued approvals before any `write-test` run. Also: a created item with a failed link is never retried automatically, and the UI text "check again" is misleading.
- Upgrade note: `rovo-test` uses `SF_ROVO_TEST_*`; this code reads `SF_STORAGE`, `SF_AI`, `SF_CRISIS`, `SF_TWG`, `SF_REMEDIATION_WRITE`.
- Owner Facilitator Tests 9 to 12 still pending; `rovo-test` untouched.

## Update 2026-11-12 (lead)

- `rovo-test` now runs app **2.5.0** = `rovo-test/session-id` @ `9d442d6` (= deployed 2.4.0 `e8550cd` + a History "Session ID" row with Copy button; UI only). Owner-approved. Manifest, scopes, entities and variables unchanged (`SF_ROVO_TEST_AI`/`STORAGE`/`USER_DAILY_CAP` as before). Deployed; not yet live verified. Needed for Test 12. Not the deep-link build.
- `release/judged-full` is now `e70de12` (fast-forward from `054195d`): server-issued approvals, manifest variants (undeployed files in `manifests/`), log-checker hardening, plus two review fixes (stored work item not revealed to a different approver; stdout/stderr writes checked). Automated tests passed (1222 root, 200 app); independent review: no critical or high defects. Rollback points: `054195d`, `606347c`, `13513d5`.
- Open (low): approval records grow without a cap (needs a cap or cleanup before any write-test); real Forge KVS conditional-write behaviour unverified.
- Pending: owner Test 12 and the Test 11 link address; `ui/history-session-id` (54d9a18) is the judged-line version of the Session ID row, not yet merged into `release/judged-full`.
