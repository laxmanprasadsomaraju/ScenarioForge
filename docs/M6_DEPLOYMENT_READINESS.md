# M6 deployment readiness: `rovo-test`

Prepared 2026-11-10 (Lane A). Status: **documentation and offline checks only.** No deploy, install, scope, module or Atlassian resource was created. `manifest.yml` is unchanged. Builds on [M6_PLAN.md](M6_PLAN.md) (§3 identity, §6 history, §7 manifest, §8 `rovo-test`), [AI_USAGE_GOVERNANCE.md](AI_USAGE_GOVERNANCE.md) and D17 (on `origin/lane-a2-forge-storage`, `docs/DECISIONS.md`).

"Verified" means read on the cited official page on 2026-11-10. **[Unverified]** marks what no official page states. Community posts and RFCs are evidence, not documentation.

**Offline checks run for this document.** `forge lint` (CLI 15.1.0, Node 24.22.2) on a temporary copy of the repo in the session scratchpad, never in the repo or committed. The copy had the current manifest plus `storage:app`, the `ai-governance` entity and the spike in §1.4:

| Lint run                                                               | Result                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `-e rovo-test`, spike + `storage:app` + `ai-governance`                | "No issues found." No `MAJOR_VERSION_RULE`, because `rovo-test` has never been deployed                        |
| same, plus a `rehearsal-run` entity with a named `by-owner` index      | "No issues found." (syntax only)                                                                               |
| `-e confluence-test` and `-e development` with the same manifest       | `MAJOR_VERSION_RULE` approval: "Change due to scope modification". This is why those environments are not used |
| Any rule asking for a scope because of `rovo:agent` or `action` blocks | None reported                                                                                                  |

---

## 1. Action identity model

### 1.1 What official sources say

| #   | Claim                                                                                                                                                                                                                                                                                                                   | Source (page "last updated")                                                                                                                                            | Kind                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| I1  | The action function receives `(payload, context)`: "The `payload` and `context` are passed into the function as arguments."                                                                                                                                                                                             | [Action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/) (3 Aug 2026)                                                           | Official reference                     |
| I2  | "The `context` contains the user's `accountId`." No example shows it, and the page does not say whether this is the second argument or `payload.context`.                                                                                                                                                               | same                                                                                                                                                                    | Official reference                     |
| I3  | "never rely on values passed as inputs to perform critical checks like authorization."                                                                                                                                                                                                                                  | same                                                                                                                                                                    | Official reference                     |
| I4  | The Action page does not mention `asUser`, `asApp` or scopes.                                                                                                                                                                                                                                                           | same                                                                                                                                                                    | Absence                                |
| I5  | `asUser()`: "only available in modules that support the UI kit." Actions are not named.                                                                                                                                                                                                                                 | [requestJira](https://developer.atlassian.com/platform/forge/apis-reference/fetch-api-product.requestjira/) (8 Nov 2024)                                                | Official reference, **old**            |
| I6  | Without the user's grant, the request has no valid `Authorization` header, and on 401 "then an `Error` is thrown."                                                                                                                                                                                                      | same                                                                                                                                                                    | Official reference                     |
| I7  | Official tutorial for a `rovo:mcp` tool backed by an `action` (`actionVerb: GET`, scope `read:jira-work`) calls `api.asUser().requestJira(...)`; the agent "can't read anything the user couldn't read themselves." Tested from a Rovo Studio custom agent.                                                             | [Read Jira issues with a Rovo MCP tool](https://developer.atlassian.com/platform/forge/read-jira-issues-with-a-rovo-mcp-tool/) (29 Oct 2026)                            | Official tutorial, **newest**          |
| I8  | Same tutorial, external clients: "Without this consent entry, `asUser()` calls can fail when invoked remotely." It then suggests `asApp()` as a fallback.                                                                                                                                                               | same                                                                                                                                                                    | Official tutorial                      |
| I9  | `rovo:mcp` tools are "subject to the invoking user's own permissions on that site." External exposure is off by default; an admin enables it in Connected apps.                                                                                                                                                         | [Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/) (29 Oct 2026)                                                           | Official reference                     |
| I10 | Older agent tutorial uses `api.asApp().requestJira` in an action; agent "must be used within the context of an issue page."                                                                                                                                                                                             | [Build a Jira issue analyst Rovo Agent](https://developer.atlassian.com/platform/forge/build-a-jira-issue-analyst-rovo-agent/) (3 Mar 2025)                             | Official tutorial, old                 |
| I11 | RFC-134: "`asApp()` will be actively prevented for MCP-invoked actions"; user identity "is passed through to the invocation context". The RFC says it is "not a tool for approving or committing to ideas."                                                                                                             | [RFC-134](https://community.developer.atlassian.com/t/rfc-134-forge-rovo-tools-and-mcp/100683) (May–Jun 2026)                                                           | Staff RFC, not documentation           |
| I12 | `asUser().requestJira` inside a `rovo:mcp` tool worked once the retired `/rest/api/3/search` (410) call was replaced.                                                                                                                                                                                                   | [community 102510](https://community.developer.atlassian.com/t/rovo-mcp-api-asuser-returns-undefined-useraccess-enabled-false-despite-hasaccess-true/102510) (Sep 2026) | Community                              |
| I13 | Actions with non-`GET` verbs or `required: true` inputs sometimes are never invoked (FRGE-1601, open).                                                                                                                                                                                                                  | [community 102254](https://community.developer.atlassian.com/t/rovo-agent-action-fails-when-added-to-existing-forge-app/102254) (Aug 2026)                              | Community                              |
| I14 | Installed `@forge/api` 8.5.0 (read in `node_modules`): a `forge-proxy-error: NEEDS_AUTHENTICATION_ERR` response throws `NeedsAuthenticationError` with `name = 'NEEDS_AUTHENTICATION_ERR'` and `status = 401`; any other proxy error throws `ProxyRequestError(status, reason)`; a normal 4xx/5xx returns a `Response`. | `node_modules/@forge/api/out/api/fetch.js`, `errors.js`                                                                                                                 | Library source (behaviour of this SDK) |

### 1.2 Reconciliation

- **I5 against I7.** I5 is a 2024 general reference that predates actions as a Forge-hosted module. I7 is a 29 Oct 2026 official tutorial that runs `asUser()` inside an action function and says it respects the invoking user's permissions. The newer, specific page wins on intent; I5 is not evidence that actions lack user context. I7 does **not** show a run from a `rovo:agent` chat (it is a `rovo:mcp` tool used by a Studio agent), and it reports no recorded result.
- **I8 against I11.** The tutorial offers `asApp()` as a fallback for external clients; the RFC says `asApp()` will be blocked for MCP calls. ScenarioForge takes neither path: `asApp()` would bypass the user's Jira and Confluence permissions (M6_PLAN §1, D3), so it is not used in any M6 action.
- **I2.** `accountId` is promised in prose only. The spike logs where it actually appears (key names only, never values).
- **I6/I14.** A missing user grant shows up as a **thrown** error with `status` 401, not a returned 401 response. The spike must catch it and report the status from the error.

**Verdict: UNVERIFIED for `rovo:agent` chat; supported by an official tutorial for `rovo:mcp` tools from a Studio agent; external MCP clients need a user consent entry (I8).** Nothing ships until the spike in §1.4 has run on `rovo-test`.

### 1.3 Rule (no fallback)

- No M6 action calls `asApp()`, now or as a fallback.
- `accountId` comes only from the invocation context (I3). Missing: `INVALID_INPUT`, no spend.
- If the spike shows `asUser()` is unavailable in actions, **M6 actions ship disabled**: a reviewed code constant `ACTION_USER_IDENTITY_SUPPORTED = false` makes every handler return, before any API call or governor reservation, `{ ok: false, code: 'NOT_ASSESSED', message: "ScenarioForge's Rovo actions are not available on this site: they only run with your own Jira permissions, and Rovo did not provide them. Use the ScenarioForge app instead." }`. The agents' prompts already say to repeat an `ok: false` message and stop. `asUser(accountId)` impersonation needs offline impersonation for the scopes (I5) and is a separate consent; it is **not** proposed here.

### 1.4 SPIKE on `rovo-test` (PROPOSAL)

One test agent, one GET action, no inputs (avoids I13), calling `GET /rest/api/3/myself` as the user (`read:jira-user`, already approved). It returns only a match boolean and an HTTP status; nothing from Jira is returned or logged.

```yaml
# PROPOSAL — rovo-test only; do not apply to manifest.yml without owner approval
modules:
  rovo:agent:
    - key: identity-probe
      name: ScenarioForge identity probe # 28 chars, limit 30
      description: Test-only agent. Checks whether ScenarioForge actions run as the signed-in user. Returns no Jira data.
      prompt: >
        You are a test agent. When the user says "run the identity probe", call the
        whoami-probe action once and reply with its JSON result exactly. Do not call it
        for any other message and do not call any other tool.
      conversationStarters:
        - Run the identity probe
      actions:
        - whoami-probe
  action:
    - key: whoami-probe
      name: Identity probe
      function: action-whoami-probe
      actionVerb: GET
      description: Test-only. Call when the user says "run the identity probe". Returns whether the request ran as the signed-in user, and an HTTP status.
  function:
    - key: action-whoami-probe
      handler: index.whoamiProbe
```

Handler (linted in the scratch copy, not committed):

```ts
import api, { route } from '@forge/api';

export async function whoamiProbe(
  payload: { context?: { accountId?: unknown } } | undefined,
  context: { accountId?: unknown } | undefined,
): Promise<{ accountIdMatch: boolean | null; httpStatus: number | null }> {
  const fromContext = typeof context?.accountId === 'string' ? context.accountId : undefined;
  const fromPayload =
    typeof payload?.context?.accountId === 'string' ? payload.context.accountId : undefined;
  const expected = fromContext ?? fromPayload;
  console.log(
    JSON.stringify({
      probe: 'whoami',
      contextKeys: Object.keys(context ?? {}).sort(),
      payloadContextKeys: Object.keys(payload?.context ?? {}).sort(),
      accountIdIn: fromContext ? 'context' : fromPayload ? 'payload.context' : 'none',
    }),
  );
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/myself`);
    if (!res.ok) return { accountIdMatch: null, httpStatus: res.status };
    const body = (await res.json()) as { accountId?: unknown };
    return {
      accountIdMatch: expected === undefined ? null : body.accountId === expected,
      httpStatus: res.status,
    };
  } catch (error) {
    const e = error as { name?: unknown; status?: unknown };
    console.log(JSON.stringify({ probe: 'whoami', threw: String(e?.name ?? 'Error') }));
    return { accountIdMatch: null, httpStatus: typeof e?.status === 'number' ? e.status : null };
  }
}
```

Run it three times: (a) Rovo chat from a Jira issue view, (b) Rovo chat from the Jira home (no issue in context), (c) as a second user if one exists. Optional, only if `rovo:mcp` is approved later: (d) from a Rovo Studio custom agent.

| Outcome                    | What the agent returns / `forge logs -e rovo-test` shows                                                | Meaning                                                                  | Decision                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Works**                  | `{ accountIdMatch: true, httpStatus: 200 }`; log `accountIdIn` = `context` or `payload.context`         | `asUser()` runs as the chatting user and `accountId` is where we read it | Proceed. Record which location holds `accountId`; handlers read only that one |
| Works, identity mismatch   | `{ accountIdMatch: false, httpStatus: 200 }`                                                            | Request ran as someone other than the context user                       | **Stop.** Ship disabled (§1.3); report to Atlassian                           |
| Works, no `accountId`      | `{ accountIdMatch: null, httpStatus: 200 }`, `accountIdIn: none`                                        | User context exists but cannot be tied to the caller                     | Ship disabled: the governor's per-user caps need `accountId`                  |
| **Throws** (no user grant) | `{ accountIdMatch: null, httpStatus: 401 }`, log `threw: NEEDS_AUTHENTICATION_ERR`                      | No user token for actions (I6, I14)                                      | Ship disabled. No `asApp()`. Impersonation only by a new owner decision       |
| **Throws** (other)         | `{ accountIdMatch: null, httpStatus: null or 4xx/5xx }`, log `threw: <name>` (e.g. `ProxyRequestError`) | Platform refused the call                                                | Ship disabled; capture the error name for an Atlassian ticket                 |
| **Returns 401**            | `{ accountIdMatch: null, httpStatus: 401 }` without a `threw` log line                                  | Token sent but rejected                                                  | Ship disabled                                                                 |
| Returns 403/404            | `{ accountIdMatch: null, httpStatus: 403 }`                                                             | Scope or permission problem (`read:jira-user` should cover `/myself`)    | Check consent on the `rovo-test` install; rerun once; otherwise ship disabled |
| Action never invoked       | Agent answers without a log line                                                                        | Rovo did not call the action (I13 pattern)                               | Not an identity result; adjust description, rerun                             |

The probe agent and action are removed in the next `rovo-test` deploy and never go to another environment.

---

## 2. Permanent storage schema review

### 2.1 Platform rules (verified)

| Rule                                                                                                                                                          | Source                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Once deployed, entities and attributes cannot be deleted; Forge returns an error if you try. New attributes can be added.                                     | [Defining entities](https://developer.atlassian.com/platform/forge/storage-reference/entities-manifest/) (19 May 2026)             |
| Indexes can be deleted in development and custom environments, but not once deployed to staging or production. Custom entity changes "cannot be backported".  | same; [App versions](https://developer.atlassian.com/platform/forge/versions/) (6 Oct 2026)                                        |
| With `--major-version`, `forge deploy` ignores the `storage` section.                                                                                         | Defining entities                                                                                                                  |
| Types: `string`, `integer` (32-bit: −2,147,483,648 to 2,147,483,647), `float`, `boolean`, `any`.                                                              | Defining entities                                                                                                                  |
| 20 entities per app; 50 attributes and 7 custom indexes per entity; entity names 3–60 chars `a-z0-9:-_.`; attribute names ≤30 chars `[_A-Za-z][_0-9A-Za-z]*`. | [KVS and Custom Entity Store limits](https://developer.atlassian.com/platform/forge/limits-kvs-ce/) (28 Sep 2026)                  |
| 240 KiB (raw) per value, depth 31; keys ≤500 chars matching `/^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/`; range attributes ≤900 bytes, partition ≤1700 bytes per index.  | same                                                                                                                               |
| Transactions: ≤25 operations, each key once, 4 MB payload, counted as one write.                                                                              | same; [Entity transactions](https://developer.atlassian.com/platform/forge/storage-reference/transactions-entities/) (28 Sep 2026) |
| `@forge/kvs` "requires the `storage:app` scope"; "An app can only access its data for the same environment."                                                  | [Storage API](https://developer.atlassian.com/platform/forge/runtime-reference/storage-api-basic/) (21 Aug 2026)                   |

**[Unverified]** whether entity/attribute permanence is per environment or per app. Lane A treats it as **app-wide**: anything deployed to `rovo-test` must be something we are willing to keep in production.

### 2.2 Entities

| Entity          | Source                  | Attributes (type)                                                       | Indexes                                                             | Status / permanence                               |
| --------------- | ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `ai-governance` | lane-a2 (`09d555b`)     | `version` (integer), `payload` (string, JSON text)                      | none (lookup by key)                                                | Branch only. Becomes permanent on first deploy    |
| `rehearsal-run` | M6_PLAN §6.1 (proposal) | `owner` (string), `changeKey` (string), `createdAt` (string), `payload` | `by-owner` (owner / createdAt), `by-change` (changeKey / createdAt) | Proposal. **Recommend reducing** (§2.3)           |
| `rehearsal-fix` | M6_PLAN §6.1 (proposal) | `owner` (string), `findingId` (string), `payload`                       | simple index `owner`                                                | Proposal. **Recommend not creating in M6** (§2.3) |

`ai-governance` is already minimal and consistent with the recommendation. Its keys (`ai-governance:settings`, `ai-governance:ledger:YYYY-MM`, `ai-cache:index`, `ai-cache:entry:<16 hex>`) fit the key pattern; `validateKey` and `MAX_RECORD_BYTES` in `src/ai/forgeStorage.ts` enforce the limits before writing.

### 2.3 Recommendation: minimise permanent attributes

1. **Same shape for every entity: `version` (integer) + `payload` (string).** Schema evolution happens inside the payload: every payload carries `schema: <n>`; readers accept known versions and migrate on read, writers always write the newest. Never rely on deleting or renaming an attribute or entity. An unknown future `schema` is treated as unreadable ("Record could not be read"), never as empty.
2. **`rehearsal-run`, option A (recommended): no indexes, no `owner` attribute.** Key `run:<sessionId>`. A per-user list record `runs:<accountId>` in the same entity holds up to 50 `{ sessionId, createdAt, changeKey }` entries. `saveRun` writes the run (create-only) and the list (version check) in **one** conditional transaction (2 of 25 operations), so they cannot diverge. Listing is one read plus up to 50 gets; pruning and "Delete my history" use the list. Permanent footprint: one entity name, two attributes, zero indexes.
3. **Option B (only if the owner wants queries):** add `ownerAccountId` (string) and `createdAt` (string, ISO-8601 UTC with milliseconds, fixed 24 chars so it sorts) and one index `by-owner` (partition `ownerAccountId`, range `createdAt`). Not `integer` epoch milliseconds: about 1.7 × 10¹² exceeds the 32-bit integer range. Drop `changeKey` and `by-change`: M6 reads are always owner-scoped (M6_PLAN §6.3), and an index on change keys has no M6 reader.
4. **`rehearsal-fix`: do not create in M6.** Approved fixes belong to one run; store them in the run payload (`fixes[]`). M8 can add an entity later; adding is allowed, removing is not.
5. **Personal data.** Option A stores `accountId` only inside payloads and keys; option B also makes it a queryable attribute. [Unverified] Forge personal-data reporting obligations for stored account ids (M6_PLAN §6.3) — check before the history deploy.
6. **Order.** The first `rovo-test` deploy contains `ai-governance` only. `rehearsal-run` is added in a later deploy, after its own approval (§6).

### 2.4 First-write behaviour: documented and not

| Question                                              | Documented?                                                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conditions on `transact().set`                        | Yes: "Conditions are optional"; "if any condition is not met, the entire transaction will fail." ([Entity transactions](https://developer.atlassian.com/platform/forge/storage-reference/transactions-entities/)) |
| `notExists` exists as a `FilterConditions` member     | Listed in the table (`exists`, `notExists`) on [Entities query](https://developer.atlassian.com/platform/forge/storage-reference/entities-api-query/) (21 Aug 2026); never shown in an example                    |
| `notExists` on a **missing key** means create-only    | **No.** Not stated anywhere                                                                                                                                                                                       |
| Error name, code or HTTP status of a failed condition | **No.** Only `TOO_MANY_REQUESTS` is documented on the transactions page                                                                                                                                           |
| `equalTo` vs `equalsTo`                               | Inconsistent: table says `equalTo`, example uses `equalsTo`. The installed `@forge/kvs` 2.1.2 exposes `equalTo` (lane-a2 compiles and tests against it)                                                           |
| Whether `kvs.entity().get` is strongly consistent     | **No** (plain `kvs.get` is)                                                                                                                                                                                       |

lane-a2 is built for this gap: `isPossibleConditionFailure` only accepts 400/409/412 rejections that are not a documented non-condition code, then **re-reads** the version; it returns `CONFLICT` only if the stored version really differs, otherwise it throws and the governor denies (`UNAVAILABLE`).

### 2.5 `rovo-test` storage verification (before AI is enabled)

Run in the same spike build as §1.4, as a second test-only action `storage-probe` on the `identity-probe` agent (no inputs; `actionVerb: GET`, although it writes to its own `probe:` keys — honest label: test-only, removed next deploy). It uses `ForgeEntityStorage` and the real `UsageGovernor` from lane-a2, so lane-a2 must be merged into the spike build. It returns only enum results; raw error `name`, `code` and `responseDetails.status` are logged.

| Step | Operation                                                                                           | Expected result                                                     | Proves                                             |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| S1   | `storage.get('probe:<invocationId>')`                                                               | `undefined`                                                         | Missing key reads as absent                        |
| S2   | `storage.set(key, {n:1}, null)` (condition `version notExists`)                                     | `{ ok: true, version: 1 }`                                          | **First write** works with `notExists`             |
| S3   | Same create-only write again                                                                        | `{ ok: false, reason: 'CONFLICT' }`; log shows the real error shape | **Create-only conflict** detected, not overwritten |
| S4   | `set(key, {n:2}, 1)` then `set(key, {n:3}, 1)`                                                      | `ok, version 2`, then `CONFLICT`                                    | Optimistic version check                           |
| S5   | `get(key)`                                                                                          | `{ value: {n:2}, version: 2 }`                                      | Failed writes did not apply                        |
| S6   | `governor.checkAndReserve({ operation: 'find-recovery-risks', accountId })` with no settings record | `DISABLED`                                                          | **Fail closed** before opt-in                      |
| S7   | Same with policy `enabled: false` (constructed in the probe)                                        | `DISABLED`, and no storage call logged                              | Kill switch path                                   |
| S8   | `storage.set('bad key!', …)`                                                                        | throws `ForgeStorageError`, mapped to `UNAVAILABLE` by the governor | Invalid input fails closed                         |
| S9   | delete the probe key                                                                                | then `get` is `undefined`                                           | Cleanup                                            |

**Gate.** If S2 fails (create-only not supported) or S3 returns anything but `CONFLICT` (for example the adapter throws because the real error is not a 400/409/412), AI stays off on `rovo-test`: the governor still fails closed, but every first ledger write would deny. Lane A then changes the adapter (for example a sentinel create path) and repeats S1–S9. The observed error shape is recorded in `docs/M6_LIVE_TEST.md` and in D17.

---

## 3. Permissions for the `rovo-test` deploy

Exactly five scopes. Nothing else: no egress, no Teamwork Graph, no JSM, no write scopes, no `read:chat:rovo`.

| Scope                  | Covers                                                                                                 | Status                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `read:jira-work`       | Issue search and fields, `mypermissions` admin check (Settings resolver), action permission pre-check  | Approved (M1)                  |
| `read:jira-user`       | `/rest/api/3/myself` (connection status, identity probe)                                               | Approved (M1)                  |
| `search:confluence`    | CQL search for recovery pages (`/wiki/rest/api/search`)                                                | Approved for test envs (M2)    |
| `read:page:confluence` | One page body (`/wiki/api/v2/pages/{id}`)                                                              | Approved for test envs (M2)    |
| `storage:app`          | `@forge/kvs` Custom Entity Store: governor ledger, settings, response cache (later: rehearsal history) | **Needs owner approval** (D17) |

**Agents and actions need no product scope [Unverified, strongly indicated].** The Action, Rovo Agent and Rovo MCP pages list no scope for the modules themselves; the official hello-world agent manifest has no `permissions` block at all ([Build a Rovo Agent hello world app](https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-agent/), 3 Mar 2025); `forge lint` asked for none. Scopes are needed only for the APIs the handlers call.

**Consent and versions.**

- `rovo-test` has no installation, so the first `forge install` consents to all five scopes at once. No upgrade, no major version on `rovo-test` (confirmed by lint).
- Adding a scope is a major version where an installation exists ([App versions](https://developer.atlassian.com/platform/forge/versions/): "By default, a new major version won't be applied to a site until its admin consents"). `development` and `confluence-test` would hit `MAJOR_VERSION_RULE` (lint, above). They are not deployed.
- `storage:app` history: from 30 Apr 2026 it forced per-site admin approval; Atlassian staff called it a bug and reported it "resolved" on 22 May 2026 ([community 100552](https://community.developer.atlassian.com/t/major-version-trap-adding-storage-app-to-your-forge-manifest-requires-admin-approval-for-upgrades-made-after-april-30/100552)). It is still a scope change, so still a major version; the fix concerns bulk upgrade. Irrelevant for a fresh `rovo-test` install.
- Adding `rovo:agent`/`action` modules: App versions lists only scopes, egress categories and web triggers as major triggers, so other module additions appear to be minor (not stated directly) [Unverified].
- After the first install, keep the scope list frozen on `rovo-test`: later deploys (M6 actions, history) are then minor and need no re-consent.
- **Merge note.** The lane-a2 manifest is older than M2: it lacks `compatibility.confluence.required: false`. The `rovo-test` manifest must start from the current `manifest.yml` and add only `storage:app` and the entity.

---

## 4. Deployment and rollback plan

Site: `one-atlas-cegq.atlassian.net`. Every command carries `-e rovo-test`; none runs without the owner's go-ahead for that phase. CLI flags verified on the CLI reference pages ([install](https://developer.atlassian.com/platform/forge/cli-reference/install/), [uninstall](https://developer.atlassian.com/platform/forge/cli-reference/uninstall/), [logs](https://developer.atlassian.com/platform/forge/cli-reference/logs/), all 12 Oct 2026) and `forge … --help` on CLI 15.1.0.

### 4.1 Pre-checks (no Atlassian change)

1. `node -v` is 24.x; `forge --version` ≥ 15.1.0; `forge whoami` is the owner's developer account.
2. `forge settings list`: note the default environment; never rely on it (always pass `-e`).
3. `forge environments list`: `rovo-test` exists.
4. `forge install list` → save as `before.txt`. Expect `development` and `confluence-test` on the site, nothing for `rovo-test`.
5. `forge deploy list -e development` and `forge deploy list -e confluence-test` → save the latest version of each.
6. Branch for the build: integration branch + lane-a2 merged + spike (§1.4, §2.5); `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npx prettier --check .` green.
7. `forge lint -e rovo-test`: "No issues found", no `MAJOR_VERSION_RULE`. If it reports a major version, stop.
8. Owner, in the browser: Rovo chat and Browse agents present on the site (SETUP_STATUS: still "not checked"); extra usage confirmed off (§5.3); current Rovo credit usage recorded.

### 4.2 Phase 1: spike

```sh
forge deploy -e rovo-test --non-interactive
forge install --site one-atlas-cegq.atlassian.net --product jira -e rovo-test
#   review the five scopes on the consent prompt; do not pass --confirm-scopes
forge install list            # → after.txt; diff with before.txt: only a rovo-test row added
```

Enable the agent (per user; no admin toggle is documented): Jira → **Chat** → agent selector → **Browse agents** → "ScenarioForge identity probe" → **Enable** ([hello world tutorial](https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-agent/)). Known issue: if Rovo was activated after the install, the agent may be missing until a redeploy ([community 86838](https://community.developer.atlassian.com/t/rovo-agent-missing-after-rovo-activation-deployment-required-to-restore-functionality/86838)). Then "Run the identity probe" (×3 places, §1.4) and "Run the storage probe" (×1). About 5 chat messages.

### 4.3 Gate and phase 2

- Identity "Works" and S1–S9 as expected: Lane A builds the M6 handlers (M6_PLAN §10 steps 2–4), removes both probes and deploys `forge deploy -e rovo-test` (minor; same scopes). The admin turns AI on in Settings only when the owner starts the scripted session (M6_PLAN §8.3).
- Identity fails: handlers ship with `ACTION_USER_IDENTITY_SUPPORTED = false` (§1.3), or the owner decides not to deploy the agents. Storage fails: AI stays off; adapter fix first.
- `rehearsal-run` and `explain-outcome` are a separate later deploy after §2.3 is approved.

### 4.4 Monitoring

- `forge logs -e rovo-test --since 15m --grouped` during each session; `forge logs -e rovo-test -f action-whoami-probe` for one function (`-f` is `--functionKey`, not follow). Logs contain key names, enum results and error names only, never account ids, issue text or page text.
- Governor snapshot: `getUsage()` through the admin Settings panel (Lane B) after each block of tests: committed / cap, in-flight, `expiredUnits`, per-user today. Until that panel exists, an admin-only resolver returns the snapshot JSON. "Estimated units, not Atlassian's billing meter."
- Atlassian meter: owner reads Rovo credit usage in Atlassian Administration before and after the session (M6_PLAN §8.3, A7).

### 4.5 Kill switch (fastest first)

| Step                     | How                                                                                        | Effect / latency                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1. Stop chatting         | The tester stops sending messages                                                          | Chat credits are only charged per user message (§5)                             |
| 2. Opt-in off            | Admin turns "Enable AI features for this site" off in Settings (writes `aiEnabled: false`) | Next action call answers `USAGE_LIMITED`; immediate; needs storage reachable    |
| 3. Code kill switch      | `BudgetPolicy.enabled = false` (reviewed one-line change), `forge deploy -e rovo-test`     | Everything `DISABLED` without touching storage; minutes                         |
| 4. Uninstall `rovo-test` | §4.6                                                                                       | Agents disappear from the site; nothing of ScenarioForge-on-`rovo-test` can run |
| 5. Org spend             | Org admin keeps extra usage off / limit at 0 (§5.3)                                        | Caps Rovo chat spend for the whole org, including outside ScenarioForge         |

### 4.6 Rollback

1. `forge install list` → note the `rovo-test` installation id.
2. `forge uninstall -i <installationId>` (or `forge uninstall --site one-atlas-cegq.atlassian.net --product jira -e rovo-test`). Use the id form so no other installation can be selected.
3. `forge install list` → diff with `before.txt`: identical.
4. `forge deploy list -e development` / `-e confluence-test`: same versions as pre-check 5.

**Stored data after uninstall (verified, with gaps).** [Data lifecycle for Forge-hosted storage](https://developer.atlassian.com/platform/forge/storage-reference/hosted-storage-data-lifecycle/) (28 Sep 2026): data "is first 'soft deleted' and then retained for the rest of the retention period" (period not stated on the page; it refers to the SOC 2 report); a reinstall "is treated as a new installation"; relinking to old data is possible "if a request is made within 21 days of uninstallation." So a reinstall starts with an empty ledger and **no opt-in** (fail closed), and old ledger rows are not visible to it. The entity **definitions** stay in the app regardless of uninstall (§2.1). Only governance ledger, settings, cache and probe keys exist on `rovo-test`; no Jira or Confluence text is stored in phase 1.

### 4.7 Why `development` and `confluence-test` are untouched

- Every deploy, install, logs and uninstall command names `-e rovo-test` (or an installation id from `rovo-test`).
- Storage is per environment ("An app can only access its data for the same environment").
- Pre/post `forge install list` and `forge deploy list` comparisons (§4.1 step 4–5, §4.6 step 3–4) are recorded in `docs/M6_LIVE_TEST.md` (acceptance A6).
- No scope or entity reaches `development`/`confluence-test` until a separate approval; lint shows they would require a major-version approval.
- Residual risk: `manifest.yml` is shared by all environments. The `rovo-test` manifest lives on its own branch until the owner approves merging; merging alone deploys nothing.

---

## 5. Budget settings and expected credit use

### 5.1 Governor policy on `rovo-test`

| Control                 | `rovo-test` value                                                      | Mechanism                                    |
| ----------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| Code kill switch        | `enabled: true`; one test sets `false` and redeploys (M6_PLAN #15)     | `DEFAULT_POLICY.enabled` (code, reviewed)    |
| Per-installation opt-in | **absent at install → `DISABLED`**; admin enables only for the session | Stored `ai-governance:settings.aiEnabled`    |
| `monthlyUnitCap`        | 500 units (≈50 governed calls)                                         | Code default; stored settings may only lower |
| Cap-exhaustion test     | lowered to 30 for test 13, then restored                               | Settings (lowering only)                     |
| `perUserDailyCap`       | **300 units (30 calls) on `rovo-test` only**; 50 everywhere else       | Forge variable, clamped in code (§5.2)       |
| Rate limit              | burst 3, refill 1/min per (user, operation)                            | Code default                                 |
| Reservation timeout     | 300 s, expired charged at estimate                                     | Code default                                 |
| Response cache          | 900 s TTL, 200 entries, per user                                       | Code default                                 |
| Cost per governed call  | 10 units (upper bound)                                                 | `DEFAULT_COSTS`                              |

### 5.2 Raising the per-user cap only on `rovo-test`

`forge variables set` exists with `-e, --environment` and `--encrypt`, and "you must run `forge deploy` for the changes to take effect" ([variables set](https://developer.atlassian.com/platform/forge/cli-reference/variables-set/), 12 Oct 2026; also `forge variables set --help` on CLI 15.1.0). Values are separate per environment ([Environments and versions](https://developer.atlassian.com/platform/forge/environments-and-versions/)).

| Option                                                                                                                                                   | Risk                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Code constant keyed on the environment (e.g. `getAppContext().environmentAri` equals the `rovo-test` id)                                              | Reviewed, but ties code to an environment id; `environmentType` alone cannot tell `rovo-test` from `development` (both are development-type) [Unverified]; a wrong id silently keeps the default                                                                                                                        |
| **B. Forge variable + reviewed ceiling (recommended)** `forge variables set -e rovo-test SF_AI_PER_USER_DAILY_CAP 300`, then `forge deploy -e rovo-test` | Code reads `process.env.SF_AI_PER_USER_DAILY_CAP`; accepts only an integer in [50, 300] (`PER_USER_DAILY_CAP_CEILING = 300`, reviewed constant); anything else, or absent, gives 50. Other environments have no variable, so they keep 50. Worst case is bounded by the reviewed ceiling, and a change needs a redeploy |

B is safer: identical code in every environment, no environment-identity check, a misconfiguration can only lower the cap, and the maximum is still set by code review. `monthlyUnitCap` is **not** made configurable. The variable is not secret, so `--encrypt` is not needed.

### 5.3 Expected credit use

| Item                                                   | Count                | Credits (10 per basic agent event, [How Rovo credits work](https://support.atlassian.com/rovo/docs/rovo-usage-limits/)) | Controlled by the app?                                                       |
| ------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Phase 1 probes                                         | ~5 messages          | ~50                                                                                                                     | **No** ("In chat, each user message is a billable event")                    |
| Phase 2 scripted session (M6_PLAN §8.3)                | ~28 messages         | ~280                                                                                                                    | **No**                                                                       |
| Retries and follow-ups (×3 margin)                     |                      | up to ~1,000 total                                                                                                      | **No**                                                                       |
| Possible separate billing per action call [Unverified] | ≤2 calls per message | worst case ~2× the above                                                                                                | Partly: governor caps governed calls at 50/month (500 units) and 30/user/day |
| Enriched Teamwork Graph calls                          | 0 (none in M6)       | 0                                                                                                                       | Yes, if ever added                                                           |
| **Approval asked**                                     |                      | **≤ 1,000 credits ≈ 0.5% of 195,000** (owner-reported allowance, resets 5 Dec 2026)                                     |                                                                              |

Governor units are app-side estimates and will not match Atlassian's meter. "Extra usage is enabled by default" and extra-usage billing takes effect on 3 Dec 2026 (same page), so the org setting is checked, not assumed.

**Admin steps to confirm extra usage is off (owner, browser).** As given to the owner: admin.atlassian.com → **Billing and subscriptions** → **Rovo credits** → **Update extra usage limit**; set it off (or the limit to 0) and save; screenshot for the record. Atlassian describes the same path in [Manage extra usage for a meter](https://support.atlassian.com/subscriptions-and-billing/docs/manage-extra-usage-for-a-meter/); a billing admin can also change it. Record the current Rovo credit usage at the same time.

---

## 6. Owner approvals still required, in order

1. [ ] **Schema** (§2.3): `ai-governance` as on lane-a2 (`version` + `payload`, no index) becomes permanent; `rehearsal-run` option A or B decided later; no `rehearsal-fix` in M6.
2. [ ] **`storage:app`** for `rovo-test` only (D17), with the five-scope list in §3 frozen for that environment.
3. [ ] **Merge lane-a2 into a `rovo-test` build branch** (not into `manifest.yml` on the integration branch).
4. [ ] **Pre-checks** done and extra usage confirmed off (§4.1, §5.3).
5. [ ] **Phase 1 deploy and install** to `rovo-test` with the test-only `identity-probe` agent and `whoami-probe`/`storage-probe` actions; enabling the agent in Browse agents; ~50 credits.
6. [ ] **Gate decision** from the spike results: proceed, or ship M6 actions disabled (§1.3). No `asApp()`, no impersonation unless separately decided.
7. [ ] **`perUserDailyCap` 300 on `rovo-test`** via the clamped Forge variable (§5.2).
8. [ ] **Phase 2 deploy** of the M6 agents and GET actions to `rovo-test` (agents visible to site users; Atlassian safety screening).
9. [ ] **Credit budget** for the scripted session, ≤1,000 credits in total, and turning the per-installation AI opt-in on for the session.
10. [ ] **Test fixtures** (injection page, injection issue, second restricted user; M6_PLAN §8.4 item 6).
11. [ ] **Later and separate:** `rehearsal-run` entity and `explain-outcome`; `rovo:mcp` and external MCP exposure; any deploy to `development`, `confluence-test` or production (major version there).

## 7. Still unverified

- `asUser()` inside an action invoked from Rovo chat; where `accountId` sits (`context` vs `payload.context`); whether `context.moduleKey` (or `getAppContext().moduleKey`) is the action key (§1.4 answers the first two).
- `notExists` create-only on a missing key and the failed-condition error shape (§2.5 answers both).
- Whether entity permanence is per environment or per app.
- Whether agents/actions/`rovo:mcp` modules need any scope or cause a major version (no page says so; lint says neither).
- Whether each action call is billed separately from the chat message.
- Soft-delete retention period for Forge-hosted storage after uninstall.
- An admin-level switch for Forge agent visibility (only per-user Browse agents → Enable is documented).
- Forge personal-data obligations for stored account ids.
