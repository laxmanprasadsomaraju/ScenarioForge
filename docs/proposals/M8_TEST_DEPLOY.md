# M8 proposal: remediation work-item creation, isolated end-to-end test

Status: **PROPOSAL. No scope added, no deploy, nothing written to Jira.** Prepared 2026-11-11. Builds on [M8_PLAN.md §11–12](../M8_PLAN.md) (adapter as built, hard-disabled; original approval request).

## 1. Where to test (one environment only)

M8 needs **both** `storage:app` (approval record, conditional `creating` lock, audit) **and** `write:jira-work`, plus Confluence read for the runbook link. No current environment has all three:

| Option                                 | Storage                | Confluence                     | Notes                                                                                                                                         |
| -------------------------------------- | ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `confluence-test` (M8_PLAN §12)        | No → would add it      | Yes                            | Adds storage + write to the main test bed that mirrors the judged build. Breaks parity. Not recommended now.                                  |
| `rovo-test`                            | Yes                    | No (Jira only)                 | Mixes write scope with Rovo agents; agents must never reach the create resolver. Not recommended.                                             |
| **New `write-test` env** (recommended) | Added on this env only | Install with Jira + Confluence | Isolated consent, isolated data, easy to uninstall. Entity `remediation-item` becomes app-wide permanent **[unverified per-env vs per-app]**. |

Recommendation: new development environment `write-test`, branch `m8/write-test` (from `integration/lanes-1`), deployed **only** there. M8_PLAN §12 named `confluence-test`; this proposal supersedes that choice because storage is a prerequisite.

## 2. Manifest delta on `m8/write-test` only (proposal)

```yaml
permissions:
  scopes:
    # existing four, plus:
    - storage:app
    - write:jira-work
app:
  storage:
    entities:
      - name: remediation-item # PERMANENT once deployed
        attributes:
          version:
            type: integer
          payload:
            type: string
```

No indexes; key `remediation-item:<sf-rem-…>` (one per idempotency label). No egress, no Confluence write scope, no `asApp` calls.

## 3. Synthetic data

1. Owner creates a Jira project **`[DEMO] ScenarioForge remediation`**, key `SFDEMO` (team-managed, Task type, no required custom fields).
2. Change: existing `[DEMO]` change `MC-62`; runbook `RB-AUTH-01` in Confluence space `SFDEMO` (as in [JUDGE_INSTALL_GUIDE.md](../submission/JUDGE_INSTALL_GUIDE.md)).
3. Every created work item carries labels `scenarioforge`, `sf-demo`, and the idempotency label `sf-rem-…`.

## 4. Exact human-approved draft

The create sends `request.createIssue.body` exactly as fingerprinted; the server re-runs `prepareRemediationRequest`, re-checks `requestHash`, approver = `context.accountId`, approval age ≤ 24 h (M8_PLAN §11 steps 2–3). Only three calls are possible: `POST /rest/api/3/issue`, `POST /rest/api/3/issueLink`, `POST /rest/api/3/issue/{key}/remotelink`. The test compares the created item field by field with the preview (summary, ADF description, labels, "Relates" link, remote link).

## 5. Duplicate protection

- Conditional state move `approved → creating` on the stored record (version check); the loser gets `CONFLICT`.
- Label search before create; `duplicate` → adopt, `ambiguous` → `CONFLICT`.
- Unknown outcome (timeout, 5xx, unreadable body) → label search → adopt or stay `unknown`; never a second create.
- **[Unverified]** search-index delay after create; a fresh item may not be found immediately, so `unknown` can persist until it is.

## 6. Audit records

Each step appends `{ step, outcome, at, actorAccountId | null, issueKey?, upstreamStatus?, transition? }` to the stored record (`approval-check`, `lock`, `duplicate-check`, `create-issue`, `issue-link`, `remote-link`, `adopt`). Ids only, no summary or description text. Cross-check against the Jira issue history/audit log (owner, site admin).

## 7. Test steps

Run M8_PLAN §12 steps 1–9 on `write-test`, plus:

10. Browser path: write the browser-side creator (prepare → `approveRequest` → create) on `m8/write-test` first; it is not written yet.
11. Wire a Forge `asUser().requestJira` gateway and a storage adapter only in this branch's `gateways.ts`; `integration/lanes-1` keeps the null factories.
12. Scope-breadth check: source test that `src/remediation` contains no PUT/DELETE/PATCH or other write call.

Record results in a dated `docs/M8_LIVE_TEST.md`.

## 8. Cleanup and rollback

- Owner deletes every `SFDEMO` work item created during the test (filter `labels = sf-demo`), then the `SFDEMO` project if not needed.
- `forge uninstall -e write-test` removes the install and its consent; the environment can then be left idle. The `remediation-item` entity name stays reserved for the app.
- Code rollback: none needed elsewhere; other branches still return `WRITE_NOT_PERMITTED`.
- Never merge `m8/write-test` gateway wiring into `integration/lanes-1` without a separate approval for the judged build.

## APPROVAL REQUEST (M8 test deploy)

Reuses [M8_PLAN.md §12](../M8_PLAN.md) with the environment changed to an isolated one.

```
APPROVAL REQUEST — M8 write:jira-work isolated test
Owner: please reply in your own words to approve or reject each line.
[ ] C1. Create a new development environment `write-test` and branch m8/write-test;
        deploy that branch only there.
[ ] C2. On write-test only: add scopes storage:app and write:jira-work, and the
        PERMANENT entity `remediation-item` (version integer, payload string, no
        indexes). I accept the entity name can never be removed from this app.
[ ] C3. Install write-test on one-atlas-cegq.atlassian.net (Jira + Confluence).
[ ] C4. I will create the synthetic Jira project "[DEMO] ScenarioForge remediation"
        (SFDEMO). The app may create work items there only after my explicit approval
        of the exact draft in the UI, using POST issue, issueLink, remotelink only.
[ ] C5. After the test I delete the created SFDEMO items and uninstall write-test.
Not included: production, confluence-test, rovo-test, development, any Confluence
write, any asApp call, any merge of the write gateway into integration/lanes-1.
Rollback I accept: uninstall write-test; null factories remain everywhere else.
```
