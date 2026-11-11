# M10 proposal: feature-complete judged release

Status: **PROPOSAL. Nothing deployed, merged, tagged or shared.** Prepared 2026-11-11 (docs lane, branch `docs/feature-complete-release`, based on `integration/lanes-1` @ `a013f1e`). Alternative to the four-scope build in [M10_JUDGING_RELEASE.md](M10_JUDGING_RELEASE.md); the owner picks one. Sources read: CLAUDE.md, [M6_PHASE2_LIVE_TEST.md](../M6_PHASE2_LIVE_TEST.md), [M7_PLAN.md](../M7_PLAN.md), [M8_PLAN.md](../M8_PLAN.md), [M9_TWG_RUNBOOK.md](../M9_TWG_RUNBOOK.md), [M7_TEST_DEPLOY.md](M7_TEST_DEPLOY.md), [M8_TEST_DEPLOY.md](M8_TEST_DEPLOY.md), [M9_MARKETPLACE_ELIGIBILITY.md](M9_MARKETPLACE_ELIGIBILITY.md), and the manifests on `integration/lanes-1` (four scopes), `rovo-test/build` (probe agent, two entities), `rovo-test/phase2` (two agents, four actions, two entities) and `m9/mcp` (phase2 + `rovo:mcp`).

## 1. Goal and app ids

- Ship every implemented feature (history, Rovo agents, MCP, crisis rooms, gated remediation writes) in **one** judged build on the existing judged app id `ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355`, shared by installation link.
- The **Marketplace** app id stays separate (registered by the owner, never this id), as in [M9_MARKETPLACE_ELIGIBILITY.md §2](M9_MARKETPLACE_ELIGIBILITY.md). See the Verification 2026-11-12 section there: a free listing with Confluence as an optional product appears **not** to be supported, which affects only the listed id.
- Every feature degrades to an implemented, honest UI state when its prerequisite is missing on a judge's site (§5). The deterministic engine still owns every finding and verdict.

## 2. Exact proposed manifest (release branch only)

```yaml
# PROPOSAL, not applied. Release branch release/judged-full only.
modules:
  global:fullPage:
    - key: scenarioforge-global-full-page
      title: ScenarioForge
      resource: main
      resolver:
        function: resolver
      routePrefix: scenarioforge
  rovo:agent: # from rovo-test/phase2 @ abbe8d6, unchanged
    - key: recovery-investigator # actions: find-recovery-risks, get-service-readiness
    - key: exercise-facilitator # actions: find-recovery-risks, prepare-rehearsal, explain-outcome
  rovo:mcp: # from m9/mcp @ c2b28fc, unchanged
    - key: scenarioforge-mcp
      name: ScenarioForge Recovery
      tools: [find-recovery-risks, get-service-readiness, prepare-rehearsal, explain-outcome]
  action: # four, all actionVerb: GET, from rovo-test/phase2
    - key: find-recovery-risks # fn-find-recovery-risks
    - key: get-service-readiness # fn-service-readiness
    - key: prepare-rehearsal # fn-prepare-rehearsal
    - key: explain-outcome # fn-explain-outcome
  function:
    - key: resolver
      handler: index.handler
    - key: fn-find-recovery-risks
      handler: index.findRecoveryRisks
    - key: fn-service-readiness
      handler: index.getServiceReadiness
    - key: fn-prepare-rehearsal
      handler: index.prepareRehearsal
    - key: fn-explain-outcome
      handler: index.explainOutcome
resources:
  - key: main
    path: static/app/build
  - key: agent-prompts
    path: agents/prompts
permissions:
  scopes:
    - read:jira-work
    - read:jira-user
    - search:confluence
    - read:page:confluence
    - storage:app
    # OPTION W (recommended: NOT included, see §2.2):
    # - write:jira-work
  content:
    styles:
      - unsafe-inline
app:
  storage:
    entities: # all PERMANENT once deployed; same shape, no indexes
      - name: ai-governance
        attributes: { version: { type: integer }, payload: { type: string } }
      - name: rehearsal-history
        attributes: { version: { type: integer }, payload: { type: string } }
      - name: crisis-room
        attributes: { version: { type: integer }, payload: { type: string } }
      - name: remediation-item
        attributes: { version: { type: integer }, payload: { type: string } }
  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64
  id: ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355
  compatibility:
    jira:
      required: true
    confluence:
      required: false
```

Agent/action bodies (descriptions, inputs, prompts) are copied verbatim from `rovo-test/phase2`; the abbreviated form above is for review only. The `tunnel` block stays as today. No egress, no remote, no `asApp` calls.

### 2.1 Dependencies

| Package           | Where      | Why                                                     | Status                                                                              |
| ----------------- | ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@forge/kvs`      | root       | Custom Entity Store for all four entities               | Already used on `rovo-test/phase2` (`src/ai/forgeStorage.ts`)                       |
| `@forge/realtime` | root       | Crisis-room "doorbell" (`publish`, `signRealtimeToken`) | Not yet added anywhere; no scope documented; confirm with `forge lint` (M7_PLAN §1) |
| `@forge/bridge`   | static/app | `realtime.subscribe` in Custom UI                       | Already a frontend dependency; realtime API not yet called                          |

Root `package.json` today lists only `@forge/api` and `@forge/resolver` (Lane A owns it).

### 2.2 `write:jira-work` (Option W)

The scope is shown on the consent screen to **every** installer whether or not the feature is used; a runtime opt-in cannot hide it. Recommendation: **leave it out of the judged build** (preview + simulated approval only, the implemented "Creating work items is not enabled" state). Include it only if all of the following hold: M8 live test passed on `write-test` ([M8_TEST_DEPLOY.md](M8_TEST_DEPLOY.md)); a per-site admin opt-in setting stored in `ai-governance` defaults **off**; the writer factory (`src/remediation/gateways.ts`, currently returns `null`, test-asserted) is wired only behind that setting. Not implemented today: the opt-in setting and the browser call path to the create resolver (handoff known gap).

### 2.3 Teamwork Graph (`read:graph:*`)

Scopes would be `read:graph:issue:jira`, `read:graph:component:compass`, `read:graph:team:atlassian` ([M9_TWG_RUNBOOK.md](../M9_TWG_RUNBOOK.md)). "Installing apps with Teamwork Graph scopes requires organization admin permissions" (https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/, cited in the runbook). A judge who is only a site admin could not install the **whole app**, and disabled graph scopes silently return empty. **Recommendation: exclude TWG from the judged build.** Prove it on `graph-test` and show it in the video; `SF_TWG` stays unset in production so the source reads `not-connected`.

## 3. Per-feature live-proof prerequisites (must pass before the release branch is cut)

| Feature               | Live test that must pass first                                                                                 | Env                          | Status 2026-11-11                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| Rovo agents (AI off)  | M6 Phase 2 Block A (A1, A2)                                                                                    | `rovo-test`                  | **Passed (user-facing)** 2026-11-11; credits pending   |
| Rovo agents (AI on)   | M6 Phase 2 Blocks B–D (grounding, refusal, budget cap, logs)                                                   | `rovo-test`                  | Not run; needs AI activation approval                  |
| Rehearsal history     | Phase 1 storage probe + Phase 2 `explain-outcome` on a stored run                                              | `rovo-test`                  | Probe Live verified (2.1.0); outcome path in Block B–D |
| MCP                   | [M9_MCP_RUNBOOK](https://github.com/laxmanprasadsomaraju/ScenarioForge/blob/m9/mcp/docs/M9_MCP_RUNBOOK.md) run | `rovo-test`                  | Not run; `rovo:mcp` not deployed                       |
| Crisis rooms          | M7 ten-step test, polling then Realtime, two users ([M7_TEST_DEPLOY.md](M7_TEST_DEPLOY.md))                    | `rovo-test` (`rovo-test/m7`) | Not run; UI branch `m7/crisis-room-ui`                 |
| Remediation write (W) | M8 test on `SFDEMO` project ([M8_TEST_DEPLOY.md](M8_TEST_DEPLOY.md))                                           | `write-test` (new)           | Not run; only if Option W                              |
| Whole build           | Fresh install of the release build on a non-production env, then second-site judge test                        | new `release-test` env       | Not run                                                |

Rule: a feature whose test has not passed by **27 Nov** is removed from the release branch (its module/flag), not shipped untested. Entities already defined stay (harmless).

## 4. Build and branch plan

1. `release/judged-full` from `integration/lanes-1` (final SHA after the 23–27 Nov security pass).
2. Port Rovo agents, actions, prompts, `@forge/kvs` storage wiring and `storage:app` from `rovo-test/phase2` by **cherry-picking the code commits**, not merging the branch (CLAUDE.md forbids merging `rovo-test/*` into other envs' branches; this needs the owner's explicit exception, line F2). Drop Phase 1 probes (`rovo-test/build`).
3. Merge `m9/mcp` content (`rovo:mcp` module, `test/mcpManifest.test.ts`) the same way.
4. M7: merge `m7/crisis-room-ui`; replace `crisisStorage = () => null` (`src/index.ts:244`) with the `@forge/kvs` adapter; add `@forge/realtime` in a second commit so it can be dropped alone.
5. M8: wire `productionRemediationStorage()` to `remediation-item`; writer stays `null` unless Option W.
6. AI flag: rename/generalise the gate so production uses `SF_AI` (default unset = AI off). Production variables only after approval.
7. `npm run verify`, `npx prettier --check .`, `forge lint -e production`; deploy first to a new `release-test` env, run §3 "Whole build", then production.

## 5. Fallbacks on a judge's site (implemented UI states)

| Missing on judge site                     | What the judge sees (existing code)                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rovo not enabled / no Rovo                | Agents simply absent from Rovo; the full app works without them. No in-app dependency                                                                                                  |
| Rovo present, AI not enabled (flag unset) | Action answers `USAGE_LIMITED`: "usage limit stopped the check… AI features are switched off… a site admin has not enabled ScenarioForge agents yet"; nothing assessed (Block A, live) |
| Admin hasn't enabled external MCP         | MCP clients cannot see the server; in-Rovo agents unaffected. External exposure "off until a site/org admin enables it" (m9/mcp manifest comment)                                      |
| No Confluence                             | Confluence `required: false`; runbook sources shown as unavailable (`DataRegion`: "shown as unavailable, never as empty"); findings "Not assessed"                                     |
| No Compass / no TWG                       | TWG off in this build; graph extras `not-connected`; impact path rows "Not assessed"                                                                                                   |
| No second user                            | Crisis room works single-user; others' presence just absent. Realtime failure: "Updates every few seconds" (polling), never "live"                                                     |
| Storage write fails / storage off         | History: "Not saved: history is not enabled in this environment."; rooms: "Team rooms are not available here"; generic: "Saved state is not enabled in this environment"               |
| No `write:jira-work` (default)            | "Creating work items needs the write:jira-work permission (not granted)"; button "Disabled: no write permission"                                                                       |
| User lacks Jira/Confluence permission     | "You do not have permission to view these issues" / "…this content"                                                                                                                    |

## 6. Consent and major-version implications

- Adding `storage:app`, entities, Rovo and MCP modules to production happens **before** the first production deploy, so the first install is v1 with no re-consent. Every judge consents once to five scopes (six with W).
- Any later scope addition is a major version; judges' installs would need admin re-approval and do not update silently (distribute-your-apps, read 2026-11-11). Hence: no scope change after the link is shared.
- Entity names and attributes are permanent for the app id; `crisis-room` and `remediation-item` stay reserved even if the features are later removed.
- Rovo/MCP modules may be Preview features **[unverified current status]**; Preview terms may differ from GA for production apps. Ask under the `codegeist-2026` tag if unsure.
- Rovo credits: agent use on a judge's site consumes that site's Rovo allowance **[unverified]**; AI is off by default, so judges see the Block A message unless their admin sets nothing (they cannot set our Forge variables). **Decision needed:** production `SF_AI` on (owner's credit exposure across judge sites) or off (judges see the honest off state, AI shown in the video). Recommend **off**, with a per-site daily cap ready if turned on.

## 7. Judge install steps (additions to [JUDGE_INSTALL_GUIDE.md](../submission/JUDGE_INSTALL_GUIDE.md))

1. Site admin opens the installation link, selects the site, accepts five scopes; optionally connects Confluence.
2. Open **Apps → ScenarioForge**, run the MC-62 journey (unchanged).
3. History: run a rehearsal, reload, open Reports: run listed.
4. Crisis room: start a room; optionally invite a second user.
5. Rovo (if enabled on the site): open Rovo chat, pick **Recovery Investigator**, ask the starter. Expect the AI-off message unless stated otherwise in the submission.
6. MCP: optional; requires the admin to enable the app's MCP server for external clients.

## 8. Rollback

- Bad code: redeploy the previous `judged-v*` tag; same major, installs update in place.
- Feature misbehaving: unset its flag (`SF_AI`, `SF_TWG`) with `forge variables unset -e production` (owner) — no redeploy needed for AI/TWG. Rooms/history: redeploy with the storage factory returning `null`; entities remain, UI shows the disabled states.
- Bad scope: cannot be un-consented on installed sites; remove and redeploy (judges stay on the old major until they update). Avoid by freezing scopes.
- Last resort: disable Sharing (stops new installs), uninstall from the owner's site.

## 9. Risks

| Risk                                                      | Likelihood               | Impact | Mitigation                                                                   |
| --------------------------------------------------------- | ------------------------ | ------ | ---------------------------------------------------------------------------- |
| A feature fails on judge sites that passed on `rovo-test` | Medium                   | High   | `release-test` env + second-site test; per-feature flags; 27 Nov cut rule    |
| Extra scopes deter judges or fail admin policy            | Low                      | Medium | No `write:jira-work`, no `read:graph:*`; scope rationale in guide            |
| Org-admin requirement blocks install (if TWG included)    | High                     | High   | Exclude TWG (§2.3)                                                           |
| Rovo/MCP Preview status or availability on judge sites    | Medium                   | Low    | App works fully without them; video shows them                               |
| Credit spend if AI on                                     | Medium                   | Medium | AI off by default; daily cap; owner monitors                                 |
| Permanent entity mistakes                                 | Low                      | Medium | Schema reviewed (M6_DEPLOYMENT_READINESS §2); same shape as live entities    |
| Merging `rovo-test/*` code violates CLAUDE.md             | Certain without approval | Medium | Cherry-pick with explicit owner exception (F2)                               |
| Realtime limits/unknown scope                             | Low                      | Low    | Separate commit; polling fallback                                            |
| Schedule (13 Nov – 30 Nov)                                | Medium                   | High   | Fall back to the four-scope [M10_JUDGING_RELEASE.md](M10_JUDGING_RELEASE.md) |

## APPROVAL REQUEST (M10 feature-complete release)

```
APPROVAL REQUEST — M10 feature-complete judged release
Owner: please reply in your own words to approve or reject each line.
[ ] F1. Choose the feature-complete build (this proposal) instead of the four-scope
        build in M10_JUDGING_RELEASE.md, on the existing judged app id 113a7a88-…;
        the Marketplace app id stays separate and is never this id.
[ ] F2. Exception to CLAUDE.md: cherry-pick code from rovo-test/phase2 and m9/mcp
        into a new release/judged-full branch (rovo-test branches themselves are not
        merged).
[ ] F3. Production scopes: read:jira-work, read:jira-user, search:confluence,
        read:page:confluence, storage:app. No write:jira-work (Option W off).
        No read:graph:* (Teamwork Graph shown from graph-test only).
[ ] F4. PERMANENT entities: ai-governance, rehearsal-history, crisis-room,
        remediation-item (version integer, payload string, no indexes).
[ ] F5. Modules: rovo:agent x2, action x4 (GET), rovo:mcp x1.
        Dependencies: @forge/kvs, @forge/realtime.
[ ] F6. Live-proof gate: each feature ships only if its §3 test passed by 27 Nov;
        otherwise its module/flag is removed from the release branch.
[ ] F7. New `release-test` environment for a full-build install test before production.
[ ] F8. Production AI flag (SF_AI) stays UNSET (AI off) for judging, unless I approve
        it separately with a daily cap.
[ ] F9. Deploy release/judged-full @ <SHA> to production on 30 Nov, Sharing link,
        tag judged-v1.0.0, second-site judge test (as M10_JUDGING_RELEASE A3–A6).
Rollback I accept: redeploy previous tag; unset flags; storage factories to null;
entities and consented scopes cannot be removed.
```
