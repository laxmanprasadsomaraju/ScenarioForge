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

| #   | Check                                                         | Expected                                                                                                                                           | Result                                                                                                                                                               |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open the test URL, then **Recovery plans**                    | Consent prompt for Confluence the first time, then pages 1 to 3 listed with "Live Confluence data" and a "Fetched … with `type = page AND …`" line | **Passed in part** (2026-11-10, owner): "Live Confluence data"; 9 pages returned including all 3 SFDEMO pages. Fetched/query line not yet reported                   |
| 2   | Search with space key `SFDEMO`                                | Only SFDEMO pages; query shows `space = "SFDEMO"`                                                                                                  | Pending                                                                                                                                                              |
| 3   | Search with `OPS DROP`                                        | Search disabled, inline "letters and digits only"                                                                                                  | Pending                                                                                                                                                              |
| 4   | Open page 1                                                   | Four steps in order, step 3 mentions LegacyAuth; source, page updated and read-at times                                                            | **Passed** (2026-11-10, owner): 4 steps in original order; step 3 contains `authctl failover --target legacyauth`; source, page updated, read-at and page text shown |
| 5   | Open in Confluence                                            | Opens the real page                                                                                                                                | Pending                                                                                                                                                              |
| 6   | Open page 3                                                   | "did not guess any steps", page text shown                                                                                                         | Pending                                                                                                                                                              |
| 7   | Restricted page (if a second user exists)                     | Never listed for the user without access                                                                                                           | Pending / not possible with one user                                                                                                                                 |
| 8   | Deny consent (or revoke at id.atlassian.com → Connected apps) | "ScenarioForge needs access to Confluence", no pages shown                                                                                         | Pending                                                                                                                                                              |
| 9   | Development install (`3edeba6c…`)                             | Still version 2, Recovery plans shows the M1 build, no new consent                                                                                 | Pending                                                                                                                                                              |
| 10  | Developer console monitoring, environment `confluence-test`   | `resolver` invocations for `listRecoveryPages` and `getRecoveryProcedure`, no errors                                                               | Pending                                                                                                                                                              |

Already covered by unit tests: HTML stripping (including script and style), ordered-list extraction, nested lists, CQL injection rejection, space key validation, and HTTP 400/401/403/404/429/5xx mapping (`test/confluence.test.ts`, 85 tests; `static/app/test/RecoveryPlans.test.tsx`, 6 tests).

## Evidence log

- 2026-11-10, owner in the live `confluence-test` app: real Confluence search (9 pages visible to the owner, including the three SFDEMO pages) and ordered-step extraction from `[DEMO] RB-AUTH-01` confirmed. This is the first live proof of the M2 Confluence read path.

## Cleanup after testing

`forge uninstall` for installation `99a01e9b-c4c3-4634-94c4-634f521b7087` (Jira and Confluence), then optionally `forge environments delete -e confluence-test`. Only with the owner's go-ahead.
