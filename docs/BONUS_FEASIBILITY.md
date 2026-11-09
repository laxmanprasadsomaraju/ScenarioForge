# Bonus prize feasibility (Lane D)

Research date: 2026-11-09. Scope: feasibility and interface design only. No manifest, `src/`, `static/` or `shared/domain` changes were made. Proposed type contracts are in `shared/agents/contracts.ts` (types only, no runtime).

**How to read this document.** "Verified" means read on an official Atlassian page (developer.atlassian.com or support.atlassian.com) at the cited URL on the research date. "Rules extract" means text from the Codegeist rules page as returned by a search engine, because the Devpost page returned HTTP 403 to automated fetches (see [Unverified, rules](#unverified-rules)). "Community" means a developer-community post with no Atlassian staff answer; it is a signal, not a fact. Nothing here claims eligibility.

---

## 0. Summary

| Target                         | Verdict                                                                 | Main risk                                                                                                     | Effort (est.)          |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Best Agents (Rovo)             | **Feasible with risk**                                                  | Rovo must be active on the test/judge site; free developer sites reportedly have none; credits are consumed   | 4–6 days               |
| Best app with Atlassian MCP    | **Feasible with risk** (cheap once Rovo actions exist)                  | `rovo:mcp` is Preview; external clients need admin enablement per site; hard to demo without Rovo             | 1–2 days               |
| Teamwork Graph integration     | **Feasible with risk**                                                  | Preview API; no curated query for services/owners; missing scopes and rate limits return silent empty results | 3–5 days               |
| Marketplace published app      | **Feasible with risk, owner decision**                                  | Submitting the app for listing blocks installation-link sharing of that app; review 1–3 weeks; KYC            | 3–5 days + review wait |
| Main category (Software Teams) | On track; must remain installable via installation link through judging | Demo site expires 2027-02-07; judges' own sites may lack Rovo                                                 | n/a                    |

Rules extract: "The same Submission can win up to one Grand Prize and one Bonus Prize" ([rules](https://codegeist2026.devpost.com/rules), extract). Building for all four bonuses does not increase the number of prizes; it widens which one we might win. Recommended priority: **Rovo agent (M6) → MCP (M9, reuses the same actions) → Teamwork Graph read enrichment (M4/M9) → Marketplace (owner decision, start paperwork now if yes)**.

---

## 1. Contest rules

### Verified facts with citations

- Codegeist 2026 is open; bonus awards are "$1,500 each for Best Rovo Agent, Best MCP App, Best Teamwork Graph Integration, and Best Marketplace Published App". Deadline "December 22, 2026 at 12:00 PM PT". Participants are pointed to a free Atlassian Cloud developer site. Source: [Atlassian Developer Community announcement](https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506).
- That announcement does not mention Runs on Atlassian or judge installation requirements (same URL).

### Rules extracts (from https://codegeist2026.devpost.com/rules via search; must be re-read by the owner)

- Submission period: 27 Oct 2026 09:00 PT to 22 Dec 2026 12:00 PT.
- The project must run on Forge, with a Forge manifest and at least one Forge module, and be new, or updated/rebuilt on Forge after the period opened.
- An installation link is required; the rules link to [Distribute your apps](https://developer.atlassian.com/platform/forge/distribute-your-apps/#start-sharing-your-app) for how to create it. A community post quotes the rules as requiring an "installation link plus instructions for every configuration step and integration the judges need" ([thread](https://community.developer.atlassian.com/t/codegeist-2026-two-installation-links-and-which-bitbucket-plan-do-judges-test-on/103715), community quote of the rules).
- **Best Agents (Rovo/Assignable agents):** Forge apps that use the `rovo:agent` module, the `rovo:agentConnector` module, or reusable skill and action modules that other agents can invoke as tools. (The extract says "rovo:skill and rovo:action"; the Forge module is actually named `action`, see §2.)
- **Best app with Atlassian MCP:** "a Forge app that exposes tools via the Atlassian MCP server using the rovo:mcp module."
- **Best apps with Teamwork Graph integration:** apps that connect data into the graph and/or consume data from the Teamwork Graph API.
- **Best Marketplace published app:** published to the Marketplace **or submitted for listing**; provide either the listing link or the Marketplace review ticket link.
- At most one Grand Prize and one Bonus Prize per submission.

### What counts as "uses" (our reading, not a ruling)

| Bonus          | Minimum that plausibly meets the wording                 | What we should actually ship                                                                  |
| -------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rovo agents    | A `rovo:agent` with real `action`s                       | Two agents, five actions backed by the deterministic engine, shown working in the video       |
| MCP            | A `rovo:mcp` module listing at least one action          | Four read-only tools, demonstrated from Rovo Studio and (if admin-enabled) an external client |
| Teamwork Graph | Real `requestTeamworkGraph` calls whose results are used | Graph edges in the Recovery Readiness Graph with TWG as cited evidence                        |
| Marketplace    | Submitted listing with a review ticket link              | Free listing, approved if review completes in time                                            |

### Unverified, rules

<a id="unverified-rules"></a>

- The Devpost rules and overview pages returned HTTP 403 to WebFetch; a scripted download was not attempted further. All rules text above is from search-engine extracts and **must be confirmed by the owner reading https://codegeist2026.devpost.com/rules in a browser**, especially: judging criteria, video length, whether Runs on Atlassian is required or only encouraged, whether judges' test sites have Rovo, and how long the app must stay installable.
- No official statement found on which plan or site type judges test on (the only thread asking has no staff reply).

---

## 2. Rovo agents and actions

### Verified facts

- **`rovo:agent` module.** Properties: `key` (mandatory, `^[a-zA-Z0-9_-]+$`), `name` (mandatory, ≤30 chars), `description`, `icon`, `prompt` (mandatory; inline or `resource:<key>;<path>`, path form needs Forge CLI ≥10.6.0), `conversationStarters`, `actions` (action keys), `skills` (Preview), `followUpPrompt`. Agents in an app see only the workspace where the app is installed. Atlassian safety-screens agents and may block deployment or suspend Rovo API use. Agents surface in the chat side panel, the `/ai` toolbar and Jira/Confluence Automation. Source: [rovo:agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/).
- **`action` module** (module key is `action`, not `rovo:action`). Properties: `key`, `name`, `function` (or `endpoint` for Forge Remote), `actionVerb` ∈ `GET | CREATE | UPDATE | DELETE | TRIGGER`, `description` (tells the agent when to call it), `inputs` (each with `title`, `type` ∈ `string | integer | number | boolean`, `required`, `description`). Agents triggered by Automation rules will not invoke `CREATE`, `UPDATE`, `DELETE` or `TRIGGER` actions. Payload carries inputs as top-level keys plus, in some contexts, a `context` with `cloudId`, `moduleKey` and a product object (Jira: `issueKey`, `projectKey`); the page says not to rely on inputs for authorization and to read `accountId` from context. The function may return a string or a JSON object. Source: [Action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/).
- **`rovo:skill`** is Preview: `key`, `source.dir` (directory with `SKILL.md`), optional `dependencies.tools` (action keys from the same app). An agent only sees skills in its `skills` list. Source: [rovo:skill](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-skill/).
- Module index lists `rovo:agent`, `rovo:skill` (Preview), `action`, `rovo:mcp` (Preview), `rovo:agentConnector`: [Rovo modules](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-index/).
- **Assignable agents.** `rovo:agentConnector` integrates remote agents hosted on external infrastructure into Jira; once registered they can be assigned work items and @mentioned (A2A protocol, invocation types such as `ISSUE_ASSIGNMENT`). Sources: [Rovo Agent Connector](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/), [Integrate remote agents with Jira](https://developer.atlassian.com/platform/forge/remote-agents-in-jira/). Studio-built agents can be assigned work items via the "Work items" surface toggle, described as beta: [Collaborate with your Rovo agent on work items](https://support.atlassian.com/rovo/docs/collaborate-with-your-rovo-agent-on-work-items/).
- **Opening the agent from our UI.** `rovo.open({ type: 'forge', agentKey, agentName, prompt? })` from `@forge/bridge`; check `rovo.isEnabled()` first; only Forge agents from the same app can be opened. Source: [Forge bridge rovo](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/rovo/).
- **Rovo must be active on the site** to add an agent; agents are enabled via Chat → Browse Agents → Enable. Forge CLI ≥10.8.0 for templates. Source: [Build a Rovo Agent hello world app](https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-agent/).
- **Forge demo sites include Rovo**: "enterprise editions of Jira, Confluence, Jira Service Management, and Rovo"; 90 days; one per developer; pool can reach capacity. Source: [Provision a demo development site](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/). Our site `one-atlas-cegq` is a Forge demo site (docs/SETUP_STATUS.md), so Rovo should be present but **has not been checked**.
- **Credits.** "Rovo credits are paid by the customer's organization from their pooled Rovo allowance"; developers pay only Forge compute/storage/logs for actions. Source: [Forge platform pricing](https://developer.atlassian.com/platform/forge/forge-platform-pricing/). Each chat user message is a billable event; basic chat and basic agents are 10 credits per event; Jira Standard includes 25 credits per user per month; "On December 3, 2026, extra usage billing takes effect for Rovo credits" at $0.01 per credit, with admin spending caps. Source: [How Rovo credits work](https://support.atlassian.com/rovo/docs/rovo-usage-limits/).

**Implication of the owner's 25 credits/month:** at 10 credits per chat message that is roughly **two agent messages a month** on that subscription. Development and video recording should happen on the enterprise demo site (allowance unverified). If the 25-credit subscription has extra usage enabled, usage after 3 Dec 2026 could be billed; see owner decisions.

### Unverified

- Whether Rovo chat actually appears on our demo site, and its credit allowance. Two Codegeist threads report no Rovo on free developer sites with no staff answer ([103668](https://community.developer.atlassian.com/t/forge-rovo-agent-installed-but-rovo-not-visible-on-free-dev-site-codegeist-2026/103668), [103783](https://community.developer.atlassian.com/t/forge-rovo-agent-deployed-but-no-rovo-chat-or-browse-agents-on-a-new-development-site/103783)); a community reply suggests demo sites as the workaround.
- Whether judges' sites have Rovo.
- Whether Rovo asks the user to confirm before calling a non-`GET` action (the action page does not say). Our design does not depend on it.
- Whether `api.asUser()` is available inside action functions (the page documents `accountId` in context). Design assumes it; Lane A must confirm in a spike and fall back to `asApp` + explicit permission check via `GET /rest/api/3/mypermissions` if not.
- Whether a Forge `rovo:agent` can be made assignable to Jira work items without `rovo:agentConnector` (not documented). Treated as out of scope.
- Exact `context` shape for actions invoked from a global page or chat without an issue in view.

### Design

Two agents share one set of actions. **AI never decides consequences**: actions return engine output and cited evidence; the agent only words it. No action writes to Jira.

| Agent (≤30 chars)       | Purpose                                                                            | Actions                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Recovery Investigator` | "Which recovery procedures does this change put at risk, and what's the evidence?" | `find-recovery-risks`, `get-service-readiness`, `propose-remediation` |
| `Exercise Facilitator`  | Briefs a rehearsal, hands off to the app for decisions, explains the debrief       | `prepare-rehearsal`, `explain-outcome`, `propose-remediation`         |

| Action key              | Verb     | Inputs (all primitive per the action schema)                        | Backed by                                                   | Output (see `shared/agents/contracts.ts`)                                            |
| ----------------------- | -------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `find-recovery-risks`   | `GET`    | `changeKey: string` (optional; defaults to `context.jira.issueKey`) | M3 analysis over Jira + Confluence/JSM evidence             | `FindRecoveryRisksOutput`: findings with `confidence`, `evidence[]`, `unknowns[]`    |
| `get-service-readiness` | `GET`    | `serviceId: string`                                                 | M4 readiness graph (+ TWG edges)                            | `ServiceReadinessOutput`: edges, each with a source; `status` may be `not-assessed`  |
| `prepare-rehearsal`     | `CREATE` | `changeKey: string`, `findingId: string` (optional)                 | M5 scenario selection + `startSession` persisted in storage | `PrepareRehearsalOutput`: briefing, objectives, deep link into the app               |
| `explain-outcome`       | `GET`    | `sessionId: string`                                                 | `evaluateSession`, `decisionTrail` on the stored session    | `ExplainOutcomeOutput`: per-objective `met/missed` + rule explanation + evidence     |
| `propose-remediation`   | `CREATE` | `sessionId: string`, `findingId: string` (optional)                 | Scenario `remediation[]` (authored), stored as `proposed`   | `ProposeRemediationOutput`: proposals with `status: 'proposed'` and an approval link |

Rules for every action:

1. **Decisions are human-only.** There is deliberately no `apply-decision` action. The agent links to the rehearsal screen; `applyDecision` is only called from the UI resolver by the participant.
2. **Remediation is a draft.** `propose-remediation` stores a proposal (status `proposed`). Creating the Jira issue happens only in the app UI after explicit approval (M8). It is `CREATE` because it writes app storage, which also means Automation-invoked agents cannot call it.
3. **Authorization from context, not inputs.** Use `context.accountId`; Jira reads go through `asUser` so the agent cannot reveal issues or pages the user cannot browse. Inputs are validated with the existing enum/regex approach (issue key regex, opaque ids).
4. **Unknown stays unknown.** Each output carries `unknowns[]` and `status: 'not-assessed'` where analysis failed; the prompt instructs the agent to report these verbatim and never to infer a pass.
5. **Evidence first.** Outputs carry `EvidenceReference[]` with verbatim excerpts and URLs; the prompt tells the agent to cite them and never paraphrase an excerpt as fact.
6. **Size and latency.** Keep payloads small (a community report saw ~1.1 MB fail and ~20 s timeouts in chat, [103629](https://community.developer.atlassian.com/t/reading-the-teamwork-graph-api-from-a-forge-rovo-agent-the-failures-that-return-http-200-or-an-empty-list/103629), unverified). Cap findings at 10 and excerpts at ~500 chars.
7. **Stateless handlers.** Load everything by id from storage on each call.

Prompts live in `resources` files (e.g. `agents/prompts/investigator.md`), not inline, to keep the manifest small (recommended by the rovo:agent page).

### Manifest changes Lane A would need (illustrative; verify against the docs when implementing)

```yaml
modules:
  rovo:agent:
    - key: recovery-investigator
      name: Recovery Investigator
      description: Finds recovery procedures put at risk by a Jira change, with cited evidence.
      prompt: resource:agent-prompts;investigator.md
      conversationStarters:
        - Which recovery procedures does this change put at risk?
      actions: [find-recovery-risks, get-service-readiness, propose-remediation]
    - key: exercise-facilitator
      name: Exercise Facilitator
      description: Prepares a change-specific recovery rehearsal and explains its outcome.
      prompt: resource:agent-prompts;facilitator.md
      actions: [prepare-rehearsal, explain-outcome, propose-remediation]
  action:
    - key: find-recovery-risks
      name: Find recovery risks
      function: agent-actions
      actionVerb: GET
      description: Use when the user asks which recovery procedures or runbooks a Jira change affects.
      inputs:
        changeKey:
          title: Jira change key
          type: string
          required: false
          description: Jira issue key such as OPS-42. Defaults to the issue in view.
    # ... get-service-readiness, prepare-rehearsal, explain-outcome, propose-remediation
  function:
    - key: agent-actions
      handler: agents.handler
resources:
  - key: agent-prompts
    path: agents/prompts
```

Plus whatever M2/M3 scopes the actions' reads need (`read:confluence-content.summary` etc., owned by Lane A/M2). Adding modules/scopes is a major version change that site admins must approve.

### Risks and fallbacks

| Risk                                      | Fallback                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Rovo not active on demo site              | Re-provision demo site; ask in `codegeist-2026` tag; record video on any Rovo-enabled site; agent hidden behind `rovo.isEnabled()` |
| Judges' sites lack Rovo                   | Core app works without Rovo; Rovo panel shows "Rovo is not enabled on this site"; video demonstrates the agent                     |
| Safety screening blocks deployment        | Keep prompts factual, no autonomous writes; deploy the agent early (M6) to find out                                                |
| Credit exhaustion / billing               | Develop on demo site; owner sets extra-usage cap to 0 on paid subscriptions before 3 Dec                                           |
| Agent paraphrases or invents consequences | Outputs are engine results; prompt forbids inventing; tests assert action outputs, not model text                                  |

### Effort

4–6 days after M5 persistence exists: handler + validation + tests (2), prompts and conversation design (1), on-site testing and video capture (1–2), docs (0.5).

---

## 3. Atlassian MCP (`rovo:mcp`)

### Verified facts (source: [rovo:mcp](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/))

- Status **Preview**: "fully supported", under active development, may have shorter deprecation windows; external client connections also Preview. No GA date.
- Properties: `key` (mandatory, `^[a-zA-Z0-9_-]+$`), `name` (mandatory, ≤30 chars), `tools` (mandatory, list of **action keys**, each unique and <64 chars, max 50). At most one `rovo:mcp` module per app.
- Tools are not defined in `rovo:mcp`; each is an `action` module (function, `actionVerb`, `description`, `inputs`). So MCP tools reuse the Rovo actions in §2.
- Consumption: tools are available to custom agents in Rovo Studio; third-party MCP clients (Preview) reach `https://mcp.atlassian.com/forge/<appId>` where `<appId>` is the UUID part of `app.id` (for us `113a7a88-0d52-4161-b72e-791a83bd9355`). External exposure is **off by default** and must be enabled per installation by a site/org admin under Atlassian Administration → Apps → Sites → Connected apps. Clients authorize with OAuth 2.1; the user picks a site, sees scopes and tools, and approves; tools run within the invoking user's permissions.
- Tools only see the workspace the app is installed in; when several products have different versions installed, tools come from the latest version.
- Rovo MCP server enriched calls cost 1–10 credits; single-product lookups/writes and installing the MCP server are free ([How Rovo credits work](https://support.atlassian.com/rovo/docs/rovo-usage-limits/)). Whether Forge MCP tool calls count as "enriched" is **unverified**.

### Unverified

- Whether an external MCP client (e.g. Claude Code) can connect to the Forge MCP endpoint on a demo site, and what the tool schema looks like on the wire (inputs map to JSON Schema presumably; not documented on the page).
- Whether `rovo:mcp` requires Rovo to be active on the site for external clients.

### Design: four read-only tools

All MCP tools are `GET` actions. No write tool is exposed to external clients; approval stays inside Jira.

| Tool (action key)         | Inputs                                          | Returns                                                                                    |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `find-recovery-risks`     | `changeKey`                                     | Findings with confidence and evidence (same as §2)                                         |
| `get-service-readiness`   | `serviceId`                                     | Readiness graph slice with sourced edges                                                   |
| `explain-outcome`         | `sessionId`                                     | Deterministic evaluation of a completed rehearsal                                          |
| `list-open-recovery-gaps` | `projectKey` (optional), `limit` (integer, ≤25) | Findings without a `resolved` retest, newest first; lets an IDE agent check before merging |

`list-open-recovery-gaps` is the only new action (MCP-only, but can also be given to the Investigator).

### Manifest changes Lane A would need

```yaml
modules:
  rovo:mcp:
    - key: scenarioforge-mcp
      name: ScenarioForge Recovery
      tools: [find-recovery-risks, get-service-readiness, explain-outcome, list-open-recovery-gaps]
  action:
    - key: list-open-recovery-gaps
      # GET, inputs projectKey (string, optional), limit (integer, optional)
```

### Risks and fallbacks

- Preview changes: keep the MCP layer a thin list of action keys; nothing MCP-specific in handlers.
- Demo needs an admin toggle per site: document in judge instructions; also demonstrate via Rovo Studio custom agent which needs no external enablement.
- Without M5 persistence the tools have nothing to return beyond demo data; outputs must keep `origin: 'demo'` labels.

### Effort

1–2 days after §2 (one extra action, manifest entry, external-client test, docs).

---

## 4. Teamwork Graph

### Verified facts

- Forge backend: `api.asUser().requestTeamworkGraph(query)` from `@forge/api`; frontend: `requestTeamworkGraph` from `@forge/bridge` (always as current user). The API is in **Forge Preview** (breaking changes with ≥1 month notice). Source: [Call the Teamwork Graph API](https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/), [requestTeamworkGraph](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/requestTeamworkGraph/).
- Changelog, 15 Oct 2026: "The Teamwork Graph Consumption API is now moving into Preview"; request specific `read:graph:<object>:<product>` scopes. Source: [Forge changelog](https://developer.atlassian.com/platform/forge/changelog/).
- Raw `cypherQuery` is unavailable to new apps; use **curated queries** or **persisted Cypher queries**. Sources: call page above; [Persisted Cypher queries](https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/).
- Scopes are per object type (start, intermediate and returned types), all read-only; missing or admin-disabled scopes **do not error, they omit data**. Examples: `read:graph:issue:jira` (JiraWorkItem), `read:graph:user:atlassian`, `read:graph:team:atlassian`, `read:graph:page:confluence`, `read:graph:project:jira` (JiraSpace), `read:graph:service:external` (ExternalService), `read:graph:deployment:external`. Broad EAP scopes `read:graph:jira`/`read:graph:confluence` are being retired. Forge caps scopes at 50. Source: [Teamwork Graph scopes](https://developer.atlassian.com/platform/teamwork-graph/scopes/).
- Limitations: Forge apps only; API works only for apps installed in Jira or Confluence; **installing apps with Teamwork Graph scopes requires organization admin**; Atlassian recommends "Runs on Atlassian" apps; API design subject to change. Source: [Limitations and considerations](https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/).
- Curated queries (all paginate `first` ≤25): `atlassianUserInTeams(userId)`, `atlassianTeamMembers(teamAri)`, `atlassianTeamsBySpace(spaceAri)`, `spacesByAtlassianTeam(teamAri)`, `jiraSpaceWorkItems(spaceAri)`, `jiraWorkItemLinkedExternalDeployments(id)`, `jiraWorkItemLinkedExternalPullRequests(id)`, `jiraWorkItemComments(id, since)`, `confluencePageOwners(id)`, `confluencePageContributors(id)`, `confluencePageCreator(id)`, `confluencePageLinkedConfluencePages(id)` and others. **No curated query covers services or service owners.** Source: [Curated queries](https://developer.atlassian.com/platform/teamwork-graph/curated-queries/).
- Relationship types that exist (title case as listed): "Jira work item impacts Compass component", "Atlassian team owns Compass component", "Jira space links external service", "JSM incident links external service", "JSM incident links Jira work item", "Jira work item blocks Jira work item", "Atlassian user owns Confluence page", "Atlassian user is in Atlassian team", "Atlassian team assigned Jira work item". No direct "Jira work item links Confluence page" relationship was found. Source: [Relationship types overview](https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/overview/).
- Persisted queries: registered per app by an app contributor in TWG Labs or via `POST https://<site>.atlassian.net/gateway/api/twg/cypher-queries` with `appId`, `name`, `cypher`, `paramsSchema`; returns an immutable `queryKey`, executable after ~1 minute through `customQuery(queryKey, queryParams, first ≤25)`; results permission-filtered per user; no manual review step. Source: [Persisted Cypher queries](https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/).
- Writing into the graph: `graph:connector` module with `@forge/teamwork-graph` (`graph.setObjects`, `graph.getObjectByExternalId`), Jira installs only, configured by an org admin in Connected apps; example scopes `write:object:jira`, `read:object:jira`, `delete:object:jira`. Source: [Build a Teamwork Graph connector](https://developer.atlassian.com/platform/teamwork-graph/build-a-teamwork-graph-connector/). Connector object types include Document, Work item, Software service, Test, Test execution, Test run (some not shown in Rovo Search/Chat). Source: [Object types](https://developer.atlassian.com/platform/teamwork-graph/object-types/).

### Unverified

- Whether the demo site has Compass components, external services or teams with data, so that the service/owner queries return anything.
- Whether Teamwork Graph requires a paid plan or Rovo on the site (not stated in the limitations page; a community post says curated queries answered on a free site).
- Exact GraphQL argument and type names on our site: confirm by fetching `/gateway/api/graphql/twg/schema` (recommended by the curated queries page).
- Community-reported failure modes: HTTP 200 with a GraphQL error when the operation name is not `[company]_[operation]`, rate limiting (~128 calls/20 s) returning empty lists, persisted-query registration only working from a logged-in browser ([103629](https://community.developer.atlassian.com/t/reading-the-teamwork-graph-api-from-a-forge-rovo-agent-the-failures-that-return-http-200-or-an-empty-list/103629)).
- Whether adding `read:graph:*` scopes affects Runs on Atlassian eligibility (no indication it does; run `forge eligibility`, [CLI reference](https://developer.atlassian.com/platform/forge/cli-reference/eligibility/)).
- Connector object type schemas for Test/Test run and whether they are queryable via the API.

### Design: Recovery Readiness Graph enrichment (M4)

Principle: TWG adds **edges with a source**; it never upgrades readiness on its own. Every TWG edge becomes an `EvidenceReference` with `kind` extended to `'teamwork-graph'` (Lane A change to `shared/domain`, proposed only) carrying the query name, the ARI and `retrievedAt`.

| Readiness graph edge                         | TWG source                                  | Query type       | Scopes                                                                  |
| -------------------------------------------- | ------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| Change → deployments                         | `jiraWorkItemLinkedExternalDeployments(id)` | Curated          | `read:graph:issue:jira`, `read:graph:deployment:external`               |
| Change → impacted component (service)        | "Jira work item impacts Compass component"  | Persisted Cypher | `read:graph:issue:jira` + Compass component scope (name **unverified**) |
| Service → owning team                        | "Atlassian team owns Compass component"     | Persisted Cypher | `read:graph:team:atlassian` + Compass scope                             |
| Owning team → members (who to page / invite) | `atlassianTeamMembers(teamAri)`             | Curated          | `read:graph:team:atlassian`, `read:graph:user:atlassian`                |
| Runbook page → owner                         | `confluencePageOwners(id)`                  | Curated          | `read:graph:page:confluence`, `read:graph:user:atlassian`               |
| Runbook page → linked pages                  | `confluencePageLinkedConfluencePages(id)`   | Curated          | `read:graph:page:confluence`                                            |
| Space → external service                     | "Jira space links external service"         | Persisted Cypher | `read:graph:project:jira`, `read:graph:service:external`                |

Behaviour:

- Each lookup returns `TeamworkGraphLookup` (see contracts): `status: 'ok' | 'empty' | 'unavailable'`. `empty` is explicitly "no edges visible to you", not "no dependency"; `unavailable` (GraphQL errors in a 200, rate limit, missing scope) renders as "Not assessed". Never treat an empty result as a pass.
- Always inspect `errors[]` in the GraphQL body, not just HTTP status. Name operations `scenarioforge_<operation>`.
- Paginate to a hard cap (e.g. 3 pages × 25) and record `truncated`.
- The readiness graph shows TWG edges with a "Teamwork Graph" source chip and link.
- Rehearsal use: the owning team's members populate the crisis-room invite list (M7) and the "who owns this runbook" evidence in the briefing.

**Optional write path (M9 stretch, owner decision):** a `graph:connector` that publishes completed rehearsals as Test run objects associated with the change work item, so rehearsal outcomes become searchable in Rovo. This satisfies "connects data into the graph" but adds connector setup for admins and a data-deletion responsibility. Recommend only after read enrichment works.

### Manifest changes Lane A would need

```yaml
permissions:
  scopes:
    - read:graph:issue:jira
    - read:graph:deployment:external
    - read:graph:team:atlassian
    - read:graph:user:atlassian
    - read:graph:page:confluence
    # add Compass component / external service scopes only once the persisted queries are confirmed
```

Persisted query keys stored in app configuration (registered by the owner as app contributor; one-time, from TWG Labs).

### Risks and fallbacks

- Demo site has no Compass/service data: seed demo services as Compass components if available; otherwise use curated user/team/page queries only, which still meet "consumes data from the Teamwork Graph API".
- Org-admin install requirement for judges: state in judge instructions; judges installing on their own sites are org admins of those sites (assumption).
- Preview breaking changes: isolate behind a `TeamworkGraphGateway` interface like `JiraGateway`, tested with fakes for empty/error/rate-limited cases.

### Effort

3–5 days: gateway + curated queries + tests (2), persisted queries + registration (1), graph UI integration (1), on-site verification (0.5–1). Connector write path: +3 days.

---

## 5. Marketplace

### Verified facts

- **Installation-link sharing** needs a production deploy and sharing enabled in the developer console; installing users must be site admins. "Apps with a manifest license, or submitted for Marketplace listing, can't be shared via installation link." Source: [Distribute your apps](https://developer.atlassian.com/platform/forge/distribute-your-apps/).
- **Listing a Forge app:** accurate Privacy and Security tab (legal responsibility); data residency details if supported; GDPR compliance and personal-data report/erase flows if storing personal data; End User Terms and a DPA where applicable; enable sharing; paid apps set `app.licensing.enabled: true` and cannot be installed from production until approved; free apps have no `license` object; after listing "you won't be able to distribute the app via the developer console"; checklist asks to justify each scope and list remote hosts; "we aim to provide a decision within one week". Source: [List a Forge app on the Atlassian Marketplace](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/).
- **Approval guidelines:** "Approvals take 10-15 business days"; trademark infringement is an automatic rejection (name must be "App X for Jira", not "Jira App X"); free apps must provide useful function as-is; privacy policy required; listing must reference setup/usage docs; partner verification ticket and Privacy & Security tab approval are prerequisites. Source: [App approval guidelines](https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/).
- **Security workflow timings:** new submissions 5–10 business days; partner verification (KYC/KYB) 2–3 business days, one-time; automated vulnerability scans block on critical/certain high findings; app security questionnaires with fail-level answers block listing. Source: [Security workflow](https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/).
- **Runs on Atlassian:** Atlassian-hosted compute and storage only, data residency matching the host, no egress except analytics without in-scope End-User Data; badge is automatic; check with `forge eligibility`. Sources: [Runs on Atlassian (Marketplace)](https://developer.atlassian.com/platform/marketplace/runs-on-atlassian/), [forge eligibility](https://developer.atlassian.com/platform/forge/cli-reference/eligibility/).
- Rules extract: Marketplace bonus accepts a listing link **or a review ticket link**.

### Unverified

- Whether a separate Forge app (second app ID, same code) for judging is acceptable to the contest when the listed app cannot use installation links. The rules do not appear to limit installation links (community reading only).
- Current real review times (a community post reports >10 business days pending: [99363](https://community.developer.atlassian.com/t/two-forge-apps-pending-marketplace-review-for-10-business-days/99363)).
- Whether Preview modules (`rovo:mcp`, `rovo:skill`, TWG Preview API) are accepted in a Marketplace listing during Preview (the rovo:skill page says Preview modules deploy to production; listing acceptance is not stated).

### Design: two-app distribution

To keep the judge installation link working, distribute two apps built from the same commit:

| App                           | Purpose                   | Distribution                         |
| ----------------------------- | ------------------------- | ------------------------------------ |
| Existing app `113a7a88-…`     | Judge build, demo site    | Installation link (Sharing)          |
| New app (registered by owner) | Marketplace listing, free | Submitted for listing, review ticket |

The only code difference is `app.id` (set at build time by a script, Lane A). Free pricing avoids licensing code and keeps `forge install` from production working.

### Timeline (business days, conservative)

| By date   | Step                                                                                             | Owner          |
| --------- | ------------------------------------------------------------------------------------------------ | -------------- |
| 13 Nov    | Owner decides yes/no; if yes, start Marketplace partner account and partner verification (2–3 d) | Owner          |
| 20 Nov    | Privacy policy, End User Terms (standard), support contact, documentation URL published          | Owner + Lane D |
| 25 Nov    | Register listing app ID, production deploy, `forge eligibility` clean, security questionnaire    | Owner + Lane A |
| **1 Dec** | **Submit for listing** (15 business days before 22 Dec)                                          | Owner          |
| 22 Dec    | Contest deadline: submit listing link if approved, otherwise review ticket link                  | Owner          |

Later updates to a listed Forge app as minor versions publish instantly; major versions (new scopes or modules) need review again (security workflow page). So the listed app should already declare the final scopes when submitted, or later Rovo/TWG additions trigger another review.

### Risks and fallbacks

- Review not complete by 22 Dec: submit the review ticket link (rules extract allows it).
- Rejection for naming: name it "ScenarioForge for Jira".
- Listing exposes the app publicly before it is robust: list only with M5+ features; demo data must stay labelled.

### Effort

3–5 days of preparation (policy, listing copy, screenshots, questionnaire, second app ID) plus 1–3 weeks review wait.

---

## 6. Sequencing and cross-cutting risks

| Milestone  | Bonus work                                                                                                                             | Gate                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Now        | Owner: check Rovo chat on `one-atlas-cegq`; decide Marketplace; set Rovo extra-usage cap                                               | Rovo visible on demo site                                |
| M4         | TWG read gateway with curated queries (team, page owner, deployments); `TeamworkGraphLookup` states; persisted queries if Compass data | Works with fakes; one real call shown on demo site       |
| M5         | Session persistence (prerequisite for actions that load by id)                                                                         | Replay test                                              |
| M6         | Rovo agents + five actions, prompts as resources, `rovo.open` from rehearsal debrief                                                   | Agent answers cite evidence; permission tests on actions |
| M9 (early) | `rovo:mcp` listing four GET actions; external client test; Marketplace submission by 1 Dec if approved                                 | MCP tool call from Rovo Studio                           |
| M9 (late)  | Optional `graph:connector` for rehearsal results                                                                                       | Only if everything else is done                          |

Non-blocking guarantees for the core app:

- All bonus code sits behind gateways and feature checks (`rovo.isEnabled()`, TWG `unavailable` state). The core Change → Rehearsal → Remediation loop must work with Rovo and TWG absent.
- New scopes are a major version requiring admin re-consent; batch scope additions into as few deploys as possible, and before the Marketplace submission.
- Demo site expires 2027-02-07 (judging ends 2027-02-03); judge instructions must not depend on our site.

## 7. Owner decisions required

1. **Marketplace: yes or no** (by ~13 Nov). If yes: partner account and KYC, privacy policy and terms published under the owner's name, registering a second app ID, accepting Marketplace terms. Lane D cannot do any of these.
2. **Rovo credits:** confirm which subscription the "25 credits/month" belongs to, and set extra usage off or a cap before 3 Dec 2026 to avoid charges; do agent testing on the demo site.
3. **Check Rovo on the demo site:** open `one-atlas-cegq.atlassian.net`, confirm Chat → Browse Agents exists. If not, decide whether to re-provision or ask in the `codegeist-2026` community tag.
4. **Teamwork Graph persisted queries:** registration must be done by an app contributor from a logged-in browser (TWG Labs).
5. **Read the Devpost rules page** and confirm the extracts in §1 (judging criteria, video length, Runs on Atlassian expectations, install-link and judge-site wording).
6. Whether to build the optional TWG connector (writes rehearsal results into the customer's graph; adds a data-deletion responsibility).
