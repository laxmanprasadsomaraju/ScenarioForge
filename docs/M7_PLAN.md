# M7 plan: collaborative Crisis Room

Status: engine (`shared/crisis/`), resolvers (`src/crisis/resolvers.ts`: `crisisStatus`,
`crisisOpenRoom`, `crisisView`, `crisisCommand`, `crisisInviteToken`, `crisisSaveDebrief`, behind a
null `crisisStorage()` factory) and the Crisis room UI (`static/app/src/pages/CrisisRoom.tsx`,
polling only) are code complete with automated tests (`test/crisisResolvers.test.ts`,
`test/crisisLink.test.ts`, `static/app/test/CrisisRoom.test.tsx`). Nothing changes `manifest.yml`,
permissions or deployment; no `@forge/realtime`. With storage null every environment shows "Team
rooms need storage that is not enabled in this environment". The shared running timeline is
`buildTimeline` (`shared/crisis/timeline.ts`), added because `buildDebrief` only works after the
session completes. No live collaboration is
claimed until the two-user test in §5 passes on a deployed build.

## 1. Platform facts (re-verified 2026-11-11)

| Fact                                                                                                                                                                                                                                                                                                                                        | Source                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forge Realtime: backend package `@forge/realtime` (`publish`, `publishGlobal`, `signRealtimeToken`); frontend `@forge/bridge` `realtime.subscribe` / `subscribeGlobal` / `publish` / `publishGlobal`.                                                                                                                                       | https://developer.atlassian.com/platform/forge/runtime-reference/realtime-events-api/ , https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/realtime/ |
| Status: the Realtime overview has a "Changes from EAP" section and says it "is now available in Jira and Confluence". A community post and changelog entry dated 3 July 2026 announce GA (moved from Preview). The reference pages themselves carry no status label. **To confirm by the lead before relying on GA terms (pricing, SLA).**  | https://developer.atlassian.com/platform/forge/realtime/ , https://community.developer.atlassian.com/t/forge-realtime-is-now-generally-available-ga/101571                    |
| Scopes: none of the Realtime pages lists a manifest scope or permission. Treat as "no new scope" only after `forge lint` on a branch confirms it.                                                                                                                                                                                           | pages above                                                                                                                                                                   |
| Security: "Realtime channels are always restricted to an app installation at a minimum." Default channel context = the module's Atlassian app context (e.g. same issue). `contextOverrides` narrows to Jira board/issue/project, Confluence content/space. Global channels "are not secured by the Atlassian app context" and need a token. | https://developer.atlassian.com/platform/forge/realtime/authorizing-realtime-channels/                                                                                        |
| Tokens: `signRealtimeToken(channel, claims, permissions?)` runs only in a resolver; claims are app-defined ("your responsibility to validate the claims before signing"); `permissions` can be `['subscribe']` only. Events published with a token reach only subscriptions with the same claims.                                           | same                                                                                                                                                                          |
| Publishing to non-global channels and `contextOverrides` work only for functions invoked from the frontend (not async events / web triggers). Resolvers can publish but cannot subscribe.                                                                                                                                                   | realtime-events-api, authorizing page                                                                                                                                         |
| Limits: 50 operations/s per installation (3,000/min), 1 MB payload per publish. Over-limit calls fail; retry with backoff.                                                                                                                                                                                                                  | https://developer.atlassian.com/platform/forge/limits-realtime/                                                                                                               |
| Delivery: no ordering or delivery guarantee is documented; `eventId` is null when there are no subscribers; `replaySeconds` replays recent events on subscribe.                                                                                                                                                                             | ui-api-bridge/realtime                                                                                                                                                        |
| Storage fallback: Custom Entity Store (`storage:app`, already proposed under D17) with one value per key ≤ 240 KiB (`FORGE_MAX_VALUE_BYTES` in `shared/history/keys.ts`).                                                                                                                                                                   | docs/M6_PLAN.md §3.2, §6                                                                                                                                                      |

## 2. Recommended architecture

**Storage is the source of truth; Realtime is only a "something changed" doorbell.**

1. One entity value per room: `{ version, payload: CrisisEvent[] }` at
   `sfc1:<installation>:room:<roomId>`. The log is bounded (`MAX_EVENTS` 400, `MAX_LOG_BYTES`
   200 KB, same budget as history) so it always fits one value.
2. Every write is a resolver call `crisisCommand({ roomId, expectedVersion, command })`. The
   resolver takes `actor` from `context.accountId` and `at` from the server clock, reads the
   log, runs `executeCommand`, and writes with the store's version check (same conditional-write
   pattern as `HistoryStore`). A lost race returns `STALE_VERSION`; the client re-reads and
   retries if the action is still valid.
3. Reads are `crisisView({ roomId })` → `roleView(rebuildRoom(log), accountId)`. The browser
   never receives the raw log (invite hashes, other roles' evidence).
4. After a successful write the resolver publishes `{ roomId, version }` (no content, a few
   bytes) on channel `crisis:<roomId>` with a token signed for that room. Clients that see a
   version above their own call `crisisView`. Missed, duplicate or reordered messages are
   harmless because the client always re-reads from storage.
5. Fallback with no Realtime: the client polls `crisisView` every 3–5 s while visible
   (`If version unchanged` is cheap). Both modes use the same resolvers; Realtime only shortens
   latency. The UI says "Updates every few seconds" in polling mode, never "live".
6. Channel auth: `crisisSubscribeToken({ roomId })` checks that the caller is an active
   participant, then returns `signRealtimeToken('crisis:<roomId>', { roomId }, ['subscribe'])`.
   Publishing happens only from the resolver. Payloads carry no scenario content, so a leaked
   token reveals only that a room's version changed.
7. Invites: the owner's resolver generates a 32-byte random token (node `crypto.randomBytes`,
   base64url) and passes it to `issue-invite`; only `sha256("sf-crisis-invite:v1:<roomId>:<token>")`
   is stored. The token is shown once to the owner to share; it is never logged. Joining is
   `crisisCommand({ roomId, command: { type: 'join', token } })`. Rooms are per installation; a
   token is bound to its room.
8. Debrief: `buildAfterActionReport(log)` yields a `SessionAuditRecord` and a `RunSubmission`
   (session id = room id) that go through the existing `saveRun` path unchanged; the owner is
   the history owner. Per-role contributions stay in the report.

## 3. Engine (`shared/crisis/`)

- `createRoom`, `executeCommand(events, command, { actor, at, expectedVersion })`,
  `rebuildRoom(events)`, `roleView(state, accountId)`, `buildDebrief(events)`,
  `buildAfterActionReport(events)`, `hashInviteToken`.
- Roles: incident commander (exactly one; owner at creation), engineering responder, security
  responder, communications lead, observer.
- Rules: only the owner issues/revokes invites, assigns roles, starts and closes; only the
  commander commits decisions; responders and comms lead propose; stakeholder notices only by
  commander or comms lead; observers cannot act. Command moves by hand-off (commander or owner);
  the outgoing commander takes the incoming one's former role. The commander and owner cannot
  leave. Invites are single-use, expire within 24 h, cannot be for commander, and all failures
  return the same `INVITE_INVALID`. Rooms expire within 24 h; after expiry only `close` works.
- `rebuildRoom` re-checks every event's permission, so a forged or reordered stored log throws
  instead of being served.

## 4. Approvals needed from the owner

| Item                                                                                | Needed for                           | Status                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| `storage:app` (Custom Entity Store entity `crisis-room` with `version` + `payload`) | Room logs                            | Already requested under D17; add the entity    |
| `@forge/realtime` dependency + `@forge/bridge` realtime in Custom UI                | Doorbell only                        | No scope documented; confirm with `forge lint` |
| Resolver functions `crisisCommand`, `crisisView`, `crisisSubscribeToken`            | All                                  | No new permission                              |
| Polling fallback                                                                    | Works with storage alone             | No extra permission                            |
| Major-version/re-consent impact                                                     | If `storage:app` is not yet deployed | Lead to confirm                                |

No `asApp` product calls, no external egress, no new Jira/Confluence scopes.

## 5. Multi-user test plan (needs ≥ 2 authenticated Atlassian accounts on the dev site)

1. User A (owner) creates a room; User B is not a participant: `crisisView` returns
   `NOT_PARTICIPANT`.
2. A issues an engineering invite; B joins from a second browser profile. Both views show both
   participants within one poll interval (record latency with and without Realtime).
3. Reuse: a third account (or B after leaving) uses the same token → `INVITE_INVALID`.
4. B proposes; A sees the proposal; A commits; B's view moves to the next step. B's commit
   attempt → `FORBIDDEN`.
5. Race: A and B submit at the same version from two tabs; exactly one succeeds, the other gets
   `STALE_VERSION` and recovers after reload.
6. Kill B's tab mid-session, reopen: view equals A's at the same version (reconnect = rebuild).
7. Hand-off A → B; B commits to completion; debrief attributes decisions to both.
8. Save the after-action report; it appears in A's history and re-verifies on read.
9. Isolation: a room on a second installation (or a different room id) never shows A's events;
   subscribing to another room's channel without a token receives nothing.
10. Realtime off (no subscription): the same flow completes by polling.

Automated coverage in this lane: `test/crisis.test.ts` (37 tests: role permissions, observer
lockout, stale versions and races, invite reuse/expiry/wrong room/revocation, hand-off, replay
determinism vs. solo `replaySession`, prefix rebuild, forged-log rejection, role views, debrief
contributions, audit verification, room isolation, log/message/invite bounds).

## 6. Unverified

- Realtime GA date/pricing and absence of a manifest scope (see §1).
- Whether the Custom UI module context gives a usable default channel or whether a token-secured
  global channel is required (recommended: token on a global channel, since rooms are not tied to
  an issue).
- Real round-trip latency at 2–5 users.

## 7. Status 2026-11-11 (Lane 2)

Automated tests passed, including `test/crisisLifecycle.test.ts` (all five roles, per-role evidence, no invite hashes or raw log served, proposals, commander approval, communications, hand-off, reconnect, debrief save into history, installation isolation). Realtime is not implemented (polling only). Storage schema: [proposals/M7_STORAGE_SCHEMA.md](proposals/M7_STORAGE_SCHEMA.md). Multiplayer is not claimed: the §5 two-user test has not run.
