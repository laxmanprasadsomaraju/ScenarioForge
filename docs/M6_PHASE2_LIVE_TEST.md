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

## Blocks B–D

Not run. First two AI-on prompts (3 and 4) issued to the owner; nothing further until the owner confirms results.
