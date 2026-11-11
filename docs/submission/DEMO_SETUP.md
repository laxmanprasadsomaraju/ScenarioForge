# Demo setup (before recording)

Record against the installation that matches the judged build. Until production exists, the only fully live-proven path is `confluence-test` (installation `99a01e9b-…`, app 2.6.0).

## Data

- Confluence space `SFDEMO` with the three `[DEMO]` pages, and Jira issues MC-62 / MC-63, exactly as in [JUDGE_INSTALL_GUIDE.md](JUDGE_INSTALL_GUIDE.md). These already exist on `one-atlas-cegq` (live tests 2026-11-10).
- Start of the recording: RB-AUTH-01 **without** the `Related change: MC-62` line, so the Suspected → Confirmed step can be shown. Remove the line beforehand (owner edit by hand) or skip that beat.

## Browser

- 1920×1080 window, 100% zoom, Jira light theme. One dark-mode shot at the end.
- Close notifications, hide bookmarks bar, use a profile without personal data on screen. Do not show emails or account names.
- Pre-open tabs: ScenarioForge Readiness checks, MC-62 in Jira, RB-AUTH-01 in Confluence.

## Conditional segments (include only with live evidence by recording day)

| Segment          | Gate                                                                     | Evidence doc to cite               |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| Rovo agents      | Owner-approved AI on `rovo-test`, RT2 Phase 2 script passed and recorded | dated entry in a `*LIVE_TEST*` doc |
| MCP              | `m9/mcp` deployed with approval, MCP client call recorded                | same                               |
| Teamwork Graph   | `graph-test` live test passed (`docs/evidence/twg-live-<date>.md`)       | same                               |
| Crisis room      | UI wired and live-tested (currently engine only)                         | same                               |
| Real remediation | `write:jira-work` approved and a work item created on a test env         | same                               |

If a gate is not met, cut the segment or show a single static "Planned" card with a spoken "not yet live". Never record a mock as if it were live.

## Rehearsal choices that reproduce the live run

Restore target 30 min. First run: follow step 3 as written, check the LegacyAuth change, notify late, use NimbusID → 26 simulated minutes, 3/4 objectives. Approve only "replace LegacyAuth with NimbusID in step 3". Retest: follow the corrected step, post the update → 11 simulated minutes, 4/4, "Gap resolved" ([../M4_M5_LIVE_TEST.md](../M4_M5_LIVE_TEST.md)).
