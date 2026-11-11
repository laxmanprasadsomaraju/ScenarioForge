# M9 Teamwork Graph runbook (prepared, not deployed)

Status: **Code complete, Automated tests passed** on `m9/twg`. Not deployed and not live verified. The manifest on this branch is **unchanged**, so no `read:graph:*` scope is requested, and the code is off by default.

## What the code does

- `src/twg/gateway.ts` runs persisted Cypher queries with `api.asUser().requestTeamworkGraph(query, variables, operationName)`. Every call is classified per [M4_PERMISSIONS.md](M4_PERMISSIONS.md) §4.2:
  - HTTP 401/403 → `not-permitted`.
  - HTTP 200 with `errors[]` coded `NOT_OWNER`, `FEATURE_UNAVAILABLE`, `QUERY_NOT_ACTIVE`, `NOT_FOUND` or `INSTALLATION_NOT_FOUND` → `not-permitted`.
  - Any other `errors[]` (including `QUERY_NOT_FOUND`, which adds a propagation hint), 429, 5xx, a thrown call or an unexpected shape → `error`.
  - Zero rows → `empty`. Rows → `ok`.
- `shared/graph/twg.ts` (`twgGraphExtras`) is pure. Service and team nodes come only from rows that were returned (`service:<component ARI>` and `team:<team ARI>`), with confirmed `change-impacts-service` and `team-owns-service` edges. Each edge has `teamwork-graph` evidence.
  - Empty results add an `UnassessedLink` whose reason includes: "A disabled scope also returns empty, so this is not evidence that none exists."
  - Failures become `UnassessedLink`s and are never drawn or treated as healthy.
- `getReadinessGraph` merges JSM and TWG extras. TWG runs only when `SF_TWG=enabled` **and** both query keys are valid UUIDs. Otherwise the source stays `not-connected` and no call is made.
- The work item ARI is built on the server as `ari:cloud:jira:<context.cloudId>:issue/<id>` from a `fields=none` issue read. Whether `siteId` equals `cloudId` is **[Unverified]**.
- Tests: `test/twg.test.ts` uses fakes for flag off, missing keys, ok, empty (impacts and owners), 403, `NOT_OWNER` in a 200, `QUERY_NOT_FOUND` in a 200, 429 (impacts and owners), a thrown call or bad shape, and rows without an ARI.
- Known limit: JSM and TWG service nodes are capped separately at `MAX_GRAPH_SERVICES` each. If both sources are full, `validateGraph` rejects the combined graph, so cap the combined count before production.

## Variables (graph-test only, owner runs them)

```sh
forge variables set -e graph-test SF_TWG enabled
forge variables set -e graph-test TWG_QK_IMPACTS <queryKey of scenarioforge_changeImpacts>
forge variables set -e graph-test TWG_QK_OWNERS  <queryKey of scenarioforge_componentOwners>
```

## Least-privilege manifest diff (graph-test throwaway branch only; NOT on integration)

```diff
 permissions:
   scopes:
     - read:jira-work
     # ...existing scopes unchanged...
+    - read:graph:issue:jira          # start node of scenarioforge_changeImpacts
+    - read:graph:component:compass   # result of (a), start node of (b)
+    - read:graph:team:atlassian      # result of scenarioforge_componentOwners
```

- If the site has no Compass, use `read:graph:assets-object:atlassian` instead of the Compass scope, together with `scenarioforge_changeAssets`. The code then needs that key mapped to the impacts slot and the column renamed to `object`, which is not implemented.
- `read:graph:user:atlassian` is needed only for the optional `atlassianUserInTeams` plumbing check.
- Scope names come from https://developer.atlassian.com/platform/teamwork-graph/scopes/ (Preview).

## Persisted query registration (an app contributor does this)

Source: https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/

1. Register the queries in TWG Labs, or send `POST https://<site>.atlassian.net/gateway/api/twg/cypher-queries` with this body:
   ```json
   {
     "appId": "<app ARI>",
     "name": "scenarioforge_changeImpacts",
     "cypher": "MATCH (item:JiraWorkItem {ari: $id})-[:jira_work_item_impacts_compass_component]->(component:CompassComponent) RETURN component",
     "paramsSchema": [{ "name": "id", "required": true, "type": "ARI" }]
   }
   ```
   Register `scenarioforge_componentOwners` the same way with `MATCH (team:TeamsTeam)-[:atlassian_team_owns_compass_component]->(component:CompassComponent {ari: $id}) RETURN team`. Reverse traversal is **[Unverified]**.
2. The response is `201` with a `queryKey`. Identical Cypher returns `200` with the same key. Queries are immutable.
3. Wait about 1 minute. Until then `QUERY_NOT_FOUND` is expected.
4. The code reads the column keys `component` and `team`, which must match the `RETURN` names.

## Org-admin check (before any install)

The owner opens admin.atlassian.com, picks the site's organisation, and confirms access to **Apps → Sites → Connected apps** and app scope management. "Installing apps with Teamwork Graph scopes requires organization admin permissions" (https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/). If the owner is not an org admin, stop.

## Live test plan (graph-test)

1. Check org admin, as above.
2. Confirm the data exists without the app: in the TWG query builder, a test change has a Compass component with an owning team.
3. Create a throwaway branch from `m9/twg` and apply the manifest diff, then run `forge deploy -e graph-test` and `forge install -e graph-test` (owner). Org admin consents to the scopes.
4. In Connected apps, confirm that all three `read:graph:*` scopes are enabled. Disabled scopes silently return empty.
5. Register the queries and set the variables.
6. Open the readiness graph for the test change.
   - **Pass:** the `teamwork-graph` source is `used`, and the service and team nodes match the query builder.
   - Empty, not-permitted or error results are recorded as such, and no claim is made.
7. Record the evidence in `docs/evidence/twg-live-<date>.md`, with ARIs redacted as needed. Add a dated entry in a `*LIVE_TEST*` doc.
8. Clean up: uninstall and delete the environment, or keep it unmerged.

## Owner approvals needed

- Creating the `graph-test` environment, and deploying and installing it.
- The manifest scope diff (graph-test only).
- Org-admin consent.
- Registering the persisted queries as an app contributor.
- `forge variables set` for `SF_TWG`, `TWG_QK_IMPACTS` and `TWG_QK_OWNERS`.
- Any merge of `m9/twg` into `integration/lanes-1` (the code is inert without the flag).

## Exact approval requests (nothing here is approved; no scope is added by this branch)

Update 2026-11-11 (Lane 3, `release/judged-full-validation`): the saved-query integration stays behind `SF_TWG` (unset). Gateway hardening added with tests (`test/twg.test.ts`): returned ARIs must match `^ari:[A-Za-z0-9:_./-]{1,300}$` or they are dropped (hostile strings are never drawn), the site id interpolated into the work-item ARI must be `[A-Za-z0-9-]{1,64}`, duplicate rows draw once, and partial results (one owner call failing) keep the other relationships and mark only the failed one Not assessed. Status: **Automated tests passed**; no live evidence.

```
APPROVAL REQUEST A (org admin, owner's own words)
I am an organisation admin of <org> and approve installing a graph-test build of
ScenarioForge that requests read:graph:issue:jira, read:graph:component:compass and
read:graph:team:atlassian, on site <site> only. Teamwork Graph reads happen as the
signed-in user. Nothing is written.

APPROVAL REQUEST B (owner)
1. Create environment graph-test and deploy a throwaway branch with the manifest diff above.
2. Register the two persisted queries (scenarioforge_changeImpacts, scenarioforge_componentOwners).
3. forge variables set -e graph-test SF_TWG / TWG_QK_IMPACTS / TWG_QK_OWNERS.
4. Record the live result (including empty or not-permitted) in docs/*LIVE_TEST*.md.
```

The judged build must not contain these scopes. Without a live result TWG is **Code complete / Automated tests passed** and is not claimed as a bonus.
