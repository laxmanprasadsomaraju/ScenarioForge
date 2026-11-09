# Teamwork Graph test plan

Prepared 2026-11-09 (Lane D). Purpose: prove one real Teamwork Graph (TWG) query from ScenarioForge on `one-atlas-cegq.atlassian.net` before any M4 work depends on it.

**We can only claim the Teamwork Graph integration works after a real query, run from a deployed Forge function on a real site, returns data, and the output is captured.** HTTP 200 alone does not count. An empty list does not count. A query that only succeeded in a browser playground does not count.

## 1. Verified facts this plan relies on

- **Backend call.** `api.asUser().requestTeamworkGraph(query)`. API in Forge **Preview**. Raw `cypherQuery` is not available to new apps; use curated queries or persisted queries. https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/
- **Installed SDK signature.** The installed `@forge/api` 8.5.0 declares `requestTeamworkGraph(query, variables?, operationName?, extensions?, headers?) => Promise<APIResponse>` (checked locally in `node_modules/@forge/api/out/index.d.ts`).
- **Changelog, 15 Oct 2026.** "The Teamwork Graph Consumption API is now moving into Preview", and apps should request `read:graph:<object>:<product>` scopes. https://developer.atlassian.com/platform/forge/changelog/
- **Conflict.** The bridge reference still says EAP and uses `read:graph:jira`. https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/requestTeamworkGraph/ The newer pages are followed here; the test settles it in practice.
- **Calls are user-only.** "Forge apps can't call the Teamwork Graph API as the app" (bridge page).
- **Scopes.** One scope per object type the query starts from, passes through or returns. They are read-only. **Missing or admin-disabled scopes omit data silently.** Forge caps apps at 50 scopes. https://developer.atlassian.com/platform/teamwork-graph/scopes/
  - `read:graph:issue:jira` (JiraWorkItem)
  - `read:graph:user:atlassian`
  - `read:graph:team:atlassian`
  - `read:graph:page:confluence`
  - `read:graph:project:jira`
  - `read:graph:deployment:external`
  - `read:graph:service:external`
- **Org admin.** "Installing apps with Teamwork Graph scopes requires organization admin permissions". The API works only for apps installed in Jira or Confluence. https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/
- **Curated query response shape.** Responses use `edges { node }` with `pageInfo`, and `first` can be at most 25. https://developer.atlassian.com/platform/teamwork-graph/curated-queries/
  - Issues: `jiraSpaceWorkItems(spaceAri)`, `jiraWorkItemLinkedExternalDeployments(id)`, `jiraWorkItemLinkedExternalPullRequests(id)`, `jiraWorkItemComments(id, since)`, `jiraWorkItemGoals(id)`, `atlassianUserAssignedJiraWorkItems(userId)`, `atlassianUserReportedJiraWorkItems(userId)`
  - Teams: `atlassianUserInTeams(userId)`, `atlassianTeamMembers(teamAri)`, `atlassianTeamsBySpace(spaceAri)`, `spacesByAtlassianTeam(teamAri)`
  - Pages: `confluencePageOwners(id)`, `confluencePageContributors(id)`, `confluencePageCreator(id)`
  - The page recommends fetching the live schema from `/gateway/api/graphql/twg/schema`.
- **ARIs.** https://developer.atlassian.com/platform/teamwork-graph/understanding-aris/
  - Issue: `ari:cloud:jira:{siteId}:issue/{objectId}`
  - Project: `ari:cloud:jira:{siteId}:project/{objectId}`
  - User: `ari:cloud:identity::user/{accountId}`
  - Team: `ari:cloud:identity::team/{teamId}`
- **Persisted queries.** https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/
  - Register in TWG Labs, or `POST https://<site>.atlassian.net/gateway/api/twg/cypher-queries` with `{ appId, name, cypher, paramsSchema }`.
  - Only an **app contributor** can register, and only the owning app can execute.
  - Execute with `customQuery(queryKey, queryParams, first ≤ 25)`. Allow about 1 minute to propagate (`QUERY_NOT_FOUND` before then).
  - Queries are immutable. Results are filtered by the user's permissions.
- **Custom environments.** Create one with `forge environments create -e <name>`. https://developer.atlassian.com/platform/forge/cli-reference/environments-create/ No naming rules or limits are documented.

### Unverified, and important for this plan

- **Can the same app be installed on one site from two environments at once?** Not documented. Community reports say a second install of the same app on the same site fails with "already installed" (https://community.developer.atlassian.com/t/connect-on-forge-with-different-environments/77442, https://community.developer.atlassian.com/t/the-same-app-key-for-different-environments-in-connect/89227; both mostly about Connect-on-Forge app keys). Plan for it to fail; see §3, step 4.
- **Is the owner an org admin on the demo site's organisation?** The demo-site page does not say who administers the org (https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/). The owner already installed the app there (`forge install` needs site admin), but **org admin is a separate role.** The owner checks this in step 1.
- **Is any Teamwork Graph data present?** Teams, deployments, Compass components and Confluence pages on the seeded demo site are unknown.
- **Operation names.** A community post says a missing `[company]_[operation]` operation name returns HTTP 200 with an error (https://community.developer.atlassian.com/t/reading-the-teamwork-graph-api-from-a-forge-rovo-agent-the-failures-that-return-http-200-or-an-empty-list/103629). The official examples use this style but do not state it as a rule. We always name operations `scenarioforge_<purpose>`.

## 2. Which queries to test, and why

| #   | Query                                       | Input source                                                                    | Scopes                                                    | Why it matters for M4                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Q1  | `atlassianUserInTeams(userId)`              | `context.accountId` → user ARI                                                  | `read:graph:user:atlassian`, `read:graph:team:atlassian`  | Most likely to return data on a seeded site. Proves the plumbing. Feeds owners and teams           |
| Q2  | `atlassianTeamMembers(teamAri)`             | First team from Q1                                                              | `read:graph:team:atlassian`, `read:graph:user:atlassian`  | Crisis-room invite list (M7)                                                                       |
| Q3  | `jiraWorkItemLinkedExternalDeployments(id)` | Issue ARI from a change key (Jira REST gives the numeric id; `context.cloudId`) | `read:graph:issue:jira`, `read:graph:deployment:external` | Change → deployment edge. Likely empty on the demo site; must report `empty`, not "no deployments" |
| Q4  | `jiraSpaceWorkItems(spaceAri)`              | Project ARI from a project key                                                  | `read:graph:project:jira`, `read:graph:issue:jira`        | Cross-checks TWG against Jira REST for the same project. A row count mismatch is a finding         |

Persisted queries ("Jira work item impacts Compass component", "Atlassian team owns Compass component") come only after Q1–Q4 pass, and only if Compass data exists.

Note: the ARI examples include `{siteId}`. Whether this is the same as Forge `context.cloudId` is **unverified**. The probe returns the ARI it built so a mismatch is visible.

## 3. Steps (owner runs them; Lane D deploys nothing)

All work happens on a **throwaway branch**, for example `spike/twg-probe`, never merged as is. The real implementation goes through Lane A in M4 behind a `TeamworkGraphGateway`.

1. **Check org admin (browser).** Open https://admin.atlassian.com, select the demo site's organisation, and confirm the owner sees **Apps → Sites → Connected apps** and can manage app scopes.
   - If not org admin: stop. The TWG install consent cannot be granted, and this target is blocked on this site.
2. **Check the data exists, with no app involved (browser).**
   - Open the Teamwork Graph query builder or TWG Labs on the site. The call page shows the site URL `https://<site>.atlassian.net/gateway/api/graphql/twg`; the exact playground location is linked from the call page.
   - Run Q1 for the owner's account.
   - If no teams exist, create one test team in Atlassian Home first, so Q1/Q2 have data. This creates a resource, so it is the owner's decision.
3. **Create the test environment.** `forge environments create -e graphtest`
4. **Install conflict check.**
   - Run `forge install -e graphtest --site one-atlas-cegq.atlassian.net --product jira`. Do this only after step 5's deploy; the order here is for reading.
   - If the CLI refuses because the app is already installed from `development`, pick one of:
     - (a) **Preferred:** use a scratch app. The owner runs `forge register "ScenarioForge TWG probe"` in a throwaway copy of the repo, then deploys and installs that copy's `development` environment. The real app's installation is untouched.
     - (b) `forge uninstall -e development` on that site, install `graphtest`, and reinstall `development` afterwards. This is disruptive to M1 testing.
5. **Patch and deploy** (throwaway branch only). Apply the patch in §4, then run:
   ```bash
   npm run frontend:build
   forge deploy -e graphtest
   forge install -e graphtest --site one-atlas-cegq.atlassian.net --product jira
   ```
   The install shows the new `read:graph:*` scopes. They require **org admin consent** (step 1).
6. **Confirm scopes are on.** In admin.atlassian.com → Connected apps → the app (GRAPHTEST) → scopes, every `read:graph:*` scope must be enabled. Remember that disabled scopes silently drop rows.
7. **Run the probe.**
   - Open the app in Jira and trigger the `twgProbe` resolver with `probe: 'myTeams'`. The patch adds no UI; call it from the browser devtools console of the Custom UI iframe using `invoke('twgProbe', { probe: 'myTeams' })` from `@forge/bridge`, or add a temporary button on the throwaway branch.
   - Read `forge logs -e graphtest`.
8. **Record evidence.** Save the result JSON (redact account IDs) and a screenshot into `docs/evidence/twg-probe-<date>.md`.
   - **Pass:** at least one probe returns `status: 'ok'` with `items.length > 0`, and the items match what the browser playground showed for the same user.
   - Anything else is recorded as `empty` or `unavailable` with the reason. **No integration claim is made.**
9. **Persisted query** (only if Q1–Q4 pass and Compass data exists).
   - The owner, signed in as an app contributor, registers the Cypher in TWG Labs for the app under test.
   - The `queryKey` goes into `forge variables set -e graphtest TWG_QK_IMPACTS <key>`.
   - Wait about 1 minute, then add a `customQuery` probe.
10. **Clean up.**
    - `forge uninstall -e graphtest` (and reinstall `development` if option (b) was used).
    - `forge environments delete -e graphtest`, or delete the scratch app.
    - Delete the throwaway branch, or keep it unmerged.

## 4. Proposed minimal probe (patch, NOT applied to `src/`)

The design keeps the existing safety rules:

- The browser sends enum values only; no GraphQL text and no IDs except a validated issue/project key.
- Calls run `asUser`, and errors are returned, never thrown.
- `errors[]` is checked even on HTTP 200.
- Results are three-state: `ok` / `empty` / `unavailable`, the same as `TeamworkGraphLookup` in `shared/agents/contracts.ts`.
- Only GraphQL `__typename` and `id` are selected at first, because the node field names are not documented. Add fields after introspecting the live schema.

```diff
--- a/manifest.yml
+++ b/manifest.yml   (throwaway branch only)
@@ permissions:
   scopes:
     - read:jira-work
     - read:jira-user
+    # Teamwork Graph probe (graphtest environment only)
+    - read:graph:user:atlassian
+    - read:graph:team:atlassian
+    - read:graph:issue:jira
+    - read:graph:project:jira
+    - read:graph:deployment:external
```

```diff
--- /dev/null
+++ b/src/twg/probe.ts
@@
+import api, { route } from '@forge/api';
+import type { TeamworkGraphLookup } from '../../shared/agents/contracts';
+
+export const PROBES = ['myTeams', 'teamMembers', 'issueDeployments', 'projectWorkItems'] as const;
+export type Probe = (typeof PROBES)[number];
+const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,8}$/;
+const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,9}$/;
+
+interface Edge { node?: { __typename?: string; id?: string } | null }
+type Item = { typename: string; id: string | null };
+
+const QUERIES: Record<Probe, { name: string; text: string; field: string }> = {
+  myTeams: {
+    name: 'scenarioforge_myTeams', field: 'atlassianUserInTeams',
+    text: `query scenarioforge_myTeams($id: ID!) { atlassianUserInTeams(userId: $id, first: 25) {
+      edges { node { __typename } } pageInfo { hasNextPage endCursor } } }`,
+  },
+  teamMembers: {
+    name: 'scenarioforge_teamMembers', field: 'atlassianTeamMembers',
+    text: `query scenarioforge_teamMembers($id: ID!) { atlassianTeamMembers(teamAri: $id, first: 25) {
+      edges { node { __typename } } pageInfo { hasNextPage endCursor } } }`,
+  },
+  issueDeployments: {
+    name: 'scenarioforge_issueDeployments', field: 'jiraWorkItemLinkedExternalDeployments',
+    text: `query scenarioforge_issueDeployments($id: ID!) { jiraWorkItemLinkedExternalDeployments(id: $id, first: 25) {
+      edges { node { __typename } } pageInfo { hasNextPage endCursor } } }`,
+  },
+  projectWorkItems: {
+    name: 'scenarioforge_projectWorkItems', field: 'jiraSpaceWorkItems',
+    text: `query scenarioforge_projectWorkItems($id: ID!) { jiraSpaceWorkItems(spaceAri: $id, first: 25) {
+      edges { node { __typename } } pageInfo { hasNextPage endCursor } } }`,
+  },
+};
+
+export async function runProbe(
+  probe: Probe,
+  ari: string,
+): Promise<TeamworkGraphLookup<Item> & { ari: string }> {
+  const q = QUERIES[probe];
+  const retrievedAt = new Date().toISOString();
+  const base = { retrievedAt, query: q.name, ari };
+  const res = await api.asUser().requestTeamworkGraph(q.text, { id: ari }, q.name);
+  if (!res.ok) return { ...base, status: 'unavailable', reason: `HTTP ${res.status}` };
+  const body = (await res.json()) as { data?: Record<string, unknown> | null; errors?: unknown[] };
+  if (body.errors?.length) {
+    // HTTP 200 with GraphQL errors is a failure, never an empty success.
+    return { ...base, status: 'unavailable', reason: JSON.stringify(body.errors).slice(0, 500) };
+  }
+  const conn = body.data?.[q.field] as { edges?: Edge[]; pageInfo?: { hasNextPage?: boolean } } | undefined;
+  if (!conn || !Array.isArray(conn.edges)) {
+    return { ...base, status: 'unavailable', reason: 'Unexpected response shape' };
+  }
+  const items = conn.edges.map((e) => ({ typename: e.node?.__typename ?? 'unknown', id: e.node?.id ?? null }));
+  // Empty means "nothing visible to this user with these scopes", not "none exist".
+  if (items.length === 0) return { ...base, status: 'empty' };
+  return { ...base, status: 'ok', items, truncated: conn.pageInfo?.hasNextPage === true };
+}
+
+/** Builds the ARI server-side from validated input; the browser never sends ARIs. */
+export async function ariFor(
+  probe: Probe,
+  input: { key?: unknown; teamAri?: unknown },
+  ctx: { accountId?: string; cloudId?: string },
+): Promise<string | null> {
+  switch (probe) {
+    case 'myTeams':
+      return ctx.accountId ? `ari:cloud:identity::user/${ctx.accountId}` : null;
+    case 'teamMembers':
+      return typeof input.teamAri === 'string' && /^ari:cloud:identity::team\/[0-9a-f-]{36}$/.test(input.teamAri)
+        ? input.teamAri : null;
+    case 'issueDeployments': {
+      if (typeof input.key !== 'string' || !ISSUE_KEY.test(input.key) || !ctx.cloudId) return null;
+      const r = await api.asUser().requestJira(route`/rest/api/3/issue/${input.key}?fields=none`);
+      if (!r.ok) return null;
+      const { id } = (await r.json()) as { id?: string };
+      return id ? `ari:cloud:jira:${ctx.cloudId}:issue/${id}` : null;
+    }
+    case 'projectWorkItems': {
+      if (typeof input.key !== 'string' || !PROJECT_KEY.test(input.key) || !ctx.cloudId) return null;
+      const r = await api.asUser().requestJira(route`/rest/api/3/project/${input.key}`);
+      if (!r.ok) return null;
+      const { id } = (await r.json()) as { id?: string };
+      return id ? `ari:cloud:jira:${ctx.cloudId}:project/${id}` : null;
+    }
+  }
+}
```

```diff
--- a/src/index.ts
+++ b/src/index.ts   (throwaway branch only)
@@
+import { PROBES, ariFor, runProbe, type Probe } from './twg/probe';
@@
+resolver.define('twgProbe', ({ payload, context }) =>
+  guarded(async () => {
+    const probe = (payload as { probe?: unknown })?.probe;
+    if (typeof probe !== 'string' || !(PROBES as readonly string[]).includes(probe)) {
+      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Unknown probe.' } };
+    }
+    const ari = await ariFor(probe as Probe, payload as Record<string, unknown>, context as { accountId?: string; cloudId?: string });
+    if (!ari) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Could not resolve the target.' } };
+    return { ok: true, data: await runProbe(probe as Probe, ari) };
+  }),
+);
```

Notes for whoever applies it:

- `requestTeamworkGraph` returns a fetch-style `APIResponse` in `@forge/api` 8.5.0, so the code uses `.ok`, `.status` and `.json()`. The bridge docs show a different shape (`{ data, errors }`) for the frontend method.
- The `context.cloudId` and `accountId` field names on resolver context should be checked against `@forge/resolver` types before use.
- Selecting `id` on nodes may fail validation if the type has no `id` field. If so, select `__typename` only, then introspect. This is why `id` is omitted from the query text above; `Item.id` stays null until the schema is known.
- Rate limits: call one probe at a time. The community reported limits at about 128 calls per 20 s.
- Never ship this resolver to the judge build. The M4 implementation moves this logic behind a `TeamworkGraphGateway` with unit tests using fakes (ok, empty, errors-in-200, HTTP 429).

## 5. Exit criteria

| Outcome                                             | Meaning                                           | Next step                                                        |
| --------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Q1 `ok` with items matching the playground          | Plumbing, scopes and consent work                 | M4: gateway + Q2–Q4; plan persisted queries                      |
| All `empty`, and the playground also shows nothing  | No data on the site                               | Seed a team (owner), retest. No claim yet                        |
| `empty` from the app, but the playground shows data | Scope disabled or ARI mismatch                    | Check Connected apps scopes; compare the ARI with the playground |
| `unavailable` with an EAP/permission error          | API not available to this app in this environment | Record it; TWG bonus at risk; ask in the `codegeist-2026` tag    |
| Owner not org admin                                 | Blocked on this site                              | Use a site where the owner is org admin, or drop the TWG target  |
