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
