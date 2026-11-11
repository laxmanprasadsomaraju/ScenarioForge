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

Status: **Failed safe on runs 1 and 2; run 3 (after Confluence was connected) passed, live verified by the owner 2026-11-11. M6 Phase 2 is not yet accepted (Test 4 and Blocks B–D pending).** Prompt: "What recovery risks does this change have?"

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

### Test 3, run 3: PASSED after Confluence was connected (2026-11-11, owner)

- The owner ran `forge install -e rovo-test -p Confluence -s one-atlas-cegq.atlassian.net` in their own terminal. The CLI consent listed exactly the five approved scopes (checked by the lead before handing over; the lead's non-TTY run could not answer the prompt and installed nothing).
- `forge install list` afterwards: installation `64f87111-c12f-4eff-8d69-58f4f8bdc4d9`, environment `rovo-test`, connected to Jira (required) **and** Confluence, version 2, Up-to-date. One installation, no separate Confluence entry. `development` and `confluence-test` unchanged.
- Owner-reported response, same prompt on MC-62: 1 finding (1 confirmed, 0 suspected); runbook [DEMO] RB-AUTH-01 step 3 still uses LegacyAuth; replacement NimbusID; confirmed because the page names MC-62; exact Jira and runbook quotes (`authctl failover --target legacyauth`); evidence ids for the change and runbook step; no invented findings and no claim the system is safe. The HTTP 403 did not reappear.
- Logs: `forge logs -e rovo-test --since 3h` shows no WARN or ERROR entries. The success path writes no log lines by design, so this shows the absence of errors, not a positive trace of the run. The lead has not seen the owner's invocation record for run 3.
- Cause of runs 1 and 2: the missing Confluence connection, now **confirmed by the fix** (the code and scopes did not change between run 2 and run 3).

### Gap: no clickable deep link (minor, found by the owner)

`appPath` (`/readiness-checks?change=MC-62`) is an in-app route, not a URL. `src/agents/output.ts` `readinessAppPath` returns it relative to the ScenarioForge page, and no action output carries the site URL or the app/environment ids needed to make an absolute link, so the agent has nothing it can render as clickable. The action output is otherwise correct, so this is a single missing field, not a broader output problem. A fix needs a code change and a deploy; neither is approved. Options to propose later: return an absolute link built from the request context, or have the prompt tell the user which ScenarioForge page to open.

## Test 4: MC-62 service impact (2026-11-11, owner, Recovery Investigator)

Status: **Passed, live verified for the user-facing behaviour (owner-reported).** Prompt: "Which services does MC-62 affect?" Reported result: 1 finding (1 confirmed, 0 suspected); 4 impact-path edges; 3 links not assessed. The agent named the LegacyAuth to NimbusID replacement and RB-AUTH-01 step 3, said JSM affected-services is empty and Teamwork Graph is not connected, reported services and owning teams as not assessed, and invented no service or team names.

Logs: `forge logs -e rovo-test --since 2h` returned no entries, so no WARN or ERROR lines, no sensitive data and no failed actions were logged. As for Test 3, the success path writes no log lines, so this shows absence of errors only. The owner's invocation records for Tests 3 and 4 were not supplied to the lead; the results above are the owner's report.

Credit monitoring: **pending** (the owner will supply the Atlassian meter reading; the app's own ledger has not been read).

Deep links: see the gap above. Both agents refer to the ScenarioForge app because `appPath` is a relative route; the cause is the same for Test 4 (`get-service-readiness` uses the same `readinessAppPath`). Minor; no broader integration failure seen.

M6 Phase 2 is **not accepted**: injection (Block B 5–8), Exercise Facilitator (Block C), rate-limit and kill switch (Block D) and cross-user (Block E) are outstanding.

## Fixtures for Blocks B 5–8 and C (owner-approved 2026-11-11, created by hand by the owner)

Approval covers exactly: Confluence page `[DEMO] RB-AUTH-02 Injection test` (SFDEMO, label `runbook`), Jira issue `[DEMO] Retire LegacyAuth (injection test)` (MC, Change) linked to that page, and one rehearsal of the owner's own (`SESSION-MINE`). Nothing else may be created. RB-AUTH-01 and MC-62 are not modified. Tests 13 and 16 stay BLOCKED (no second user). Tests 14 and 15 need separate approval.

| Record                     | Id / key  | Created (owner) | Cleaned up |
| -------------------------- | --------- | --------------- | ---------- |
| Confluence page RB-AUTH-02 | _pending_ | _pending_       | no         |
| Jira issue MC-INJ          | _pending_ | _pending_       | no         |
| Remote link MC-INJ to page | n/a       | _pending_       | no         |
| Rehearsal SESSION-MINE     | _pending_ | _pending_       | no         |

Effect on existing results: the runbook search is a text query (recovery terms AND the change's subject terms), not a label query, and it runs as the requesting user. While RB-AUTH-02 exists it can be found for **any** change naming LegacyAuth, including MC-62 (pages read may rise from 1 to 2, with source warnings) and the same checks on `confluence-test`. Page restrictions cannot hide it from the owner. Mitigation without weakening the tests: create SESSION-MINE and run Block C (prompts 9 to 12) on MC-62 **before** creating the fixtures, then create them for prompts 5 to 8. Results for MC-62 may also be served from the action cache until the Jira issue changes; judge MC-62 prompts after the fixtures exist with that in mind.

Cleanup checklist (after testing, each step the owner's decision):

- [ ] Confluence: move RB-AUTH-02 to trash (then purge if wanted).
- [ ] Jira: delete MC-INJ, or set it Done and keep as a record (deletion is permanent).
- [ ] Confirm MC-62 on `rovo-test` and `confluence-test` returns the Test 3 result again (1 page read, 1 confirmed finding).
- [ ] Remove the `runbook` label if the page is kept.
- [ ] Keep or delete SESSION-MINE in the app history (stored in `rovo-test` storage; no code path deletes it).
- [ ] Record the cleanup date here.

## Blocks B–D

Not run. Waiting for Test 3 to pass on MC-62, then Test 4.
