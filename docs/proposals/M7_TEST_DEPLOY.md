# M7 proposal: Crisis Room test deploy

Status: **PROPOSAL. No manifest edit, no deploy.** Prepared 2026-11-11 from [M7_PLAN.md](../M7_PLAN.md), [M6_DEPLOYMENT_READINESS.md §2](../M6_DEPLOYMENT_READINESS.md) and the `rovo-test/phase2` manifest. Code state: engine, resolvers and polling UI are code complete with automated tests; `crisisStorage()` returns null everywhere.

## 1. Target environment

| Option                        | For                                                                                                                                    | Against                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`rovo-test`** (recommended) | Already has `storage:app` and two entities, so admins already consented; adding an entity is not a scope change. Installed (Jira, v2). | Its branch `rovo-test/phase2` carries Rovo modules; the M7 build must be cut from `rovo-test/phase2` + M7 code (a `rovo-test/m7` branch) so the Phase 2 agents are not removed. Jira only, no Confluence (M7 does not need it). |
| New `crisis-test` env         | Clean isolation; no interaction with Phase 2 agents or the AI flag.                                                                    | New env + install + first `storage:app` consent; `[Unverified]` whether entity permanence is per app (then isolation buys nothing for the schema, see M6_DEPLOYMENT_READINESS §2.1).                                            |
| `confluence-test`             | Same as the judged build                                                                                                               | Adds storage (major version) to the main test bed; breaks parity with the four-scope judged build. Not recommended.                                                                                                             |

Recommendation: **`rovo-test`**, branch `rovo-test/m7` = `rovo-test/phase2` merged with the M7 code from `integration/lanes-1`, `SF_ROVO_TEST_AI` stays unset. Per CLAUDE.md the branch never merges back into branches for other environments.

## 2. Storage

- Scope: `storage:app` (already on `rovo-test`).
- New entity, permanent once deployed (names and attributes cannot be removed; treat as app-wide):

```yaml
# PROPOSAL, not applied
app:
  storage:
    entities:
      - name: crisis-room
        attributes:
          version:
            type: integer
          payload:
            type: string
```

- No indexes: every lookup is by key. Key pattern `sfc1:<installationId>:room:<roomId>` (keys ≤ 500 chars, `[a-zA-Z0-9:._\s-#]`).
- Payload: JSON text `{ schema: 1, events: CrisisEvent[] }`, bounded by `MAX_EVENTS` 400 and `MAX_LOG_BYTES` 200 KB, under the 240 KiB per-value limit (https://developer.atlassian.com/platform/forge/limits-kvs-ce/). Writes are conditional on `version`.
- Room expiry 24 h is enforced by the engine; records are not auto-deleted. **[Unverified]** whether the entity store supports TTL; plan a manual cleanup resolver later or accept retained room logs on the test env.

## 3. Forge Realtime

| Item     | Finding                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packages | Backend `@forge/realtime` (`publish`, `publishGlobal`, `signRealtimeToken`); frontend `@forge/bridge` `realtime.subscribe*`. https://developer.atlassian.com/platform/forge/realtime/ , https://developer.atlassian.com/platform/forge/runtime-reference/realtime-events-api/                           |
| Scope    | None named on the Realtime pages (re-read 2026-11-11). **[Unverified]** until `forge lint` on the test branch reports no missing scope                                                                                                                                                                  |
| Status   | Overview says "Realtime is now available in Jira and Confluence" with a "Changes from EAP" section, no explicit label; GA announced in community post (3 Jul 2026, https://community.developer.atlassian.com/t/forge-realtime-is-now-generally-available-ga/101571). **[Unverified]** pricing/SLA terms |
| Limits   | 50 ops/s per installation, 1 MB per publish (https://developer.atlassian.com/platform/forge/limits-realtime/)                                                                                                                                                                                           |
| Role     | Doorbell only: `{ roomId, version }` on a token-secured channel; storage is the truth                                                                                                                                                                                                                   |

Recommended staging: deploy **storage + polling first** (step 1), add Realtime in a second deploy (step 2) only after step 1 passes. Step 2 adds a dependency, not a scope (if `forge lint` agrees), so it should be a minor version **[unverified]**.

## 4. Role permissions matrix

| Action                     | Owner | Commander | Eng. responder | Security responder | Comms lead    | Observer      |
| -------------------------- | ----- | --------- | -------------- | ------------------ | ------------- | ------------- |
| Issue / revoke invite      | Yes   | No¹       | No             | No                 | No            | No            |
| Assign roles, start, close | Yes   | No¹       | No             | No                 | No            | No            |
| Propose decision           | —     | Yes       | Yes            | Yes                | Yes           | No            |
| Commit decision            | —     | Yes       | No             | No                 | No            | No            |
| Stakeholder notice         | —     | Yes       | No             | No                 | Yes           | No            |
| Hand off command           | Yes   | Yes       | No             | No                 | No            | No            |
| Leave room                 | No    | No        | Yes            | Yes                | Yes           | Yes           |
| View room                  | Yes   | Yes       | Own role view  | Own role view      | Own role view | Observer view |

¹ Unless the commander is also the owner (the owner is commander at creation). Invites cannot grant commander; all invite failures return `INVITE_INVALID`. Source: `shared/crisis/` rules in [M7_PLAN.md §3](../M7_PLAN.md).

## 5. Two-user test plan

Needs two Atlassian accounts with Jira access on `one-atlas-cegq` (User B must be added by the owner as a site user; **[unverified]** whether the demo site has a free second seat). Run the ten steps of [M7_PLAN.md §5](../M7_PLAN.md) twice: once with Realtime off (polling) and once on. Record latency, outcomes and versions in a dated `docs/M7_LIVE_TEST.md`. Pass = all ten steps behave as specified; any server error on a write = fail.

## 6. Failure behaviour

| Failure                             | Behaviour                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Storage unavailable / throws        | Command rejected, nothing applied, UI shows "could not save, try again"; view keeps last version |
| Lost race                           | `STALE_VERSION`; client re-reads, retries only if the action is still valid                      |
| Stored log unreadable or forged     | `rebuildRoom` throws → "Room could not be read"; never served as empty                           |
| Realtime publish fails / over limit | Write still succeeds; publish error logged (no content); clients catch up by polling             |
| Realtime subscribe fails            | UI stays in polling mode, says "Updates every few seconds", never "live"                         |
| Value near 240 KiB                  | Engine bounds reject the command before write (`MAX_EVENTS`/`MAX_LOG_BYTES`)                     |

## 7. Rollback

- Code: redeploy `rovo-test/phase2` @ `abbe8d6` to `rovo-test`. The `crisis-room` entity definition **cannot be removed** once deployed (permanent); leaving it unused is harmless.
- Realtime: redeploy without the dependency; polling continues.
- Data: room records stay in `rovo-test` storage; uninstalling `rovo-test` removes the installation's data **[unverified: retention period after uninstall]**.

## APPROVAL REQUEST (M7 test deploy)

```
APPROVAL REQUEST — M7 Crisis Room test deploy
Owner: please reply in your own words to approve or reject each line.
[ ] B1. Create branch rovo-test/m7 (= rovo-test/phase2 + M7 code); it deploys only
        to `rovo-test` and is never merged into other branches.
[ ] B2. Add the PERMANENT storage entity `crisis-room` (attributes: version integer,
        payload string; no indexes; keys sfc1:<install>:room:<id>). I accept it can
        never be removed from this app.
[ ] B3. Deploy step 1 (storage + polling) to `rovo-test`; SF_ROVO_TEST_AI stays unset.
[ ] B4. After step 1 passes: add @forge/realtime (no new scope, if forge lint agrees)
        and deploy step 2 to `rovo-test`.
[ ] B5. Add a second user account to the demo site for the two-user test.
Not included: production, confluence-test, development, AI usage, any new scope.
Rollback I accept: redeploy rovo-test/phase2 @ abbe8d6; entity stays defined but unused.
```
