# M6 Phase 2 live test (rovo-test)

Build: `rovo-test/phase2` @ abbe8d6, app 2.2.0 on `rovo-test` (installation 64f87111-…). Variables: `SF_ROVO_TEST_STORAGE=enabled`, `SF_ROVO_TEST_USER_DAILY_CAP=300`, `SF_ROVO_TEST_AI` unset (AI off). Extra usage off (owner).

## Block A: AI off (2026-11-11, owner)

| #   | Agent                 | Prompt                                             | Result                                                                                                                                                                                                                           |
| --- | --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Recovery Investigator | What recovery risks does this change have?         | **Passed (user-facing)**: "usage limit stopped the check… AI features are switched off… a site admin has not enabled ScenarioForge agents yet". No findings, no evidence, nothing assessed; separate Rovo chat-credit note shown |
| A2  | Exercise Facilitator  | Explain the outcome of rehearsal demo-session-0001 | **Passed (user-facing)**: same message; nothing assessed                                                                                                                                                                         |

**Logs** (`forge logs -e rovo-test --since 24h`): no errors, no account ids, emails or names. The AI-off path returns before any Jira, Confluence or storage call and writes no log line, so the logs contain no entry for these invocations. The "stopped before reads" claim rests on the action's own response text and on `test/agentForge.test.ts` (zero gateway calls when AI is off), not on log evidence.

**Credits (owner, 2026-11-11):** usage bar shows 40 used of 195,000 (≈194,960 remaining); the "Credits this period" chart shows 20, so Atlassian's displays disagree. Extra usage confirmed OFF. Conservative baseline for Phase 2 monitoring: **40**. Stop if additional measured use reaches 400.

## AI activation (2026-11-11)

Owner approved `SF_ROVO_TEST_AI=enabled` on rovo-test only. Set and deployed the same build (abbe8d6, five scopes) as app 2.3.0 at 2026-11-11T16:36Z. Variables now: SF_ROVO_TEST_AI=enabled, SF_ROVO_TEST_STORAGE=enabled, SF_ROVO_TEST_USER_DAILY_CAP=300. development and confluence-test unchanged. MCP not enabled.

## Test 3: MC-62 recovery risks (2026-11-11, owner, Recovery Investigator)

Status: **Failed safe, not accepted.** Prompt: "What recovery risks does this change have?"

| Run | App version                                                       | Result                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2.3.0 (abbe8d6)                                                   | "Runbooks were not checked: You do not have permission to view this Confluence content." No finding.                                                                                                                                                |
| 2   | 2.4.0 (e8550cd, diagnostic build, owner-approved, rovo-test only) | "Runbooks were not checked: Confluence refused access (HTTP 403): Confluence may not be connected to this ScenarioForge installation, or you do not have permission to view this content." `status=not-assessed`, `findings=[]`, `pagesChecked=[]`. |

Observed (owner-supplied invocation record plus `forge logs -e rovo-test`):

- Rovo invoked `find-recovery-risks` with `{"changeKey":"MC-62"}`; status PLUGIN_FINISHED, 3573 ms, model gemini-3-flash-preview. The action ran.
- App log, status only: `{"event":"runbook-search-refused","code":"FORBIDDEN","upstreamStatus":403}` at 2026-11-11T16:55:26Z (matches the invocation timestamp) and again at 16:56:32Z (a second invocation; not described by the owner).
- So the Confluence search call really returned **HTTP 403**. The code did not misclassify it.
- `forge install list`: `rovo-test` is connected to Jira only; `confluence-test` is connected to Jira (required) and Confluence.

Cause: **probable, not confirmed.** The missing Confluence connection fits all the evidence, but a 403 is the same for an unconnected product and for a user without page access, and neither has been separated by a test. Not yet checked: the user's access to the SFDEMO space (the same user passes on `confluence-test`, which points away from a permission cause).

Nothing was invented: no finding was produced. Retest after the connection is corrected, then Test 4, before any injection tests.

## Blocks B–D

Not run. Waiting for Test 3 to pass on MC-62, then Test 4.
