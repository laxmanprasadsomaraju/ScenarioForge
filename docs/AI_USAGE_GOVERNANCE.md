# AI usage governance (Lane D)

Date: 2026-11-09. Code: `shared/agents/budget.ts`, `shared/agents/cache.ts`, `shared/agents/storage.ts`. Tests: `test/budget.test.ts`. Forge adapter (2026-11-10, Lane A2): `src/ai/forgeStorage.ts`, `test/forgeStorage.test.ts`. Nothing is wired into `src/index.ts` yet, and the `storage:app` scope is on the branch only (D17).

**Owner requirement:** Rovo agent actions, MCP tools and enriched Teamwork Graph calls must never use credits unexpectedly. Paid extra usage is off on the demo org (195,000 credits/month, resets 5 Dec 2026). No allowance is assumed for any other org, and the app never turns on paid usage.

"Verified" below means read on an official Atlassian page on 2026-11-09 at the cited URL.

---

## 1. What this layer can and cannot control

| Spend                                                                                       | Who triggers it    | Can this layer stop it?                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| A user's Rovo chat message to our agent (10 credits per billable event, see §3)             | The user, in Rovo  | **No.** It is charged before our action runs. The governor can only make the action refuse cheaply.                                    |
| Work our action does that may cost credits (enriched Teamwork Graph calls, future AI calls) | Our code           | **Yes.** Every such call must go through `checkAndReserve` first.                                                                      |
| An agent repeatedly calling our action in one conversation                                  | Rovo orchestration | Partly: the rate limit and cache make repeats cheap for us. Whether Rovo bills each tool call is unverified (§8).                      |
| An org's overall Rovo spend                                                                 | Org admins         | No. Admins set it in Atlassian Administration. Atlassian says extra usage is **on by default** (§3), so we never rely on it being off. |

The layer therefore guarantees that ScenarioForge **adds** at most a capped, admin-approved amount, and that AI and enriched work is off until an admin turns it on.

## 2. Policy

| Control                  | Where                                     | Default                                   | Behaviour                                                                                                                                                       |
| ------------------------ | ----------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code kill switch         | `BudgetPolicy.enabled`                    | `true`                                    | `false` denies everything as `DISABLED` without touching storage. Flip and redeploy to stop all spend.                                                          |
| Per-installation opt-in  | Stored `ai-governance:settings.aiEnabled` | **absent, so `DISABLED`**                 | A new installation spends nothing until an admin enables AI in Settings. Malformed settings also mean `DISABLED`.                                               |
| Monthly installation cap | `monthlyUnitCap`                          | **500 units**                             | Committed plus in-flight units per UTC calendar month. Over the cap: `BUDGET_EXHAUSTED`, `scope: 'installation'`, `retryAfterSeconds` until the 1st, 00:00 UTC. |
| Per-user daily cap       | `perUserDailyCap`                         | **50 units** (5 calls)                    | Per `accountId` per UTC day. Over the cap: `BUDGET_EXHAUSTED`, `scope: 'user'`, retry at next UTC midnight.                                                     |
| Rate limit               | `rateLimit`                               | token bucket, capacity 3, refill 1/minute | Per (`accountId`, operation). Empty bucket: `RATE_LIMITED` with `retryAfterSeconds`. A released reservation does not refund its token.                          |
| Reservation timeout      | `reservationTtlSeconds`                   | 300 s                                     | A reservation never committed or released is charged **at its estimate** (we cannot know whether the call went out). Shown as `expiredUnits`.                   |
| Response cache           | `DEFAULT_CACHE_POLICY`                    | TTL 900 s, 200 entries                    | Identical (operation, user, normalized inputs, evidence fingerprint) returns the stored result.                                                                 |

Stored settings may set `monthlyUnitCap` and `perUserDailyCap`, but only **lower** than the code policy (`Math.min`). Raising a cap means changing code and going through review.

### Why these defaults

- **500 units ≈ 50 agent events a month.** That is 0.26% of the demo org's 195,000. It is enough for development, the demo video and judging, and small enough that a runaway loop costs about $5 at the list overage price ($0.01 per credit, §3). A Jira Standard org gets 25 credits per user per month (§3), so a 10-user Standard site has about 250. That is lower than our cap, which is why the per-installation opt-in, not the cap, is the main protection. The Settings panel will ask the admin to confirm or lower the cap when enabling.
- **50 units per user per day** keeps one person, or one agent loop on their behalf, from using the month's allowance in an afternoon.
- **3-call burst, then 1 per minute, per operation:** a person asking follow-up questions is not slowed down, while an agent calling the same tool in a tight loop is.
- **Charge the upper bound (10) for every operation:** Atlassian gives ranges, not prices per call, so we overestimate. `commit(id, actual)` lets a caller charge less when it knows the real cost (it cannot today, see §8).
- **Charge expired reservations:** an unsettled reservation means the handler crashed or timed out after reserving. The call may have gone out, so counting it is the fail-closed choice.

## 3. Cost table (estimates, app-side units)

From [How Rovo credits work](https://support.atlassian.com/rovo/docs/rovo-usage-limits/) (verified 2026-11-09): "In chat, each user message is a billable event"; basic chat and basic agents cost 10 credits per billable event; the "vast majority of enriched TWG API and tool calls are 1 to 10 Rovo credits per call", and single-product lookups and writes are free; "Extra usage is on by default", admins can set spending caps or turn it off; overage list price is $0.01 per credit. Forge action pricing is not on that page. [Forge platform pricing](https://developer.atlassian.com/platform/forge/forge-platform-pricing/) says Rovo credits are paid by the customer's org (cited in BONUS_FEASIBILITY.md §2).

| Operation (`GovernedOperation`) | Units | Basis                                                            |
| ------------------------------- | ----- | ---------------------------------------------------------------- |
| each `AgentActionKey` (6)       | 10    | One basic agent event (upper bound; per-call billing unverified) |
| `teamwork-graph-enriched`       | 10    | Upper end of "1 to 10" per enriched call                         |

Units are our own accounting. They are **not** Atlassian's meter, and they will drift from real billing.

## 4. Public API

```ts
// shared/agents/storage.ts
interface StorageAdapter {
  get<T>(key): Promise<{ value: T; version: number } | undefined>; // throws if unreachable
  set<T>(key, value, expectedVersion: number | null): Promise<{ ok: true; version } | { ok: false; reason: 'CONFLICT' }>;
  delete(key): Promise<void>;
}
class InMemoryStorage implements StorageAdapter

// shared/agents/budget.ts
new UsageGovernor({ storage, now: () => Date, policy?, newId?, maxAttempts? })
  .checkAndReserve({ operation, accountId })
      → { ok: true, reservationId, units }
      | { ok: false, reason: 'BUDGET_EXHAUSTED' | 'RATE_LIMITED' | 'DISABLED' | 'INVALID' | 'UNAVAILABLE',
          message, retryAfterSeconds?, scope? }
  .commit(reservationId, actualUnits)   → { ok: true, chargedUnits } | { ok: false, reason: 'UNKNOWN_RESERVATION' | 'INVALID' | 'UNAVAILABLE', message }
  .release(reservationId)               → same
  .settle(reservationId, { kind: 'succeeded', actualUnits? } | { kind: 'not-called' } | { kind: 'failed-unknown' })
  .getUsage()                           → { ok: true, usage: UsageSnapshot } | { ok: false, reason: 'UNAVAILABLE' }
DEFAULT_POLICY, DEFAULT_COSTS, validatePolicy, parseSettings, periodOf, dayOf, SETTINGS_KEY, ledgerKey

// shared/agents/cache.ts
new ResponseCache<T>({ storage, now, policy? })
  .get(parts)                     → { hit: true, value, evidenceIds, storedAt } | { hit: false, reason: 'MISS' | 'EXPIRED' | 'UNAVAILABLE' }
  .put(parts, value, evidenceIds) → { stored: true, evicted } | { stored: false, reason: 'FAILURE_NOT_CACHED' | 'UNKNOWNS_NOT_CACHED' | 'INVALID' | 'UNAVAILABLE' }
normalizeInputs, evidenceFingerprint, canonicalKey, hashKey
```

No method throws. Reservation ids are `YYYY-MM.<id>`, so a call that starts on 30 November and settles on 1 December is charged to November.

### Storage layout

| Key                            | Contents                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-governance:settings`       | `{ aiEnabled, monthlyUnitCap?, perUserDailyCap? }`, written by the admin Settings resolver                                                                            |
| `ai-governance:ledger:YYYY-MM` | One record per month: `committedUnits`, `expiredUnits`, open `reservations`, today's per-user units, active rate-limit buckets. Every change is one optimistic write. |
| `ai-cache:index`               | Hash to `{storedAtMs, expiresAtMs}`; bounds the entry count                                                                                                           |
| `ai-cache:entry:<16 hex>`      | `{ canonicalKey, value, evidenceIds, storedAtMs, expiresAtMs }`                                                                                                       |

All keys match the KVS key pattern `/^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/` and stay well under 500 characters ([KVS and Custom Entity Store limits](https://developer.atlassian.com/platform/forge/limits-kvs-ce/), verified). The ledger stays small: per-user data covers today only, full buckets are pruned, and reservations are removed when settled or expired. The 240 KiB value limit (same page) would need roughly thousands of concurrent users in one day.

### Failure semantics

- **Store unreachable** (any throw), or still conflicting after `maxAttempts` (default 3): `UNAVAILABLE`, which means **deny**. The caller must not make the call.
- **Settle fails** (`UNAVAILABLE`): the reservation stays open and is charged at its estimate when it expires. Spend is never under-counted.
- **Unknown call outcome** (timeout, error after sending): `settle(id, { kind: 'failed-unknown' })` charges the estimate. The action returns `NOT_ASSESSED`. **An unknown never becomes a pass**, consistent with D6.
- **Cache store errors**: a read error is a miss; a write error means not stored. Neither can cause spend without a reservation, because the budget check happens first.
- **Cache contents:** only `ok: true` results with no `unknowns` and no `status: 'not-assessed'`. Failures and partial results are never cached, so a transient outage is not repeated for 15 minutes.
- **Cache scope:** keys include the caller's `accountId`. Results are produced `asUser` (D3), so sharing them across users could show issues or pages someone cannot browse. A hit also compares the full canonical key, so a hash collision is a miss, not a wrong answer.

## 5. How Lane A wires it into action handlers

Per request, in this order:

```
1. validate inputs                       → INVALID_INPUT                    (no spend)
2. permission check (asUser, context.accountId) → FORBIDDEN                 (no spend)
3. governor.checkAndReserve({ operation, accountId: context.accountId })
      not ok → return ActionFailure (§5.1)                                  (no spend)
4. cache.get({ operation, scope: accountId, inputs, evidenceFingerprint })
      hit  → governor.release(id); return cached value                      (no spend)
5. make the governed call(s)
6. success, fully assessed → governor.settle(id, { kind: 'succeeded' }); cache.put(...)
   failed before sending   → governor.settle(id, { kind: 'not-called' })
   failed/unknown after    → governor.settle(id, { kind: 'failed-unknown' }); return NOT_ASSESSED
```

Notes for Lane A:

- **The evidence fingerprint comes from cheap reads.** Step 4 needs the evidence versions (Jira `updated`, Confluence page version). These are single-product `asUser` REST reads, which Atlassian lists as free; enriched graph calls are not. If the fingerprint itself needs an enriched call, check the cache before the enriched call, keyed on what the free reads give.
- **One reservation per governed call.** An action that makes two enriched graph calls reserves twice (`teamwork-graph-enriched`), so the caps reflect real fan-out.
- **Deterministic engine work** (scoring, simulation, remediation drafting from authored data) costs no credits and is **not** governed. Only operations in `GOVERNED_OPERATIONS` are.
- **`accountId` comes only from `context`**, never from inputs (BONUS_FEASIBILITY.md §2, rule 3). No `accountId`: `INVALID`, deny.
- **Construct the governor per invocation** with `now: () => new Date()` and the Forge adapter (§6). The functions are stateless.

### 5.1 Mapping denials to `ActionFailure`

`contracts.ts` `ActionFailure.code` has no budget code. Proposed mapping, without changing the contract: `DISABLED` / `BUDGET_EXHAUSTED` / `RATE_LIMITED` / `UNAVAILABLE` become `NOT_ASSESSED`, with the governor's `message` (and retry time, if any) as `message`. `INVALID` becomes `INVALID_INPUT`. A dedicated `USAGE_LIMITED` code is a contract-change proposal for the lead (D16-style), not done here.

## 6. Forge storage adapter (implemented, not deployed)

Code: `src/ai/forgeStorage.ts` (`ForgeEntityStorage implements StorageAdapter`). Tests: `test/forgeStorage.test.ts`. Dependency: `@forge/kvs` 2.1.2 (exact), which itself depends on `@forge/api` ^8.5.0, so it dedupes with ours (`npm ls`). The manifest declares the entity and `storage:app` on this branch only; it is **not deployed** (D17). No resolver uses the governor yet.

**Verified API facts** (official pages read 2026-11-10, plus the installed package's TypeScript types):

- Scope: "Using the `@forge/kvs` package requires the `storage:app` scope" ([Custom entities API](https://developer.atlassian.com/platform/forge/storage-reference/storage-api-custom-entities/)). `entity().get` "will always return current data"; `entity().query` "is eventually consistent" (same page). The adapter only uses `get` by key.
- Manifest: `app.storage.entities[]` with `name`, `attributes.<name>.type` (`string`, `integer`, `float`, `boolean`, `any`) and optional `indexes`. The key index is automatic. Entity names allow only `a-z 0-9 : - _ .` (so `ai-governance`, not camelCase). Entities and attributes "can't be deleted" once deployed, and `forge deploy --major-version` ignores the `storage` section ([Defining entities](https://developer.atlassian.com/platform/forge/storage-reference/entities-manifest/)). The store "strictly enforces attribute types"; `integer` is "a 32-bit signed integer"; strings "Must not be empty."
- Conditional writes: `kvs.transact().set(key, value, { entityName, conditions }).execute()`; "if any condition is not met, the entire transaction will fail"; "maximum of 25 operations"; "payload size of 4MB"; a transaction counts as one write ([Entity transactions](https://developer.atlassian.com/platform/forge/storage-reference/transactions-entities/)).
- Condition names: the docs table lists `equalTo` and `exists, notExists`, while its examples use `equalsTo` ([Entities query](https://developer.atlassian.com/platform/forge/storage-reference/entities-api-query/)). **Resolved from `node_modules/@forge/kvs/out/conditions.d.ts`:** `FilterConditions.equalTo(value)` and `FilterConditions.notExists()`; there is no `equalsTo`. They serialise as `EQUAL_TO` and `NOT_EXISTS`.
- Errors: non-2xx responses carry `code` and `message` ([KVS error handling](https://developer.atlassian.com/platform/forge/storage-reference/kvs-errorhandling/)). The package throws `ForgeKvsAPIError` with `code` and `responseDetails.status`. The transaction REST endpoint lists only 204 and an undescribed 400 ([Transaction REST API](https://developer.atlassian.com/platform/forge/rest/v1/api-group-transaction/)). **No page names the code for a failed condition.**
- Limits: "maximum of 500 characters" per key, pattern `/^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/`, "240KiB (RAW) per object", at most 20 entities per app ([KVS and Custom Entity Store limits](https://developer.atlassian.com/platform/forge/limits-kvs-ce/)).

**Design:**

| `StorageAdapter` call | Forge call                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `get(key)`            | `kvs.entity('ai-governance').get(key)`; record `{ version: integer, payload: JSON string }`       |
| `set(key, v, null)`   | transaction `set` with `Filter().and('version', FilterConditions.notExists())`, writes version 1  |
| `set(key, v, n)`      | transaction `set` with `Filter().and('version', FilterConditions.equalTo(n))`, writes version n+1 |
| `delete(key)`         | `kvs.entity('ai-governance').delete(key)` (missing key is not an error in the SDK)                |

- **Conflict detection without a documented code.** A rejected write is a conflict candidate only if it is a 400/409/412 response whose `code` is not a documented non-condition code (`INVALID_KEY`, `MAX_SIZE`, rate limits, and so on). The adapter then re-reads the key: if the stored version no longer equals `expectedVersion`, it returns `CONFLICT`; otherwise it rethrows. Network errors, 429 and 5xx always throw, so the governor answers `UNAVAILABLE` (deny). A write that may have been applied is never reported as a conflict, which would risk a double charge.
- **Guards before any call** (throw `ForgeStorageError`): key 2 to 500 characters matching the documented pattern; value must be JSON-serialisable; the whole record must be at most 240 KiB in UTF-8; version must fit a 32-bit signed integer. Malformed stored records throw on read.
- **Testability:** the adapter talks to a three-method `GovernanceKvsClient`. `forgeKvsClient()` is the real one; tests use an in-memory fake, and separately check (with `@forge/kvs` mocked) that the real client builds `NOT_EXISTS` and `EQUAL_TO` conditions on `version` for entity `ai-governance`.
- **No TTL on cache entries.** `StorageAdapter.set` has no TTL parameter, and the cache already bounds itself through `ai-cache:index` (200 entries). Adding entity TTLs is optional later work.

## 7. Admin visibility (described only)

An admin-only **Settings → AI usage** panel (Lane B UI, Lane A resolver):

- **Toggle "Enable AI features for this site"** (writes `aiEnabled`). Off by default. Turning it on shows the cap, the per-user cap and a reminder that Rovo extra usage is on by default in Atlassian Administration, with a link to check it.
- **Cap inputs** that accept only values ≤ the code defaults.
- **Usage meter** from `getUsage()`: committed / cap, in-flight, remaining, `resetsAt`, `expiredUnits` (shown as "charged after a timeout"), and today's top users by display name. It says plainly "Estimated units, not Atlassian's billing meter" and links to the Rovo usage page in Atlassian Administration.
- **`getUsage` returns `UNAVAILABLE`:** the panel shows "Usage could not be loaded". It shows no zero.
- The resolver checks site-admin permission server-side. The browser never writes the ledger.

## 8. Unverified

- **Whether a Forge `action` invocation, or each tool call within one chat message, is billed separately.** The credits page prices chat messages and agent invocations, not Forge actions. We cost each action as one agent event.
- **Exact cost of a given enriched Teamwork Graph query.** Only the "1 to 10" range is published, so we charge 10. The actual cost is not returned to the app, so `commit(id, actual)` gets the estimate.
- **The demo org's allowance (195,000) and reset date (5 Dec 2026)** are owner-reported, not checked by this lane.
- **The error code for a failed transaction condition.** Undocumented; the adapter confirms conflicts by re-reading the version instead (§6). Check the real code on a development deploy and, if it is distinctive, match it directly.
- **Whether `notExists()` on `version` matches a key that has no record at all** (create-only). The SDK accepts it and the semantics read that way, but no page says so. If it does not, the first write of each key fails, the re-read finds no record, and the adapter throws, so the governor denies. That fails closed, but it must be checked on a development deploy before AI actions ship.
- **Live behaviour of the whole adapter.** Everything is unit-tested against a fake; nothing has run against a real Custom Entity Store because the scope is not deployed (D17). Also unchecked live: index provisioning time for an entity with no custom indexes, and Node 24 runtime compatibility of `@forge/kvs` 2.1.2 (it loads and builds filters under Node 24 locally).
- **Whether `context.accountId` is always present** for actions invoked from chat, Automation or MCP (BONUS_FEASIBILITY.md §2). If it is missing, the request is `INVALID` and denied.
