# Agent handoff

Update at the end of every session. Last update: 2026-11-11 (Lane DOCS, branch `docs/project-memory`).

## Key branches

| Branch                     | SHA       | Role                                                                    |
| -------------------------- | --------- | ----------------------------------------------------------------------- |
| `feature/m0-m1-foundation` | `d279245` | Remote default branch; M1 as deployed to `development`                  |
| `integration/lanes-1`      | `e864c3f` | Integration of all lanes + UI redesign; deployed to `confluence-test`   |
| `rovo-test/build`          | `77e1262` | M6 Phase 1 (probes) + acceptance doc; rovo-test only                    |
| `rovo-test/phase2`         | `abbe8d6` | M6 Phase 2 agents; deployed to `rovo-test`; never merge into other envs |
| `ui/sidebar-fix`           | `e864c3f` | Local only, no commits yet; sidebar fixes after owner feedback          |
| `m7/crisis-room-core`      | `e864c3f` | Local only, no commits yet; M7 start                                    |
| `docs/project-memory`      | this PR   | Project memory and milestone audit                                      |

Older lane branches (`lane-*`, `ui/c1…ui/e-polish`, `ui/redesign*`) are merged into `integration/lanes-1`. There is no `main` branch on the remote.

## Active work

- UI sidebar fixes on `ui/sidebar-fix` (owner-reported issues on confluence-test 2.5.0).
- M7 crisis room core on `m7/crisis-room-core` (just started).
- M6 Phase 2 live test waiting on owner.

## Pending owner approvals

1. Turn AI on for rovo-test (`SF_ROVO_TEST_AI=enabled`) and spend Rovo credits for the Phase 2 live test (RT2 `M6_PHASE2_TEST_SCRIPT.md`).
2. Redeploy `confluence-test` with the sidebar fix.
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

- Finish and test `ui/sidebar-fix` locally (`npm run verify`, sloplint, keyboard checks); hand to owner for deploy approval.
- M7 domain model and pure-logic tests in `shared/` (no manifest change).
- M10 prep: Devpost write-up draft, video script, judge-install checklist.
- Owner reads the Devpost rules page and fills the "confirmed on page" column in [CONTEST_RULES_CHECKLIST.md](CONTEST_RULES_CHECKLIST.md).
