# M9 Rovo MCP runbook (prepared, not deployed)

Status: **Code complete, Automated tests passed** on `m9/mcp`, which branches from `rovo-test/phase2` and deploys to `rovo-test` only. Not deployed, not live verified.

## Verified facts (re-read 2026-11-11)

| Fact                                                                                                                                                                                                                                             | Source                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `rovo:mcp` is in **Preview**, described as "fully supported", but "may be subject to shorter deprecation windows".                                                                                                                               | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/                                                      |
| Syntax: `modules.rovo:mcp[]` with `key` (required, `^[a-zA-Z0-9_-]+$`), `name` (required, max 30 characters) and `tools` (required, a list of `action` keys).                                                                                    | same                                                                                                                                     |
| Limits: at most **one** `rovo:mcp` module per app and at most **50** actions. Each action key must be unique and under 64 characters.                                                                                                            | same                                                                                                                                     |
| Actions are exposed as tools. Tools are not a new primitive: an existing `action` becomes a tool when it is listed under `tools`.                                                                                                                | same; RFC-134 https://community.developer.atlassian.com/t/rfc-134-forge-rovo-tools-and-mcp/100683                                        |
| External URL: `https://mcp.atlassian.com/forge/<appId>`, where `<appId>` is the UUID after `ari:cloud:ecosystem::app/`. For this app: `https://mcp.atlassian.com/forge/113a7a88-0d52-4161-b72e-791a83bd9355`.                                    | rovo-mcp module page; tutorial https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-mcp/                              |
| "External MCP exposure is disabled by default." A site or org admin enables it per app installation, per site, under **Apps → Sites → site → Connected apps → app → Tools**.                                                                     | same                                                                                                                                     |
| OAuth 2.1 consent: the client opens a browser, and the user picks a site (only sites where the app is installed and exposure is on), reviews scopes and tools, and approves.                                                                     | rovo-mcp module page                                                                                                                     |
| Identity: the invoking user's identity carries into the invocation, `asUser()` is limited to that user's access, and `asApp()` "will be actively prevented" for MCP-invoked actions. Tools run "subject to the invoking user's own permissions". | RFC-134; module page                                                                                                                     |
| **Known issue (community, unresolved):** `api.asUser().requestJira()` returned undefined under rovo:mcp, with logs showing `userAccess: {enabled: false}`.                                                                                       | https://community.developer.atlassian.com/t/rovo-mcp-api-asuser-returns-undefined-useraccess-enabled-false-despite-hasaccess-true/102510 |
| Credits and billing for external MCP calls: **not documented** on the module page or in the tutorial. **[Unverified]**                                                                                                                           | —                                                                                                                                        |

How this repo fits those facts:

- The four action handlers (`src/agents/actions.ts`) already take `accountId` only from the invocation context and use only user-scoped (`asUser`) gateways. There is no `asApp` call.
- `explain-outcome` reads `@forge/kvs` app storage (`storage:app`), which is app storage, not an `asApp` product API call. Confirm live that it works under MCP.
- If the context has no valid `accountId`, the actions already return an error ("Not assessed"), never data.
- AI stays off, so `SF_ROVO_TEST_AI` is untouched. The MCP tools return the deterministic engine output. The external client's model does the explaining, outside Atlassian.

## The change

- `manifest.yml` (this branch only): one `rovo:mcp` module, `scenarioforge-mcp` / "ScenarioForge Recovery".
  - Its tools are `find-recovery-risks`, `get-service-readiness`, `prepare-rehearsal` and `explain-outcome`, the existing GET actions.
  - No new action, function, scope or egress.
- `test/mcpManifest.test.ts` asserts:
  - there is one module with a valid key and a name of 30 characters or fewer;
  - its tools are exactly the four actions, all `GET`;
  - the action, function and scope sets are unchanged, and there is no `external` permission.
- `test/agentForge.test.ts`: the agent-block parser now also stops at `rovo:mcp:`.
- `forge lint -e rovo-test` (CLI 15.1.0, after `npm run frontend:build`): **No issues found.**

## Owner approval list (each in the owner's own words, recorded in AGENT_HANDOFF.md)

1. Deploy `m9/mcp` to `rovo-test` (`forge deploy -e rovo-test`). The manifest gains a module but no scope, so an upgrade install may not need re-consent. **[Unverified]**
2. As site or org admin, enable external MCP exposure for the app's tools on the test site.
3. Connect an external MCP client with the owner's own Atlassian account (OAuth consent).
4. Accept any Preview terms shown during consent. Agents must not accept them.
5. Optional: run the live test and record evidence.

## Admin steps: enable external MCP for the site

1. Go to admin.atlassian.com and choose the organisation of `one-atlas-cegq.atlassian.net`.
2. Open **Apps → Sites → one-atlas-cegq → Connected apps**, then open the ScenarioForge app (the rovo-test install).
3. Under **Tools**, turn on the four ScenarioForge tools. Exposure is off by default and is set per installation and per site.

## Connect an external client

### Claude Code

1. Add the server:
   ```sh
   claude mcp add --transport http scenarioforge https://mcp.atlassian.com/forge/113a7a88-0d52-4161-b72e-791a83bd9355
   ```
2. Start `claude`, run `/mcp`, select `scenarioforge` and authenticate.
3. In the browser that opens, pick the site, sign in, review the tools and scopes, and approve.
4. Run `/mcp` again to confirm that four tools are listed.

### Claude Desktop

Use **Settings → Connectors → Add custom connector** with the same URL. Claude Desktop handles the OAuth flow; do not paste tokens. Client UIs change, so follow the client's current docs. **[Unverified]**

## Test prompts and expected output

| Prompt                                                                               | Tool                    | Expected                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Use ScenarioForge to find recovery risks for MC-62."                                | `find-recovery-risks`   | MC-62 findings: the RB-AUTH-01 step 3 dependency on LegacyAuth, with its confidence, evidence ids and source warnings. Same content as the app's Investigation view for the same user. |
| "What services does MC-62 affect, per ScenarioForge?"                                | `get-service-readiness` | Impact path change → subject → step → page. Services appear only if JSM Affected services has them; everything else is listed as unassessed links.                                     |
| "Prepare a rehearsal for MC-62, finding <id from above>, restore target 30 minutes." | `prepare-rehearsal`     | A preview briefing built from that finding. Nothing is stored.                                                                                                                         |
| "Explain the outcome of rehearsal session <id>."                                     | `explain-outcome`       | The stored, audit-verified outcome for the caller's own session, or a not-found/not-permitted error for anyone else.                                                                   |
| Negative: the same prompts as a user without access to MC-62                         | any                     | An error or Not assessed, never data.                                                                                                                                                  |

**Pass:** the outputs match the app for the same user, and the `forge logs -e rovo-test` invocations show the user context. If the `asUser` known issue appears, record it as **Blocked** with the log line, with the account id redacted.

## Credits and usage notes

- The tools call no Rovo or LLM API inside the app. `SF_ROVO_TEST_AI` stays unset, so app-side AI usage is zero.
- Whether external MCP invocations consume Rovo credits is **not documented [Unverified]**. Before the live test, the owner checks the site's Rovo usage page and confirms that extra usage stays disabled.
- The external client's own model usage is billed by that client, not by Atlassian.
- Forge function invocations count toward normal Forge usage.

## Rollback

Remove the `rovo:mcp` block and redeploy (owner), or have the admin turn the tools off in Connected apps (immediate, no deploy).
