# M4 / M5 live test: readiness graph and rehearsal from a real finding

Environment: `confluence-test` (installation `99a01e9b-c4c3-4634-94c4-634f521b7087`), app version 2.3.0, built from `m4/readiness-graph` @ `704ec89`. No new scopes (manifest identical to the approved M2 build). `development` unchanged at version 2.

Run by the owner on 2026-11-10 against MC-62 (`[DEMO] Retire LegacyAuth backup SSO tenant`) and `[DEMO] RB-AUTH-01 Customer sign-in recovery`.

## M4: readiness graph and impact path

| #   | Check                                                                                         | Result                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MC-62 → LegacyAuth → RB-AUTH-01 step 3 → RB-AUTH-01 page, and LegacyAuth replaced by NimbusID | **Passed**                                                                                                                      |
| 2   | Confidence carried from M3                                                                    | **Passed**: confirmed finding shown as confirmed                                                                                |
| 3   | Evidence controls and source links present                                                    | **Passed** (displayed). Not every expanded evidence panel was opened live; expanded content is covered by `ImpactPath.test.tsx` |
| 4   | JSM and Teamwork Graph shown as not connected                                                 | **Passed**                                                                                                                      |
| 5   | No invented service or owning team                                                            | **Passed**: service and team shown as not assessed                                                                              |
| 6   | Coverage and pages checked shown                                                              | **Passed**                                                                                                                      |

## M5: rehearsal from the finding, fix and retest

| #   | Run                                    | Owner's path                                                                                               | Result                                                                                                                                        |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First rehearsal, restore target 30 min | Followed step 3 as written (modelled failure), checked the LegacyAuth change, notified late, used NimbusID | **Passed**: 26 simulated minutes, 3 of 4 objectives; notify deadline missed                                                                   |
| 2   | Fix                                    | Approved only "replace LegacyAuth with NimbusID in step 3"                                                 | **Passed** (demo approval)                                                                                                                    |
| 3   | Targeted retest                        | Followed the corrected step, posted the update                                                             | **Passed**: 11 simulated minutes, 4 of 4 objectives, verdict "Gap resolved"; report showed evidence, timeline, corrected step and applied fix |

These figures match the deterministic engine: the same choices reproduce the same minutes and verdict (covered by `test/rehearsalGenerate.test.ts` and `static/app/test/RehearseFinding.test.tsx`).

## Limitations (stated, not hidden)

- Rehearsal times and outcomes are modelled by fixed rules from the finding. They are not measurements of a real recovery.
- Approving a fix is a demo action inside the rehearsal. No Confluence page was edited and no Jira work item was created; real remediation is M8.
- Services and owning teams are not assessed until a JSM or Teamwork Graph source is approved and verified.
- Not every expanded evidence control was opened in the live run.
- Rehearsals and their reports are kept in the browser tab only; persistence needs `storage:app` (deferred to M6).

## Acceptance (2026-11-10)

- **M4: accepted for the Change → subject → runbook step → runbook page path** with evidence and honest gaps. Service and team links remain open (sources pending approval).
- **M5: accepted for "rehearse a real finding"**: deterministic generation from the real change and step, Detect → Rehearse → Fix → Verify completed live. Persistence and live service tiers remain open.
