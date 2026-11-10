# M2 isolated Confluence test

Approved by the owner on 2026-11-09: read-only scopes `search:confluence` and `read:page:confluence`, Jira required, Confluence optional, in a separate Forge environment. The working `development` install is not changed.

## Environment

| Item              | Value                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Forge environment | `confluence-test` (custom DEV environment)                                                                        |
| Branch / build    | `m2/confluence-test`                                                                                              |
| Installation      | `99a01e9b-c4c3-4634-94c4-634f521b7087`, Jira (required) and Confluence (optional) on one-atlas-cegq.atlassian.net |
| Test URL          | https://one-atlas-cegq.atlassian.net/apps/full-page/99a01e9b-c4c3-4634-94c4-634f521b7087/scenarioforge            |
| Untouched         | `development`, installation `3edeba6c-fe02-4ad8-a48a-4468dc416a08`, version 2, M1 scopes only                     |

Both environments of the same app installed side by side on one site without error (verified with `forge install list`).

## Synthetic test pages (owner creates in Confluence)

The app has read-only scopes, so it cannot create pages. Create a space named **ScenarioForge Demo** with key **SFDEMO**, then these pages. Every title starts with `[DEMO]` and every page says it is synthetic.

### Page 1: `[DEMO] RB-AUTH-01 Customer sign-in recovery`

> Synthetic runbook for ScenarioForge testing. Not a real procedure.
>
> Use this runbook when customers cannot sign in.
>
> 1. Confirm elevated sign-in failures on the auth dashboard.
> 2. Check the primary IdP status page.
> 3. If the primary IdP is unavailable for more than 5 minutes, run `authctl failover --target legacyauth`.
> 4. Post a status update to customers.

Use Confluence's numbered list (type `1.` then a space) so it is a real ordered list.

### Page 2: `[DEMO] RB-DB-02 Database failover runbook`

> Synthetic runbook for ScenarioForge testing. Not a real procedure.
>
> 1. Confirm the primary database is unreachable from two regions.
> 2. Promote the read replica in the secondary region.
> 3. Update the connection string secret.
> 4. Verify writes succeed, then notify the incident channel.

### Page 3: `[DEMO] Recovery notes without steps`

> Synthetic page for ScenarioForge testing. This page discusses disaster recovery in prose only. It has no numbered list, so ScenarioForge should not invent steps.

### Optional page 4: `[DEMO] Restricted failover runbook`

> Synthetic restricted runbook. 1. Step one. 2. Step two.

Restrict viewing to a different user only. This needs a second account on the site; with a single account the restriction cannot hide the page from you.

## Checks

| #   | Check                                                         | Expected                                                                                                                                           | Result                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open the test URL, then **Recovery plans**                    | Consent prompt for Confluence the first time, then pages 1 to 3 listed with "Live Confluence data" and a "Fetched … with `type = page AND …`" line | **Passed** (owner): "Live Confluence data", 9 pages including all 3 SFDEMO pages, fetched timestamp and the `type = page AND …` query shown. First-run consent prompt not separately observed                                                                                                       |
| 2   | Search with space key `SFDEMO`                                | Only SFDEMO pages; query shows `space = "SFDEMO"`                                                                                                  | **Passed** (2026-11-10, owner): only SFDEMO pages returned                                                                                                                                                                                                                                          |
| 3   | Search with `OPS DROP`                                        | Search disabled, inline "letters and digits only"                                                                                                  | **Automated only:** inline validation and disabled Search covered by `RecoveryPlans.test.tsx` ("validates the space key before searching"); server-side rejection covered by `confluence.test.ts`. Live check not done                                                                              |
| 4   | Open page 1                                                   | Four steps in order, step 3 mentions LegacyAuth; source, page updated and read-at times                                                            | **Passed** (2026-11-10, owner): 4 steps in original order; step 3 contains `authctl failover --target legacyauth`; source, page updated, read-at and page text shown                                                                                                                                |
| 5   | Open in Confluence                                            | Opens the real page                                                                                                                                | **Passed** (2026-11-10, owner): Open in Confluence opened the original page                                                                                                                                                                                                                         |
| 6   | Open page 3                                                   | "did not guess any steps", page text shown                                                                                                         | **Passed** (2026-11-10, owner): "did not guess any steps" message, page text, source and timestamps shown                                                                                                                                                                                           |
| 7   | Restricted page (if a second user exists)                     | Never listed for the user without access                                                                                                           | **Not possible** with a single account; covered only by `asUser` semantics and 403 mapping tests                                                                                                                                                                                                    |
| 8   | Deny consent (or revoke at id.atlassian.com → Connected apps) | "ScenarioForge needs access to Confluence", no pages shown                                                                                         | **Reviewed, deferred** (2026-11-10): not live-tested. Connected apps lists no separate ScenarioForge grant to revoke safely. Permission-denied behaviour covered by automated tests only (`confluence.test.ts` 401/403 mapping, `RecoveryPlans.test.tsx` "names Confluence when access is missing") |
| 9   | Development install (`3edeba6c…`)                             | Still version 2, Recovery plans shows the M1 build, no new consent                                                                                 | **Passed** (2026-11-10, CLI): `development` still version 2, Jira only, last deployed 2026-11-09T23:07Z (the M1 deploy); no Confluence scopes                                                                                                                                                       |
| 10  | Developer console monitoring, environment `confluence-test`   | `resolver` invocations for `listRecoveryPages` and `getRecoveryProcedure`, no errors                                                               | **Partly verified (CLI)**: `forge logs` for `confluence-test` and `development` show no resolver errors over 2 days. Invocation counts are not available from the CLI (no metrics command); developer console not checked                                                                           |

Already covered by unit tests: HTML stripping (including script and style), ordered-list extraction, nested lists, CQL injection rejection, space key validation, and HTTP 400/401/403/404/429/5xx mapping (`test/confluence.test.ts`, 85 tests; `static/app/test/RecoveryPlans.test.tsx`, 6 tests).

## Evidence log

- 2026-11-10, owner in the live `confluence-test` app: real Confluence search (9 pages visible to the owner, including the three SFDEMO pages) and ordered-step extraction from `[DEMO] RB-AUTH-01` confirmed. This is the first live proof of the M2 Confluence read path.

- 2026-11-10, owner: page without a numbered list showed the "did not guess any steps" message with the page text (check 6).
- 2026-11-10, CLI: `forge install list` and `forge environments list` show the `development` install unchanged (check 9).

## M2 acceptance summary (2026-11-10)

**Live, passed:** 1 (search, query display), 2 (space filter), 4 (ordered steps), 5 (source link), 6 (no-list page), 9 (development install unchanged, CLI).

**Automated only:** 3 (invalid space key), 8 (permission denied), 7 (restricted page, `asUser` semantics).

**Deferred / limited:** 8 live revocation (reviewed, not performed), 7 (needs a second user), 10 (no errors in logs; invocation counts not checked in the console).

**Verdict:** the M2 positive path (live Confluence search, page read, ordered-step extraction, evidence links, space filtering, honest handling of pages without steps) is verified on real data. Permission-denied handling is verified by tests, not live.

## Cleanup after testing

`forge uninstall` for installation `99a01e9b-c4c3-4634-94c4-634f521b7087` (Jira and Confluence), then optionally `forge environments delete -e confluence-test`. Only with the owner's go-ahead.
