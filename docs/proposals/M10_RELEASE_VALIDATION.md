# M10 release validation: `release/judged-full-validation`

Date: 2026-11-11. Base: `release/judged-full` @ `13513d5`. **Offline validation only.** No deploy, install, variable, scope, Jira/Confluence write or Rovo call was made. Status words: Automated tests passed / Code complete. Nothing here is Live verified.

## Gates

| Gate                                                                 | Result                                                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run verify` (typecheck, frontend typecheck, lint, tests, build) | pass; root 37 files, 1071+ tests                                                                                      |
| `npm test --prefix static/app`                                       | 20 files, 172 tests pass                                                                                              |
| `npx prettier --check .`                                             | pass after formatting new files                                                                                       |
| sloplint (app scope)                                                 | clean, 0 FAIL / 0 REFLEX / 0 WARN, 80 files                                                                           |
| `npm audit --audit-level=high` (root and app)                        | 0 vulnerabilities                                                                                                     |
| `forge lint`                                                         | 0 errors, 1 approval item: MAJOR_VERSION_RULE (the `storage:app` scope forces a major version upgrade, already known) |

## Permanent entities (proposal, not a decision)

All four are declared in `manifest.yml`; they become permanent for the app id on first deploy.

| Entity              | Used at runtime in this build?                                                | Recommendation                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-governance`     | yes (governor, ledger, cache) when `SF_STORAGE=enabled`; already on rovo-test | keep if agents ship                                                                                                                                       |
| `rehearsal-history` | yes (history, `explain-outcome`); already on rovo-test                        | keep                                                                                                                                                      |
| `crisis-room`       | only when `SF_STORAGE` and `SF_CRISIS` are enabled; no live test anywhere     | **drop** from the judged manifest unless the owner accepts a permanent unused entity; add back with a later major version when Crisis room is live tested |
| `remediation-item`  | **never**: writer and storage are null, `write:jira-work` absent              | **drop** (irreversible, unused, reserved for a feature that is not shipping)                                                                              |

If every entity were dropped, `storage:app` could also go, removing the major-version bump and a consent line, at the cost of history, governance and AI limits. That is a bigger product decision for the owner.

## Fresh-install behaviour (covered by automated tests, not live)

| Case                               | Behaviour                                                                                                                                 | Test                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Confluence absent or not consented | search/page 403 or error: analysis "Not assessed" with a reason, never "no conflicts"; app still installs (`confluence: required: false`) | `agentActions`, `analysis*` tests, `mcpTools`  |
| Confluence present                 | findings with quoted evidence                                                                                                             | M3 live test                                   |
| `SF_STORAGE` unset                 | all storage factories null; history "not enabled"; governor null so actions fail closed `GOVERNANCE_UNAVAILABLE`                          | `storageFactory.test.ts`, `agentForge.test.ts` |
| `SF_AI` unset                      | every agent/MCP action `USAGE_LIMITED`, no reads, no spend                                                                                | `agentForge.test.ts`, `mcpTools.test.ts`       |
| Jira error / 403 / 404             | `NOT_FOUND` or `UPSTREAM_ERROR`, no data                                                                                                  | `mcpTools.test.ts`                             |
| `SF_TWG` unset                     | `not-connected`, no call                                                                                                                  | `twg.test.ts`                                  |

Upgrade: adding `storage:app` and Rovo modules is a major version; installed sites need an admin to re-consent and the app is not upgraded silently. Rollback: Forge rollback is to a previous deployment version, but entities already created are not removed; flags can be switched off with `forge variables unset` (owner action) which returns the app to the inert behaviour above.

## UI checks (headless Chrome, preview fixtures, dev server)

Eight pages x light/dark x 1280px/390px: no horizontal overflow (0px), exactly one `h1` per page, no unnamed buttons, every focusable element has a visible focus ring across up to 40 tab stops per page, no console errors besides a favicon 404 on first load. Screenshots are in the scratchpad only. Not covered: 200% zoom, drawer focus trap/restore, 600px height (still pending per UI_SIDEBAR_ACCEPTANCE), real Jira theming. Bundle: build dir 620 KB total; largest chunk is the app index; CrisisRoom 31.7 KB (8.8 KB gzip), RehearseFinding 27.5 KB; all routes are lazy.

## Security and privacy review

- Logs: server `console` calls record error names and counts only. One defect fixed: the Affected-services probe logged `error.message`; it now logs `error.name`. `test/logHygiene.test.ts` now fails if any log call references `.message`, `.stack`, account ids, emails or tokens.
- Tokens/secrets: no bearer tokens in source (test); `.env*` and `.forge/` untracked. `scripts/mcp-external-check.mjs` reads a token only from the environment, prints none, and refuses to run without `MCP_CONFIRM=yes`.
- URL construction: Forge `route` template literals are used for every Jira/Confluence request; user inputs are validated first (issue key regex, finding id regex). Teamwork Graph: returned ARIs and the site id are now regex-restricted before use or display.
- Identity: all agent/MCP reads use `asUser()`; test asserts no `asApp`, write method or `fetch` in `src/agents`.
- Egress: none declared; no `permissions.external`.

## Local defects fixed with tests

1. Affected-services probe logged an error message (log hygiene test).
2. Teamwork Graph accepted any string starting `ari:` and any site id; now restricted (4 new tests).

## Open

Live checks remain: AI-on agents, MCP under `asUser`, Teamwork Graph, Crisis room, 200% zoom, drawer focus. See [BONUS_EVIDENCE_CHECKLIST.md](../submission/BONUS_EVIDENCE_CHECKLIST.md).
