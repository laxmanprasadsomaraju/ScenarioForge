# AI usage governance (Lane D)

Date: 2026-11-09. Code: `shared/agents/budget.ts`, `shared/agents/cache.ts`, `shared/agents/storage.ts`. Tests: `test/budget.test.ts`. Nothing here is wired into `manifest.yml` or `src/index.ts` yet.

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

## 6. Forge storage adapter (described, not implemented)

`@forge/kvs` is not a dependency, and package files belong to Lane A, so the adapter is not in this branch.

**Verified API facts:**

- `import { kvs } from '@forge/kvs'`, scope `storage:app` ([Storage API basic](https://developer.atlassian.com/platform/forge/runtime-reference/storage-api-basic/)). `kvs.get` is "strictly consistent"; `get` returns `undefined` for a missing key; by default `set`/`delete` are **last write wins**; "Writes to individual keys are atomic."
- `kvs.set(key, value, { ttl?, keyPolicy?: 'OVERRIDE' | 'FAIL_IF_EXISTS', returnValue?, returnMetadataFields? })`, and TTL up to one year. Expired data can take up to 48 hours to be deleted ([KVS API](https://developer.atlassian.com/platform/forge/storage-reference/kvs-api/)).
- Plain KVS `kvs.transact().set/.delete(...).execute()` is all-or-nothing, but **has no conditions** ([KVS transactions](https://developer.atlassian.com/platform/forge/storage-reference/kvs-transactions/)).
- **Conditional writes exist only in the Custom Entity Store**: `kvs.transact().set(key, value, { entityName, conditions })`, `.check(key, { entityName, conditions })`, with `conditions: new Filter().and(attr, FilterConditions.…)`; "if any condition is not met, the entire transaction will fail." At most 25 operations per transaction, and each key once ([Entity transactions](https://developer.atlassian.com/platform/forge/storage-reference/transactions-entities/)). `FilterConditions` include `equalTo`, `notExists`, and others ([Entities query](https://developer.atlassian.com/platform/forge/storage-reference/entities-api-query/)).

So **plain `kvs.set` cannot implement `expectedVersion`**. The adapter uses a custom entity:

```yaml
# manifest.yml (Lane A): verify syntax on the "Defining entities" page before use
app:
  storage:
    entities:
      - name: governance
        attributes:
          version: { type: integer }
          payload: { type: any }
permissions:
  scopes: [storage:app]
```

```ts
// src/ai/forgeStorage.ts (sketch)
import { kvs, Filter, FilterConditions } from '@forge/kvs';
const E = 'governance';
export const forgeGovernanceStorage: StorageAdapter = {
  async get(key) {
    const row = await kvs.entity<{ version: number; payload: unknown }>(E).get(key);
    return row ? { value: row.payload as never, version: row.version } : undefined;
  },
  async set(key, value, expected) {
    const version = (expected ?? 0) + 1;
    const conditions =
      expected === null
        ? new Filter().and('version', FilterConditions.notExists())
        : new Filter().and('version', FilterConditions.equalTo(expected));
    try {
      await kvs
        .transact()
        .set(key, { version, payload: value }, { entityName: E, conditions })
        .execute();
      return { ok: true, version };
    } catch (error) {
      if (isConditionFailure(error)) return { ok: false, reason: 'CONFLICT' };
      throw error; // outage: the governor denies
    }
  },
  delete: (key) => kvs.entity(E).delete(key),
};
```

If a condition failure cannot be told apart from an outage, `isConditionFailure` can return `false`. The governor then treats every failed write as `UNAVAILABLE` (deny). That is still safe, just less tolerant of concurrent use. Cache entries should also get a KVS `ttl` equal to the cache TTL, so orphaned entries clean themselves up.

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
- **Custom Entity Store details:** the exact `notExists()` / `equalTo()` names (the docs' tables and examples disagree: `equalTo` vs `equalsTo`), whether a `notExists` condition works for create-only on a missing key, the error shape of a failed condition, and the `storage.entities` manifest syntax. All need a Lane A spike before use.
- **Whether `kvs.entity().get` is strongly consistent** like `kvs.get`. If it is eventually consistent, conflicts are still caught by the conditional write, but reads may retry more.
- **Whether `context.accountId` is always present** for actions invoked from chat, Automation or MCP (BONUS_FEASIBILITY.md §2). If it is missing, the request is `INVALID` and denied.
- **Whether `@forge/kvs` works with our `@forge/api` 8.x** and the Node 24 runtime. Not installed here.
