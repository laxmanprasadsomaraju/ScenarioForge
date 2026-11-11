# Codegeist 2026 requirements

Single entry point for contest requirements. Sources and wording stay in the existing docs; this page does not duplicate them:

- [CONTEST_COMPLIANCE.md](CONTEST_COMPLIANCE.md): tracks, cited sources, originality, judge installation.
- [CONTEST_RULES_CHECKLIST.md](CONTEST_RULES_CHECKLIST.md): line-by-line rules checklist with "confirmed on page" column.
- [BONUS_FEASIBILITY.md](BONUS_FEASIBILITY.md): per-bonus design, effort and risks.

## Key dates

| Item                | Date                  | Verification                                                                                                                              |
| ------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Submission deadline | 22 Dec 2026, 12:00 PT | Atlassian community announcement (cited in CONTEST_COMPLIANCE). Devpost rules page **unverified** (blocks automated fetch; owner to read) |
| Internal target     | 18 Dec 2026           | Project decision                                                                                                                          |
| Judging             | 5 Jan – 3 Feb 2027    | Unverified extract                                                                                                                        |
| Demo site expiry    | 2027-02-07            | Reported by owner                                                                                                                         |

## Main track (Apps for Software Teams)

Needs: working Forge app, installation link usable by judges through judging, video under five minutes (unverified length), Devpost write-up. Status: app working on `confluence-test`; distribution link, video and write-up Not started (see [CURRENT_STATUS.md](CURRENT_STATUS.md)).

## Bonus-readiness matrix

At most one bonus prize per submission (unverified extract).

| Bonus               | Requirement (our reading)                            | Implementation                                                        | Live proof                                         | Missing                                                         | Permissions                           | Admin prerequisites                                     | Evidence                                                                                           | Risks                                                                     |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Best Rovo Agent     | `rovo:agent` with real actions                       | Two agents, four `GET` actions on `rovo-test/phase2` @ `abbe8d6`      | Phase 1 probes only; Phase 2 deployed, **not run** | Phase 2 live test with AI on; video; agents on the judged build | none new (`storage:app` on rovo-test) | Rovo active on site; owner approves AI opt-in + credits | RT1 `M6_PHASE1_ACCEPTANCE.md`, RT2 `M6_PHASE2_TEST_SCRIPT.md`                                      | Credits; judges' sites may lack Rovo; storage scope makes a major version |
| Best MCP App        | `rovo:mcp` module exposing real tools                | None (plan: re-expose the four read-only actions)                     | none                                               | Module, test, demo                                              | `rovo:mcp` (Preview)                  | Site admin enables external MCP clients                 | [BONUS_FEASIBILITY.md](BONUS_FEASIBILITY.md) §3                                                    | Preview module; hard to demo without Rovo                                 |
| Best Teamwork Graph | Real Teamwork Graph API calls whose results are used | Graph contract/validator ready for owning-team edges (`shared/graph`) | none; `graph-test` deployed, not installed         | Probe, scopes, edges with TWG evidence                          | `read:graph:*` scopes                 | Org admin; possibly per-env key                         | [M4_PERMISSIONS.md](M4_PERMISSIONS.md), [TEAMWORK_GRAPH_TEST_PLAN.md](TEAMWORK_GRAPH_TEST_PLAN.md) | Preview API; silent empty results on missing scopes                       |
| Best Marketplace    | Listing link or review ticket                        | None                                                                  | none                                               | Listing, KYC, review                                            | n/a                                   | Partner account, KYC                                    | [MARKETPLACE_PLAN.md](MARKETPLACE_PLAN.md)                                                         | Blocks installation-link sharing of that app; 1–3 week review             |

Recommended order: Rovo Agent first (closest), MCP second. Marketplace only on the owner's explicit decision.
