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

## 9. As built: exact request and fingerprint (Lane A3, 2026-11-10)

Read-only preparation is built; **nothing is created**. No POST/PUT/DELETE call is made and no scope is added. (Since §11 a create resolver exists but is hard-disabled.) Sources read 2026-11-10: Jira platform v3 OpenAPI (`https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json`), ADF reference (`https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/` and the `blockquote`, `paragraph`, `text`, `hardBreak` node and `link` mark pages), ADF JSON schema `@atlaskit/adf-schema` 57.7.39 `dist/json-schema/v1/full.json`, Forge resolver context (`https://developer.atlassian.com/platform/forge/runtime-reference/custom-ui-resolver/`).

**Description as ADF** (`shared/remediation/adf.ts`). `{ version: 1, type: 'doc', content }`. Each blank-line-separated block is a `paragraph`; line breaks inside a block are `hardBreak`. A block starting `Quoted exactly from …:` is that line as a paragraph plus a `blockquote` holding the quoted lines verbatim (no trimming, no smart quotes, never linked). A line `Link: <url>` gets a `link` mark (`attrs.href` = the URL text) only when the URL is absolute https on the trusted site origin; any other URL stays plain text. The footer is a plain paragraph. Flattening with `src/jira/adf.ts` reproduces the normalised description and each quote exactly (tested).

**Requests** (`shared/remediation/request.ts`, `buildCreateIssueRequest(draft, { siteUrl, issueTypeId? })`):

```json
{
  "schemaVersion": 1,
  "createIssue": {
    "method": "POST",
    "path": "/rest/api/3/issue",
    "body": {
      "fields": {
        "project": { "key": "OPS" },
        "issuetype": { "name": "Task" },
        "summary": "Update … step 3: LegacyAuth retired by MC-62",
        "description": { "version": 1, "type": "doc", "content": ["…"] },
        "labels": ["scenarioforge-remediation", "sf-rem-<16 hex>"]
      }
    }
  },
  "issueLink": {
    "method": "POST",
    "path": "/rest/api/3/issueLink",
    "body": {
      "type": { "name": "Relates" },
      "inwardIssue": { "key": "MC-62" },
      "outwardIssue": { "key": "{createdIssueKey}" }
    }
  },
  "remoteLink": {
    "method": "POST",
    "path": "/rest/api/3/issue/{createdIssueKey}/remotelink",
    "body": {
      "globalId": "scenarioforge:finding:<findingId>",
      "object": { "url": "https://<site>/wiki/spaces/…", "title": "<page>, step 3" }
    }
  }
}
```

- `createIssue` body is `IssueUpdateDetails.fields`; the spec says `description` takes ADF. `issuetype`: the spec example uses `{ "id": … }`; `{ "name": … }` is sent until the issue type id is read from createmeta (`issueTypeId` switches to `{ "id" }`). `project` uses `key` (spec example uses `id`; both are documented field forms). [Verify on first live create] that `{ name }` is accepted.
- `issueLink` body is `LinkIssueRequestJsonBean` (required `type`, `inwardIssue`, `outwardIssue`; `additionalProperties: false`). The new work item is the outward ("from") issue, so _Link issues_ is needed in the user's chosen project.
- `remoteLink` body is `RemoteIssueLinkRequest` (required `object` with required `title`, `url`; `globalId` ≤ 255, create-or-update). Omitted when the page path is unknown.
- `{createdIssueKey}` is a placeholder: the follow-up calls need the key Jira returns. `resolveFollowUpRequests(request, key)` fills it in only for a key in the request's project and changes nothing else.

**Fingerprint.** `requestHash = SHA-256(canonicalJson(request))` over every call's method, path and body exactly as sent (placeholder included). Any byte change (project, issue type, summary, ADF text or href, labels, link type/direction/keys, remote link URL/title/globalId, paths, methods) gives a new hash (tested field by field). `approveRequest(draft, context, approver, at)` returns `{ draftHash, requestHash, approverAccountId, approvedAt }`; `checkApproval` (draft) is unchanged; `checkRequestApproval(request, approval, actor)` is missing → wrong-approver → stale → valid, and a draft-only approval (no `requestHash`) is stale.

**Link trust rule** (`src/remediation/site.ts`). The site origin comes only from `GET /rest/api/3/serverInfo` `baseUrl` (spec: OAuth scopes `[]`, "Permissions required: None"), read through Forge `requestJira`, which reaches only the installation's site. The Forge resolver context has `cloudId` but no site URL, and the Custom UI `getContext().siteUrl` comes from the browser, so neither is used. Accepted only as `https://<host>.atlassian.net` (no user info, port, path, query, fragment; one trailing `/` dropped). The browser never supplies a URL: unknown payload fields are ignored. `buildCreateIssueRequest` refuses a change link other than `<site>/browse/<changeKey>` and a page link not under `<site>/wiki/`.

**Resolvers** (`src/remediation/prepare.ts`, registered in `src/index.ts`, all GET as the user):

- `prepareRemediationRequest({ changeKey, findingId, fixId, projectKey, issueTypeName, summary? })`: serverInfo → `analyzeChange` (issue, remote links, Confluence search, pages) → finding by id → fix text from `generateRehearsal` (`rem-step`, `rem-change-check`) or `review-step` → draft → exact request → duplicate search `GET /rest/api/3/search/jql?jql=labels = "<sf-rem-…>" ORDER BY created ASC&maxResults=10&fields=summary,labels`. Returns `{ draft, request, draftHash, requestHash, duplicate: { decision: none|duplicate|ambiguous, issueKey?, matches, reason }, siteUrl, preparedAt }`. A failed duplicate search (403, 429, …) is an error, never `none`.
- `checkRemediationApproval({ …same fields, requestHash, approval })`: rebuilds everything, then `stale` if the fresh hash differs from the hash seen or approved (e.g. the change or runbook step text changed), `wrong-approver` if the approval is not the caller's Forge `context.accountId`.

Until approvals are stored server-side (`storage:app`), the approval record comes from the browser: the check proves the bytes still match, not that ScenarioForge issued the record. No retest result is attached server-side yet (description says so).

**Remaining approval before any write:** `write:jira-work` (create, issue link, remote link), plus `storage:app` for server-held approvals and the conditional `creating` write (§3). Neither is requested here.

## 10. Unverified

- Search-index delay for the label duplicate check.
- Whether `write:jira-work` alone is accepted for `POST /rest/api/3/issueLink` when issue linking is disabled on a site (the API requires linking to be active).
- Required custom fields on the chosen project's create screen; the draft must fail with a clear message rather than guess values.

## 11. As built: creation adapter, hard-disabled (Lane M8, 2026-11-11)

Status: **Code complete, Automated tests passed. Disabled in every build.** No write scope, no manifest change, no deploy, nothing sent to Jira or Confluence.

**Disabled by construction.** `src/remediation/create.ts` takes an injected `JiraWriteGateway | null` and `StorageAdapter | null`. Production wiring (`src/remediation/gateways.ts`) returns `null` for both, and no Forge write implementation exists anywhere in the codebase. The resolver `createRemediationWorkItem` (registered in `src/index.ts`) checks the writer first and answers `WRITE_NOT_PERMITTED` before parsing the payload or reading anything. Tests assert both factories return null and that no read happens.

**Order when a writer and a store are injected (tests only):**

1. No store → `STORAGE_UNAVAILABLE`, nothing read or sent.
2. Server-side re-run of `prepareRemediationRequest` (serverInfo, analysis, draft, exact request, label search). The browser's draft is never used.
3. Approval re-check (`verifyApproval`): approval carries `requestHash`; `checkRequestApproval` against the fresh request (missing → wrong-approver → stale); the hash the person saw equals the fresh hash; approver = Forge `context.accountId`; `approvedAt` readable, not more than 5 min in the future, not older than 24 h. Any failure → `APPROVAL_INVALID`.
4. Stored record `remediation-item:<sf-rem-…>` (one per idempotency label): `created` → returned as is; `creating`/`unknown` → label search only (adopt, or stay `unknown`); `failed` (a definite refusal, nothing created) → may be retried.
5. Duplicate from step 2: `ambiguous` → `CONFLICT`; `duplicate` → adopt without creating or linking.
6. Conditional state move `approved → creating` (`StorageAdapter.set` with `expectedVersion`, via the shared state machine `transition`). Losing the race → `CONFLICT`. Two concurrent calls create once (tested).
7. Label search again immediately before the create (`duplicate` → adopt; `ambiguous`/error → `failed`).
8. `POST /rest/api/3/issue` with `request.createIssue` exactly as fingerprinted; then `resolveFollowUpRequests(request, key)`; `POST /rest/api/3/issueLink`; `POST /rest/api/3/issue/{key}/remotelink` (skipped when there is no page link). Tests compare every sent call to the approved request with only the key filled in.
9. Outcomes: throw/timeout, 5xx, unreadable 2xx body → `unknown` → label search → adopt (then links) or stay `unknown` ("checking"); never a second create. 4xx on create → `failed` with a permission-safe message. A failed link after a created work item → `created-with-follow-up`; the create is never retried.
10. Audit: each step appends `{ step, outcome, at, actorAccountId | null, issueKey?, upstreamStatus?, transition? }` to the record (`approval-check`, `lock`, `duplicate-check`, `create-issue`, `issue-link`, `remote-link`, `adopt`). Ids only; no summary or description text.

**Error mapping (writes)** `writeErrorFromStatus`: 400 `INVALID_REQUEST` ("the project may need fields this draft does not fill in"), 401 `UNAUTHENTICATED`, 403 `FORBIDDEN` ("You do not have permission to create the work item in this project."), 404 `NOT_FOUND` ("The project or work item was not found, or you cannot see it." — does not reveal whether the project exists), 429 `RATE_LIMITED`, other `UPSTREAM_ERROR`. Jira's error text is never echoed. New `ApiErrorCode`s: `WRITE_NOT_PERMITTED`, `APPROVAL_INVALID`, `CONFLICT`, `STORAGE_UNAVAILABLE`.

**UI** (`RemediationPreview`): an optional `creator` prop, passed by no screen, so "Create in Jira" stays disabled with "Creating work items needs the write:jira-work permission (not granted)". With a creator (component tests only): disabled until the exact draft is approved; then a second confirmation (`alertdialog` "Create 1 work item in <project> as you?") lists exactly the work item, labels, issue link and runbook page link; outcomes shown: created (key link), created with follow-up (which link failed and why), not created (reason; retry allowed), unknown ("checking", with "Check again", which never creates twice). A "Remediation tracking" card keeps the stages separate: Proposed / Approved (simulated) / Jira work item created / Runbook updated / Verified retest ("Retest after the runbook is updated"), and links the created key to the finding id.

Tests: `test/remediationCreate.test.ts` (18), `static/app/test/RemediationPreview.test.tsx` (5 new). The browser-side creator (prepare → `approveRequest` → create) is not written; it is the first step after approval.

## 12. Approval request: `write:jira-work` (not granted; owner decision needed)

**Ask.** Add `write:jira-work` to `manifest.yml` permissions and deploy to **`confluence-test` only**, to test work item creation against a synthetic `[DEMO]` project. `storage:app` (D17) is a prerequisite for the approval store and conditional `creating` write. No production or development deploy, no Confluence write scope.

**What the scope allows.** Classic scope `write:jira-work`: create and edit issues, comments, worklogs, issue links and remote links, transitions and attachments **wherever the acting user may**. Forge cannot narrow it to endpoints; the app narrows it in code. Calls are made `asUser()` only, so Jira enforces the user's own project permissions (Browse projects, Create issues, Link issues).

**Endpoints ScenarioForge would call with it (and only these):**

| Call                                      | When                                         | Body                                          |
| ----------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `POST /rest/api/3/issue`                  | once per idempotency label, after approval   | `request.createIssue.body` as fingerprinted   |
| `POST /rest/api/3/issueLink`              | after create, "Relates" to the change        | `request.issueLink.body`, key filled in       |
| `POST /rest/api/3/issue/{key}/remotelink` | after create, when the runbook page is known | `request.remoteLink.body` (`globalId` upsert) |

No edit, transition, delete, comment, attachment or Confluence call. No asApp call. No trigger, schedule, Automation or Rovo/MCP action can reach the create resolver.

**Risks.**

- Scope breadth: a code defect could write elsewhere the user can. Mitigation: one gateway with a `send(call)` that only receives calls from the fingerprinted request; tests assert the exact calls; a source test fails if `src/remediation` contains PUT/DELETE/PATCH or another write call.
- Duplicate work items on timeout or double click. Mitigation: conditional `creating` write, label search before create, adopt-by-label on unknown outcome; tested.
- Search-index delay after create (unverified): an `unknown` may stay `unknown` until the item is searchable; the UI says "checking" and never re-creates.
- Required custom fields on the target project's create screen → 400, shown as "not created", no retry loop.
- Admin re-consent: adding the scope is a major version; every install must re-approve.
- Marketplace/contest: a write scope increases review scrutiny; the demo must state that creation happens only after explicit approval.

**Rollback.** Remove the scope from `manifest.yml` and redeploy to `confluence-test`; the production factory already returns null, so the resolver answers `WRITE_NOT_PERMITTED` regardless. Work items created in the `[DEMO]` project are deleted by hand by the owner. No data migration: records live only in `storage:app` on that environment.

**Test plan on `confluence-test` (synthetic only).**

1. Owner creates a `[DEMO]` Jira project (e.g. `SFDEMO`) and uses the existing `[DEMO]` change `MC-62` and runbook `RB-AUTH-01`.
2. Swap the null writer for a Forge `asUser().requestJira(route…, { method: 'POST', body })` gateway on a `m8/*` branch built only for `confluence-test`.
3. Happy path: prepare → review → approve → confirm → one work item; compare its fields in Jira with the preview byte for byte (summary, ADF description, labels, "Relates" link, remote link).
4. Double click / two tabs: exactly one work item.
5. Stale: edit the runbook step after approval → `APPROVAL_INVALID`.
6. Permission: a user without Create issues in `SFDEMO` → `FORBIDDEN`, nothing created.
7. Label duplicate: run again → adopted, no new item.
8. Check the Jira audit log: only the three calls above, only by the approving user.
9. Record the results in a dated `docs/M8_LIVE_TEST.md`; delete the demo items afterwards.

## 13. Status 2026-11-11 (Lane 2)

Browser path written (Code complete, Automated tests passed): review proposed fix, inspect exact draft, approve, second confirmation dialog, then `makeRemediationCreator` (`static/app/src/lib/remediationCreator.ts`) calls `prepareRemediationRequest` (server rebuild), refuses if the server draft hash differs from the approved one, binds the approval to the server request hash, then calls `createRemediationWorkItem`. The create button is enabled only with build flag `VITE_SF_REMEDIATION_CREATE=enabled` (off); the backend still has no writer and answers WRITE_NOT_PERMITTED. "Jira work item created", "Runbook updated" and "Verified retest" are separate stages; runbook-updated tracking is still "Not tracked yet". The duplicate state is shown only by the server check at create time, not before approval.
