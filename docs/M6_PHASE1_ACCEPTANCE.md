# M6 Phase 1 acceptance: identity and storage probes on rovo-test

Date: 2026-11-10. Build `rovo-test/build` @ a4976a8, app 2.1.0 on `rovo-test` (installation `64f87111-c12f-4eff-8d69-58f4f8bdc4d9`, Jira only). Scopes: `storage:app`, `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`. Variables: `SF_ROVO_TEST_STORAGE=enabled` only (per-user cap unset, default 50).

## Results (run by the owner in Rovo chat)

| Probe                     | Result                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Identity (`whoami-probe`) | **Passed, live**: `accountIdMatch: true`, `httpStatus: 200`. Jira was read as the signed-in user; no app-level path exists |
| Storage (`storage-probe`) | **Passed, live**: 12 of 12 (S1–S9, H1–H3), `allPassed: true`, cleanup done                                                 |

## Logs (`forge logs -e rovo-test`, 18 lines)

- No unexpected errors. No account ids, emails or names logged.
- The two deliberate conflict steps logged `ForgeKvsError`, code `CONDITIONAL_CHECK_FAILED`, HTTP 400. This settles the previously undocumented failed-condition shape; the adapter's conflict handling matches it.

## Credits

Owner, Atlassian Administration → Usage → Meters: 0 → 20 Rovo credits for the probe session (2 chat messages × 10). 194,980 of 195,000 remain. No sign of separate per-action billing in this session. Extra usage confirmed disabled by the owner.

## Isolation

`development` (3edeba6c…, version 2, last deployed 2026-11-09T23:07Z) and `confluence-test` (99a01e9b…, 2.4.0) unchanged; neither has variables.

## Decision

Phase 1: **go**. Identity security and storage reliability are proven on the live platform. Phase 2 needs separate approval.
