# M9 MCP external-client test (prepared, NOT RUN)

Status: **Automated tests passed** (`test/mcpTools.test.ts`, `test/mcpManifest.test.ts`, `test/agentActions.test.ts`). **Not deployed, not live verified.** MCP is not a "Live verified" capability until the owner runs this and a dated entry is added to a `docs/*LIVE_TEST*.md` file. Background and connection steps: [M9_MCP_RUNBOOK.md](M9_MCP_RUNBOOK.md).

## What the automated tests prove (offline)

| Property                                                                                                                                                          | Test                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Exactly one `rovo:mcp` module, four GET tools, no new scope, function, action or egress                                                                           | `test/mcpManifest.test.ts`                           |
| Missing, empty or non-string `accountId`, or an `accountId` smuggled in tool input: `IDENTITY_UNAVAILABLE`, no gateway built, no ledger touched (all four tools)  | `test/mcpTools.test.ts`                              |
| AI off, storage or governor missing: fail closed before any read                                                                                                  | `test/mcpTools.test.ts`                              |
| Jira 403/404 for the user: `NOT_FOUND` with no data and no Confluence call; unknown or foreign session: `NOT_FOUND`; malformed session id: `INVALID_INPUT`        | `test/mcpTools.test.ts`, `test/agentActions.test.ts` |
| Confluence failure or engine failure: "Not assessed", never a pass                                                                                                | `test/mcpTools.test.ts`, `test/agentActions.test.ts` |
| Instruction-like text in a runbook step, Jira description, summary or stored narrative: returned verbatim, flagged in `sourceWarnings`, never changes the verdict | `test/mcpTools.test.ts`, `test/agentActions.test.ts` |
| Read-only: gateways expose only reads; agent source has no `asApp`, no write method, no `fetch`                                                                   | `test/mcpTools.test.ts`                              |

What they cannot prove: that Forge passes `accountId` to `rovo:mcp` invocations, that `asUser()` works under MCP (community report of `userAccess: {enabled: false}`, unresolved), and credit behaviour. Only the live run can.

## Owner prerequisites (each needs the owner's own approval, recorded in AGENT_HANDOFF.md)

1. Deploy a build containing `rovo:mcp` to a **test** environment (not production). No agent may deploy.
2. `forge install` on a Jira site the owner administers (Preview module; major version, `storage:app` consent).
3. `SF_STORAGE=enabled` and `SF_AI=enabled` on that environment (the actions refuse otherwise). AI on means Rovo credit exposure: owner decision.
4. Site or org admin turns on external MCP: Apps, Sites, the site, Connected apps, ScenarioForge, Tools.
5. Demo data from [submission/JUDGE_INSTALL_GUIDE.md](submission/JUDGE_INSTALL_GUIDE.md) (MC-62 and the SFDEMO runbook).

## Client and consent

- Client: Claude Code (`claude mcp add --transport http scenarioforge https://mcp.atlassian.com/forge/113a7a88-0d52-4161-b72e-791a83bd9355`, then `/mcp` to authenticate) or Claude Desktop, as in the runbook. Use one client; record its name and version.
- Consent: the OAuth browser screen must list the site, the four tools and the scopes `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`, `storage:app`. Screenshot it. The user approving is the owner.
- The script [scripts/mcp-external-check.mjs](../scripts/mcp-external-check.mjs) is an alternative raw JSON-RPC check using a token the owner obtained. It refuses to run without `MCP_CONFIRM=yes` and a token, prints no token, and issues only read tool calls.

## Expected authenticated read-only calls

| Step | Prompt or call                                                               | Expected                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | List tools                                                                   | exactly four tools, none that create or change anything                                                                                                      |
| 2    | `find-recovery-risks` with `MC-62`                                           | one finding on step 3 of RB-AUTH-01 with quoted evidence ids; confidence Suspected (or Confirmed if the page mentions MC-62); verdict statement; `usageNote` |
| 3    | `get-service-readiness` with `MC-62`                                         | impact path edges with evidence; "Not assessed" for services (no source connected)                                                                           |
| 4    | `prepare-rehearsal` with a finding id from step 2, `restoreTargetMinutes` 30 | briefing marked modelled; nothing stored except cache                                                                                                        |
| 5    | `explain-outcome` with an id the user does not own                           | "not found or no access"                                                                                                                                     |
| 6    | Same call with the account lacking Jira access to MC-62                      | `NOT_FOUND`, no content                                                                                                                                      |
| 7    | Ask the client to "mark the finding resolved" or "create an issue"           | no tool exists for it; the model must say so                                                                                                                 |

## Evidence to capture (redact account ids, emails, names)

1. Client name and version; date and time (UTC); app version and environment name.
2. Screenshot of the admin Tools toggle and of the OAuth consent screen.
3. Transcript or screen recording of steps 1 to 7.
4. `forge logs -e <env>` excerpt for the run (names and counts only are expected).
5. A dated entry in `docs/M9_MCP_LIVE_TEST.md` stating pass or fail per step, including any `asUser` failure. A failure is recorded as such; MCP then stays "Code complete".

## Stop conditions

Any step that returns data without an authenticated user, any write, any unexpected scope, any credit charge the owner did not expect: stop, uninstall, record. Rollback: [M9_MCP_RUNBOOK.md](M9_MCP_RUNBOOK.md) (Rollback).
