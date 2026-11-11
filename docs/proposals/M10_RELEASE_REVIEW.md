# M10 release review: `release/judged-full`

Status: **REVIEW AND PLAN ONLY. Nothing deployed, merged elsewhere, shared, or configured.** No Forge environment was created and no Forge variable was set. Prepared 2026-11-11 on branch `release/judged-full`, based on `integration/lanes-1` @ `f0e5a60`. Companion to [M10_FEATURE_COMPLETE_RELEASE.md](M10_FEATURE_COMPLETE_RELEASE.md) (decisions F1–F9).

Owner approval so far: preparing this branch and an isolated release-test **plan**. F2 (the CLAUDE.md exception for bringing `rovo-test/*` code into another branch) has **not** been granted, so this branch must not be merged into any other branch. F3–F9 are not approved.

## 1. Assembly

| Step | Source                                                                                                                          | Method              | Result                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| 1    | `integration/lanes-1` @ `f0e5a60` (M7 resolvers, M8 create path, history resolvers, TWG gateway)                                | branch base         | —                                                 |
| 2    | `origin/m9/mcp` @ `c2b28fc`, which linearly contains `rovo-test/build` (`09d555b`…`77e1262`) and `rovo-test/phase2` (`abbe8d6`) | one `--no-ff` merge | no textual conflicts (`src/index.ts` auto-merged) |
| 3    | Release edits (this commit)                                                                                                     | hand edits          | see §2                                            |

The merge also brings the rovo-test docs (`M6_PHASE1_ACCEPTANCE.md`, `M6_PHASE2_TEST_SCRIPT.md`, `M6_ROVO_TEST_RUNBOOK.md`, `M9_MCP_RUNBOOK.md`). They are historical records and still name the old `SF_ROVO_TEST_*` variables. The Phase 1 probe code (`src/probes/*`) is kept with its tests. It is not exported from `src/index.ts` or declared in the manifest, so it cannot run.

## 2. Conflicts found and resolved

None of these were textual. Each one surfaced as a failing test or in review after the merge.

| #   | Conflict                                                                                                                      | Between                                            | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Environment-specific flag names `SF_ROVO_TEST_STORAGE`, `SF_ROVO_TEST_AI`, `SF_ROVO_TEST_USER_DAILY_CAP`                      | rovo-test vs. a release build                      | Renamed to `SF_STORAGE`, `SF_AI`, `SF_USER_DAILY_CAP` (constants `STORAGE_FLAG`, `AI_FLAG`, functions `siteStorageEnabled`, `siteAiEnabled`). Semantics are unchanged: off unless the value is exactly `enabled`. **Consequence:** `rovo-test` currently has the old names set, so if this build were ever deployed there, the variables would need to be set again under the new names. Until then everything stays off. |
| C2  | M7 `crisisStorage = () => null` hard-coded in `src/index.ts`                                                                  | integration (M7) vs. storage factory (rovo-test)   | Wired to the new `crisisStorage()` factory in `src/platform/storageFactory.ts`, entity `crisis-room`. It is null unless `SF_STORAGE=enabled` **and** `SF_CRISIS=enabled`. Tests added.                                                                                                                                                                                                                                    |
| C3  | Settings screen truth: `shared/environment.ts` listed `storage:app` as "not requested", while the merged manifest requests it | integration (four scopes) vs. rovo-test (five)     | Moved `storage:app` into `MANIFEST_SCOPES` and noted that it is off unless an admin enables it. Updated `static/app/test/Settings.test.tsx`.                                                                                                                                                                                                                                                                              |
| C4  | Schema test expected exactly two entities                                                                                     | rovo-test vs. M10 proposal (four)                  | Updated the test to the four proposed entities, and made the test locate the `entities:` block independently of the new comment banner.                                                                                                                                                                                                                                                                                   |
| C5  | Manifest comments said "rovo-test ONLY"                                                                                       | rovo-test vs. release                              | Rewrote them for the release branch. The entity block now sits under a **PROPOSED / PERMANENT** banner.                                                                                                                                                                                                                                                                                                                   |
| —   | History resolvers                                                                                                             | integration (null factory) vs. rovo-test (factory) | Already resolved upstream in `a4976a8`. `historyStorage` comes from the factory and is gated by `SF_STORAGE`.                                                                                                                                                                                                                                                                                                             |
| —   | M8 writer                                                                                                                     | —                                                  | Left alone: `productionRemediationWriter()` and `productionRemediationStorage()` still return null, and the existing test still asserts this. `write:jira-work` is not requested.                                                                                                                                                                                                                                         |
| —   | TWG                                                                                                                           | —                                                  | Left alone: `SF_TWG` is unset, so the gateway returns `not-connected`. No `read:graph:*` scopes are in the manifest.                                                                                                                                                                                                                                                                                                      |

## 3. Entities (PROPOSED, permanent once deployed anywhere)

All four have the same shape: attributes `version: integer` (32-bit signed, used for conditional writes through `kvs.transact()`) and `payload: string` (JSON text). There are no indexes, and every lookup is by key. Adapter limits (`src/ai/forgeStorage.ts`): 240 KiB per record and keys of 2–500 characters.

| Entity              | Key prefixes                                                                                          | Written by                                                                                                           | App-level size limits                                  | Retention                                                                                | Deployed today   | Permanence                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-governance`     | `ai-governance:settings`, `ai-governance:ledger:<YYYY-MM>`, `ai-cache:index`, `ai-cache:entry:<hash>` | `UsageGovernor` (shared/agents/budget.ts), `ResponseCache` (shared/agents/cache.ts), via `governanceStorage()`       | cache: max 200 entries                                 | cache TTL 900 s; one ledger per month (no automatic deletion)                            | `rovo-test` only | Permanent for the app id once deployed (already true on rovo-test)                                                                     |
| `rehearsal-history` | `sfh1:<inst>:<account>:index`, `…:run:<id>`, `…:retest:<id>`                                          | `HistoryStore` (shared/history/store.ts), through history resolvers, crisis debrief save and `explain-outcome` reads | 200 KiB per value, 50 runs per user, 5 retests per run | 90 days, pruned on write                                                                 | `rovo-test` only | Same as above                                                                                                                          |
| `crisis-room`       | `sfc1:<inst>:room:<roomId>`                                                                           | `src/crisis/resolvers.ts`, via `crisisStorage()`                                                                     | 400 events, log ≤ `MAX_VALUE_BYTES` (200 KiB)          | room 8 h (max 24 h), invite 4 h (max 24 h). Expired records are refused but not deleted. | **nowhere**      | Becomes permanent on first deploy                                                                                                      |
| `remediation-item`  | `remediation-item:<idempotencyLabel>`                                                                 | `src/remediation/create.ts`, but production storage is `null`, so **nothing writes it in this build**                | record ≤ 240 KiB                                       | none defined (reserved)                                                                  | **nowhere**      | Becomes permanent on first deploy. It is reserved, so it could be dropped from the manifest before the first deploy if M8 stays gated. |

## 4. Scopes, modules, dependencies

| Item                                          | Kind   | Justification                                                                                                                   |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `read:jira-work`                              | scope  | Search issues and read their fields (all features)                                                                              |
| `read:jira-user`                              | scope  | Calling user's own profile (connection check)                                                                                   |
| `search:confluence`                           | scope  | CQL search for runbooks (titles and links)                                                                                      |
| `read:page:confluence`                        | scope  | One runbook body via v2 pages API                                                                                               |
| `storage:app`                                 | scope  | Required by `@forge/kvs`. Unused at runtime unless `SF_STORAGE=enabled`. Triggers a **major version upgrade** (forge lint, §8). |
| `global:fullPage` ×1                          | module | The app                                                                                                                         |
| `rovo:agent` ×2                               | module | Recovery Investigator, Exercise Facilitator (read-only)                                                                         |
| `action` ×4, all `actionVerb: GET`            | module | find-recovery-risks, get-service-readiness, prepare-rehearsal, explain-outcome                                                  |
| `rovo:mcp` ×1                                 | module | The same four actions as MCP tools. No new scopes or functions. External exposure is up to the admin.                           |
| `function` ×5                                 | module | resolver + 4 action handlers                                                                                                    |
| `@forge/api` ^8.5.0, `@forge/resolver` ^2.0.2 | dep    | Existing                                                                                                                        |
| `@forge/kvs` 2.1.2 (pinned)                   | dep    | Custom Entity Store and conditional writes                                                                                      |
| Not included                                  | —      | `write:jira-work` (M8), `read:graph:*` (TWG), `@forge/realtime` (M7 polling only)                                               |

## 5. Flag matrix (Forge environment variables)

| Variable                | Default (unset) | Allowed value  | Effect when set                                                                                                | Depends on                                          |
| ----------------------- | --------------- | -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `SF_STORAGE`            | off             | `enabled`      | Storage factories return Forge adapters. Enables history, the governance ledger and the cache.                 | —                                                   |
| `SF_AI`                 | off             | `enabled`      | Site AI opt-in. Without it every agent or MCP action answers USAGE_LIMITED, spends nothing and makes no calls. | `SF_STORAGE` (the governor is null without storage) |
| `SF_USER_DAILY_CAP`     | 50              | integer 50–300 | Per-user daily cap. Out-of-range or malformed values fall back to 50.                                          | `SF_AI`                                             |
| `SF_CRISIS`             | off             | `enabled`      | Crisis rooms get the `crisis-room` entity. Otherwise every crisis resolver answers UNAVAILABLE.                | `SF_STORAGE`                                        |
| `SF_TWG` (+ `TWG_QK_*`) | off             | `enabled`      | Teamwork Graph enrichment. **Must stay unset.** The scopes are not in the manifest.                            | not shippable                                       |
| (none)                  | M8 writer null  | —              | Code constant. Creation always answers WRITE_NOT_PERMITTED.                                                    | needs code change + `write:jira-work`               |

## 6. Capability evidence

Only recorded evidence is used. "Live verified" links to the record.

| Capability                                                   | Code complete                                                 | Automated tests     | Deployed where                            | Live verified (evidence)                                                                                                          | Accepted     |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| M0–M5 core (analysis, graph, rehearsal, Confluence runbooks) | yes                                                           | yes                 | development / confluence-test             | yes: [M3_LIVE_TEST](../M3_LIVE_TEST.md), [M4_M5_LIVE_TEST](../M4_M5_LIVE_TEST.md), [M2_CONFLUENCE_TEST](../M2_CONFLUENCE_TEST.md) | **yes**      |
| Sidebar UI                                                   | yes                                                           | yes                 | development                               | yes: [UI_SIDEBAR_ACCEPTANCE](../UI_SIDEBAR_ACCEPTANCE.md)                                                                         | **yes**      |
| Forge storage adapter (identity + storage probes)            | yes                                                           | yes                 | rovo-test                                 | yes, 12/12: [M6_PHASE1_ACCEPTANCE](../M6_PHASE1_ACCEPTANCE.md)                                                                    | Phase 1 only |
| Rovo agents, AI off (Block A)                                | yes                                                           | yes                 | rovo-test                                 | user-facing passed A1/A2: [M6_PHASE2_LIVE_TEST §Block A](../M6_PHASE2_LIVE_TEST.md)                                               | partial      |
| Rovo agents, AI on (governor, cap, cache)                    | yes                                                           | yes                 | rovo-test (flag unset)                    | **pending**                                                                                                                       | no           |
| Rehearsal history on Forge storage                           | yes                                                           | yes                 | rovo-test (flag on)                       | storage probe H1–H3 only, no UI history test recorded                                                                             | no           |
| MCP (`rovo:mcp`)                                             | yes                                                           | yes (manifest test) | **none**                                  | no                                                                                                                                | no           |
| M7 Crisis Room                                               | resolvers yes; UI on `m7/crisis-room-ui` (not in this branch) | yes                 | **none**                                  | no                                                                                                                                | no           |
| M8 remediation create                                        | yes (writer null)                                             | yes                 | development (prepare only, write refused) | no live create                                                                                                                    | no           |
| TWG enrichment                                               | yes (flag off)                                                | yes                 | **none**                                  | no                                                                                                                                | no           |

## 7. Recommendation (safest release)

**Include now**, if the owner approves F3–F5:

1. The M0–M5 core and the sidebar. Both are accepted.
2. `storage:app`, the history and governance entities, and history. History ships with `SF_STORAGE=enabled` **only after** a release-test history check passes. Otherwise leave it unset, and history degrades to "Not enabled in this environment".
3. The two Rovo agents and the four GET actions, with **`SF_AI` unset** (AI off, F8). This is the Block A behaviour, which already passed live.

**Gate, deploying the code but keeping the flag off:**

- Crisis rooms: the UI is not on this branch, and there is no live test (`SF_CRISIS` stays unset).
- AI on: this waits for Block B evidence.

**Hold until there is evidence or approval:**

- MCP. It is untested anywhere, so drop the `rovo:mcp` block before release unless the release-test run passes.
- M8 writes. The writer stays null.
- TWG. The flag stays unset and the scopes stay out of the manifest.
- **Entities.** Declare `crisis-room` and `remediation-item` only if the owner accepts that they become permanent even if the features never ship (F4). The safest option is to remove `remediation-item` before the first deploy.

## 8. Gate results on this branch

| Gate                                        | Result                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` / `frontend:typecheck`  | pass / pass                                                                                                                                                        |
| `npm run lint`                              | pass                                                                                                                                                               |
| `npm test`                                  | 36 files, 1032 tests pass                                                                                                                                          |
| app tests (`static/app`)                    | 20 files, 172 tests pass                                                                                                                                           |
| `npm run frontend:build`                    | pass. The build contains no `previewFixtures`, `PREVIEW-14`, `bridgeStub` or `crisisPreview`.                                                                      |
| `prettier --check`                          | pass                                                                                                                                                               |
| sloplint (app scope)                        | clean: 0 FAIL / 0 REFLEX / 0 WARN, 80 files                                                                                                                        |
| `npm audit --audit-level=high` (root + app) | 0 vulnerabilities                                                                                                                                                  |
| `forge lint` (no deploy)                    | 0 errors, 0 warnings, 1 approval: `MAJOR_VERSION_RULE`, "major version upgrade in the default environment … Change due to scope modification" (from `storage:app`) |

## 9. Isolated release-test plan (PLAN ONLY, needs F7)

**Environment.** A new `release-test` Forge environment on the same judged app id, installed on a test site only. Do not use `development`, `confluence-test` or `rovo-test`. Note that entities deployed there become permanent for the **app id**, not just for that environment, so F4 must be approved first.

**Steps** (to be run by the owner):

1. `forge environments create release-test`. Then `forge deploy -e release-test` from `release/judged-full` @ SHA, and `forge install -e release-test` on the test site (Jira + Confluence).
2. **Run 1, all flags unset.** The app works with M0–M5. Settings lists five scopes. History shows "Not enabled". Crisis shows UNAVAILABLE. Both agents answer AI-off (repeats Block A). The MCP tools are listed. M8 create shows WRITE_NOT_PERMITTED.
3. **Run 2, `SF_STORAGE=enabled`.** Save a rehearsal run, list it, retest it, reload. Check that `explain-outcome` reads your own run and refuses another user's run.
4. **Run 3, `SF_AI=enabled`** (Block B; optional, and costs Rovo credits). Check that the per-user cap is enforced, that cache hits work, and that `aiEnabled:false` in stored settings switches AI off.
5. **Run 4, `SF_CRISIS=enabled`** (only if the UI has been merged). Test with two users using the M7 ten-step script.
6. **Logs.** `forge logs -e release-test --since 24h` should show no errors and no account ids, emails or names.

**Checks:** each run's result is recorded in a new `docs/M10_RELEASE_TEST.md` with the SHA, versions, variables and a screenshot or log link.

**Rollback:** `forge variables unset -e release-test <VAR>` turns a feature off immediately with no redeploy. To remove the build, run `forge uninstall -e release-test` and then delete the environment. Entities cannot be rolled back. Production is never touched.

## 10. Approval block

```
[ ] F2. Exception: release/judged-full contains rovo-test/* and m9/mcp code (merge, not cherry-pick).
[ ] F3. Five scopes incl. storage:app (major version upgrade).
[ ] F4. PERMANENT entities: ai-governance, rehearsal-history, crisis-room, remediation-item
        (or drop remediation-item / crisis-room before first deploy).
[ ] F5. Modules: rovo:agent x2, action x4 GET, rovo:mcp x1 (or drop rovo:mcp).
[ ] F7. Create `release-test` and run §9.
[ ] F8. Production: SF_AI unset; SF_CRISIS unset; SF_TWG unset; SF_STORAGE per §9 result.
[ ] F9. Production deploy + Sharing link (separate approval).
```
