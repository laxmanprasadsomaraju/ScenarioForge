# M8 plan: real remediation workflow

Prepared 2026-11-10 (Lane D). Status: **plan only**; nothing applied, deployed or consented to. Depends on M6 persistence ([M6_PLAN.md](M6_PLAN.md) §6, `storage:app`, D17).

**Principle.** ScenarioForge never writes to Jira or Confluence on its own. A person sees the exact work item that will be created, approves it, and the app creates it as that person. Rovo agents and MCP tools get no write action in M8.

Scopes and endpoints below were read on 2026-11-10 from the official OpenAPI specs: Jira platform v3 (`https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json`) and Confluence v2 (`https://dac-static.atlassian.com/cloud/confluence/openapi-v2.v3.json`), field `x-atlassian-oauth2-scopes`, state "Current".

## 1. Calls and scopes

| Purpose                                                     | Call (asUser)                                                                  | Scope (Current)                | New?              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ | ----------------- |
| Projects the user can create in                             | `GET /rest/api/3/mypermissions?projectKey=…&permissions=CREATE_ISSUES`         | `read:jira-work`               | no                |
| Issue types and required fields                             | `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes[/{issueTypeId}]` | `read:jira-work`               | no                |
| Link type "Relates"                                         | `GET /rest/api/3/issueLinkType`                                                | `read:jira-work`               | no                |
| Duplicate check                                             | `GET /rest/api/3/search/jql`                                                   | `read:jira-work`               | no                |
| Status of the created work item                             | `GET /rest/api/3/issue/{key}?fields=status`                                    | `read:jira-work`               | no                |
| **Create work item**                                        | `POST /rest/api/3/issue` (Browse projects + Create issues)                     | **`write:jira-work`**          | **yes**           |
| Link to the change                                          | `POST /rest/api/3/issueLink`                                                   | `write:jira-work`              | (same)            |
| Link to the runbook page                                    | `POST /rest/api/3/issue/{key}/remotelink` with `globalId` (create-or-update)   | `write:jira-work`              | (same)            |
| Retest result comment on the work item (optional, approved) | `POST /rest/api/3/issue/{key}/comment`                                         | `write:jira-work`              | (same)            |
| Optional: proposal comment on the runbook page              | `POST /wiki/api/v2/footer-comments`                                            | **`write:comment:confluence`** | **yes, optional** |
| Not proposed: editing the page                              | `PUT /wiki/api/v2/pages/{id}`                                                  | `write:page:confluence`        | not requested     |

`write:jira-work` is the only classic scope covering create, link, remote link and comment (granular alternatives are "Beta" in the spec). It allows writes wherever the **user** may write; the app narrows that by only calling these four endpoints after an approval.

## 2. Workflow

1. **Start from evidence.** "Prepare a Jira work item" appears only on a stored finding or an approved rehearsal fix (`rehearsal-fix`), never from the agent.
2. **Build a deterministic draft** (server): project (from projects where the user has Create issues), issue type (from createmeta; user chooses), summary from a template, e.g. `Update RB-AUTH-01 step 3: LegacyAuth retired by MC-62` (≤255 chars), description in ADF with the quoted change excerpt, the quoted runbook step, the corrected step text from the approved fix, links to the change, the page and the rehearsal run, and the line "Consequences in the rehearsal were modelled, not observed." Labels `scenarioforge` and `sf-<12 hex of draftHash>`. Links: issue link "Relates" to the change; remote link to the Confluence page with `globalId = scenarioforge:finding:<findingId>`.
3. **Preview verbatim.** The UI shows exactly what will be sent: project, type, summary, the rendered description, labels, both links, and "This will create 1 work item in <project> as <your name>." The user may edit summary and description; each edit makes a new draft with a new `draftHash` and a new preview.
4. **Approve.** The approve button sends `draftId` and the `draftHash` the user saw. The server reloads the stored draft, recomputes `draftHash = hash(canonicalJson(payload))` (`shared/simulation/replay.ts`), and refuses if it differs.
5. **Create (as the user).** `POST /rest/api/3/issue`, then the issue link, then the remote link. Each result is recorded; a failed link is shown as "Work item created, link not added" with a retry, never hidden.
6. **Never automatic.** No trigger, scheduled job, Automation or Rovo/MCP action creates work items. Rovo answers "Create a ticket" by pointing to the preview screen.

## 3. Idempotency

- Stored record `remediation:<findingId>:<draftHash>` in a new entity `remediation-item` (indexes `owner`, `findingId`), state machine `drafted → approved → creating → created(issueKey) | failed | unknown`. The move to `creating` is a conditional write (`equalTo(version)`), so two clicks or two tabs cannot both create.
- Before any create, and after any `unknown` outcome (timeout after sending), search `labels = "sf-<hash>"` asUser; if a work item exists, adopt its key instead of creating another. [Unverified] search-index delay right after creation; the conditional write is the primary guard, the search is the recovery path.
- Remote link uses `globalId`, which the API defines as create-or-update, so retries do not duplicate it. Issue links are checked on the issue (`fields=issuelinks`) before adding.
- One open work item per finding by default; creating a second one needs an explicit "Create another" with its own preview.

## 4. Audit record

Each `remediation-item` keeps: approver `accountId`, `approvedAt`, the exact payload and `draftHash` approved, the evidence ids it quoted, created issue key, link results, failure messages, and later the retest verdicts linked to it. Shown in History; never edited after `created` except to append retest results. Same retention and user scoping as rehearsal runs (M6_PLAN §6.3), except records with a created work item are kept while the work item exists (the work item itself is the user's record in Jira).

## 5. Optional Confluence proposal (comment, not edit)

If approved, the app can post a **footer comment** on the runbook page with the proposed corrected step and links to the finding and the work item, previewed verbatim and approved like a work item (`POST /wiki/api/v2/footer-comments`, `write:comment:confluence`). The app never edits page content: the page owner decides. Idempotency: the comment id is stored on the `remediation-item`; a second post needs explicit confirmation.

## 6. Retest loop tied to the work item

- When the user opens the finding or History, the app reads the work item's status asUser. Status category `done` shows "Fix marked done in MC-70. Run a targeted retest to verify." It does not mark the gap resolved.
- The targeted retest uses the existing `buildRetest` / `compareRetest` (D15: `resolved` only if the gapped procedure was exercised effectively and its objectives met). The verdict is stored on the run and the `remediation-item`.
- The app also re-runs `analyzeChange` for the change: if the corrected runbook no longer produces the finding, it shows "No longer detected in the pages read" with coverage; if it still does, "Still detected", whatever the work item status says.
- Optional, approved: post the verdict as a comment on the work item (previewed verbatim).

## 7. New scopes requiring owner approval

| Scope                        | Needed for                                         | Required?    |
| ---------------------------- | -------------------------------------------------- | ------------ |
| `write:jira-work`            | create work item, issue link, remote link, comment | yes for M8   |
| `write:comment:confluence`   | optional runbook footer comment                    | optional     |
| `storage:app` (from M6, D17) | drafts, idempotency, audit                         | prerequisite |

Each is a major version with admin re-approval. Test first in a separate environment (e.g. `rovo-test` after M6, or a new `remediation-test`) on test projects only.

## 8. Acceptance (M8)

- A work item is created only after approving the exact previewed payload; the created issue's fields equal the preview.
- Double-click, two tabs and a simulated timeout produce exactly one work item.
- The work item links to the change and to the runbook page; the finding shows the work item key.
- A retest after the work item is done stores a verdict linked to the original finding and the work item.
- No write without approval in any path (checked in Jira and Confluence audit logs).

## 9. Unverified

- Search-index delay for the label duplicate check.
- Whether `write:jira-work` alone is accepted for `POST /rest/api/3/issueLink` when issue linking is disabled on a site (the API requires linking to be active).
- Required custom fields on the chosen project's create screen; the draft must fail with a clear message rather than guess values.
