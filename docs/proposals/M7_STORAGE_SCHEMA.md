# M7 / M8 permanent storage schema proposal

Prepared 2026-11-11 (Lane 2, branch `m78/integration`). **Proposal only. Nothing here is approved, deployed or executed.** Entity and attribute names and types cannot be renamed or removed after the first deploy to any environment, so this is the smallest schema that supports the code as written.

Source of truth: `manifest.yml` (`app.storage.entities`), `src/platform/storageFactory.ts`, `src/crisis/resolvers.ts` (`roomKey`), `src/remediation/create.ts` (`remediationRecordKey`).

## Entities needed for M7 and M8

| Entity             | Fields                              | Key pattern                            | Why                                                                                                                                                                                     |
| ------------------ | ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crisis-room`      | `version` integer, `payload` string | `sfc1:<installation>:room:<roomId>`    | One bounded event log per room (max 400 events, 200 KB, under the 240 KiB value cap). `version` backs the conditional write that makes two racing commands resolve to one winner.       |
| `remediation-item` | `version` integer, `payload` string | `remediation-item:<idempotency label>` | One approval/audit record per fix: state machine, request hash, link outcomes, audit lines. `version` backs the `approved -> creating` conditional write that prevents a double create. |

Both reuse the shape already proposed for `ai-governance` and `rehearsal-history` (`version` + JSON `payload`, no custom indexes, every lookup by key). `payload` is a string because the Custom Entity Store has no JSON-document type in this app's usage.

## Fields and why each is needed

- `version` (integer): optimistic concurrency token. Without it two commanders or two clicks could both succeed.
- `payload` (string): JSON text of the room record or remediation record. Holds everything else so the schema never has to change when the record grows.

## What can be dropped

- **No separate entities** for participants, invites, proposals, messages or timeline. They are derived by folding the event log (`rebuildRoom`), which also lets the engine reject a forged log.
- **No room index / list-by-user entity.** Rooms are reached by id from an invite link; there is deliberately no "my rooms" listing. Dropping it avoids a second permanent entity and any per-user enumeration.
- **No Realtime state entity.** Realtime (optional, flag off, not implemented in this build) would carry only `{ roomId, version }` and needs no storage.
- **`remediation-item` can be dropped** if the owner never approves `write:jira-work`: with no writer the create path refuses before touching storage (`WRITE_NOT_PERMITTED`). `crisis-room` can be dropped if multiplayer is cut. The two are independent.
- Custom indexes: none requested.

## Retention and size

Rooms expire within 24 h in the engine; stored values are not auto-deleted (a cleanup job is not built). Per-value bound 240 KiB (`FORGE_MAX_VALUE_BYTES`). Account ids stay inside the stored log only; the browser never receives the raw log and logs never contain ids.

## APPROVAL REQUEST (not approved, not executed)

Owner to answer in their own words, per environment: (1) permit the `crisis-room` entity (permanent once deployed) on a named test environment; (2) permit the `remediation-item` entity separately, only together with a decision on `write:jira-work` and a separate write-test environment (see `M8_TEST_DEPLOY.md`). Both entities are already declared in `manifest.yml` on `release/judged-full`; this lane did not change the manifest.
