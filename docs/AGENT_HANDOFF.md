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

## M8 write gateway (Lane A, branch `m8/write-gateway`, from `606347c`)

Code complete, Automated tests passed (see [M8_PLAN.md](M8_PLAN.md) section 14). Owner approved code, mock tests and local integration only. Flag `SF_REMEDIATION_WRITE` (off) plus `SF_STORAGE`; manifest and package files unchanged; no deploy, no real Jira call. Next safe action: lead review and merge; real writes need the separately approved `write-test` environment.

## M8 server-issued approvals (Lane A, branch `m8/server-approvals`, from `054195d`)

Code complete, Automated tests passed (see [M8_PLAN.md](M8_PLAN.md) section 15). Approvals are issued and stored by the server (approver from context, time from server clock, bound to request hash, project, source state), single use with versioned writes; the browser sends only an approval id. Partial-failure text fixed. Owner-approved code task only: manifest and package files unchanged vs `054195d`, no deploy, no Jira/Confluence call, no Rovo, writer still disabled. Next safe action: lead review and merge into the release line; real writes still need the separately approved `write-test` environment.

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

## Handoff 2026-11-11 (Lane 2, `m78/integration` from `release/judged-full` @ 13513d5)

M8 browser create path and M7 lifecycle integration tests added; docs updated. No manifest, scope, entity, env, deploy or Jira/Confluence change. Not merged anywhere. Pending owner approvals (none given): `crisis-room` entity + `SF_STORAGE`/`SF_CRISIS` on a named test env; `write:jira-work` + `remediation-item` entity on a separate write-test env ([proposals/M8_TEST_DEPLOY.md](proposals/M8_TEST_DEPLOY.md)); Realtime. Next safe action: owner reviews [proposals/M7_STORAGE_SCHEMA.md](proposals/M7_STORAGE_SCHEMA.md).

## Lane 3 handoff (2026-11-11, branch `release/judged-full-validation`, based on `release/judged-full` @ `13513d5`)

Changed: MCP tool matrix tests; Teamwork Graph ARI/site-id hardening plus tests; log-hygiene fix and test; docs: `M9_MCP_EXTERNAL_TEST.md`, `scripts/mcp-external-check.mjs` (not run), `proposals/M9_MARKETPLACE_OPTIONS.md`, `proposals/M10_RELEASE_VALIDATION.md`, `submission/DEMO_SCRIPT.md`, `submission/BONUS_EVIDENCE_CHECKLIST.md`, TWG approval requests. No deploy, install, scope, variable, Rovo or Jira/Confluence write. No approvals were granted or inferred.

Pending owner decisions: drop `remediation-item` (and probably `crisis-room`) before any first deploy; Marketplace option A or B by 27 Nov; Devpost rules check (Marketplace bonus existence, second app id); everything in BONUS_EVIDENCE_CHECKLIST.

Next safe action: owner reviews M10_RELEASE_VALIDATION.md; do not merge this branch anywhere without the F2 exception.

## Handoff 2026-11-11 (integration lane, `release/judged-full-integrate`)

Base `release/judged-full` @ 13513d5 (rollback point). Merged `rovo-test/phase2-confluence-403` (e8550cd), `rovo-test/deeplinks` (850f363), `m78/integration` (ad3d3e0), `release/judged-full-validation` (3ec8633). One code conflict (`src/agents/forge.ts`: kept `siteAiEnabled` from the release plus `linkBase`); one test fix (`test/mcpTools.test.ts` passes `linkBase`). Docs conflicts kept both sections. Manifest and package.json identical to 13513d5. Automated tests passed: 1112 root, 186 app; prettier, Hallmark, audit 0 and forge lint (0 errors, 1 pre-existing approval notice) clean. Not deployed, not live verified, not merged anywhere. No approvals granted or inferred. Next safe action: owner review, then lead decides on moving `release/judged-full`.

## Handoff 2026-11-11 (Lane B security hardening, `sec/hardening` from `release/judged-full` @ 606347c)

Done: AST log-hygiene checker (`test/helpers/logCheck.ts`) replacing the regex test; Crisis Room client payloads use opaque per-room participant ids (`participantId`; `assign-role` and `hand-off-command` take `participantId` / `toParticipantId`); `forgeLinkBase` cached via `createLinkBaseResolver`. Manifest and package files unchanged. Automated tests passed: root and app suites, prettier, Hallmark, audit 0. `forge lint` not run (CLI not installed in this worktree). Not deployed, not live verified, not merged. No approvals granted or inferred. Next safe action: lead reviews the branch and runs `forge lint`.

## Handoff 2026-11-11 (integration lane, `release/judged-full-integrate2`)

Base `release/judged-full` @ 606347c (unmoved rollback point). Merged `m8/write-gateway` (0dbb5c1), `sec/hardening` (5bfd27d), `release/quality` (96713e7); no conflicts. Added `test/historyRemediationIsolation.test.ts` and a no-account-id assertion in `test/remediationCreate.test.ts`; removed stray `src/agents/actions.ts-E`. Status: Automated tests passed (see [proposals/M10_RELEASE_VALIDATION.md](proposals/M10_RELEASE_VALIDATION.md)). No deploy, install, variable, scope, entity or manifest change. Flag-rename upgrade note: rovo-test reads `SF_ROVO_TEST_*`; this code reads `SF_STORAGE`/`SF_AI`/`SF_CRISIS`/`SF_TWG`/`SF_REMEDIATION_WRITE`, so rovo-test variables do not carry over. No owner approvals given or inferred. Next safe action: lead review.
