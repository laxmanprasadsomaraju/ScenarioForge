# M6 Phase 2 live test (rovo-test)

Build: `rovo-test/phase2` @ abbe8d6, app 2.2.0 on `rovo-test` (installation 64f87111-…). Variables: `SF_ROVO_TEST_STORAGE=enabled`, `SF_ROVO_TEST_USER_DAILY_CAP=300`, `SF_ROVO_TEST_AI` unset (AI off). Extra usage off (owner).

## Block A: AI off (2026-11-11, owner)

| #   | Agent                 | Prompt                                             | Result                                                                                                                                                                                                                           |
| --- | --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Recovery Investigator | What recovery risks does this change have?         | **Passed (user-facing)**: "usage limit stopped the check… AI features are switched off… a site admin has not enabled ScenarioForge agents yet". No findings, no evidence, nothing assessed; separate Rovo chat-credit note shown |
| A2  | Exercise Facilitator  | Explain the outcome of rehearsal demo-session-0001 | **Passed (user-facing)**: same message; nothing assessed                                                                                                                                                                         |

**Logs** (`forge logs -e rovo-test --since 24h`): no errors, no account ids, emails or names. The AI-off path returns before any Jira, Confluence or storage call and writes no log line, so the logs contain no entry for these invocations. The "stopped before reads" claim rests on the action's own response text and on `test/agentForge.test.ts` (zero gateway calls when AI is off), not on log evidence.

**Credits:** pending owner figures (before/after).

## Blocks B–D

Not run. AI activation not yet approved.
