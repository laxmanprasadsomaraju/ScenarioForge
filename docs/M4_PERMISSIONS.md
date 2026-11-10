# M4 permissions: least-privilege proposals

Prepared 2026-11-10 (Lane D). Status: **proposal only.** Nothing here has been deployed, installed, registered or consented to. Every scope below needs the owner's approval before it goes into any `manifest.yml`.

Rules used in this document:

- Facts come only from developer.atlassian.com, support.atlassian.com or the dac-static OpenAPI specs, with the URL next to each one. Specs were downloaded on 2026-11-10.
- **[Unverified]** marks anything that no official page states. Community posts appear only as leads, and are labelled as such.
- No wildcards. Each scope is named exactly and justified by a specific call.

Current manifest scopes, for reference: `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`.

## Summary

| Area                 | Probe on `graph-test` (smallest)                                                                                                                                                     | Production M4 (smallest)                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teamwork Graph       | `read:graph:user:atlassian`, `read:graph:team:atlassian`, `read:graph:issue:jira`, plus **one** of `read:graph:component:compass` or `read:graph:assets-object:atlassian` (see §1.9) | `read:graph:issue:jira`, `read:graph:component:compass`, `read:graph:team:atlassian`; add `read:graph:user:atlassian` only if team membership ships |
| JSM services         | No new scope: read the Affected services field with the existing `read:jira-work`                                                                                                    | `read:jira-work` (existing), `read:cmdb-object:jira`, and `read:servicedesk-request` only if the workspace ID cannot be read from the field value   |
| Org admin (blocking) | Owner confirms the role in Atlassian Administration (§3) before any Teamwork Graph install                                                                                           | Same, on every site that installs the app                                                                                                           |

This proposal replaces the probe scope list in [TEAMWORK_GRAPH_TEST_PLAN.md](TEAMWORK_GRAPH_TEST_PLAN.md) §4. `read:graph:project:jira` and `read:graph:deployment:external` are dropped because no M4 need uses them.

## 1. Teamwork Graph

### 1.1 The call (checked in the installed SDK)

The installed `@forge/api` is **8.5.0** (`node_modules/@forge/api/package.json`). `node_modules/@forge/api/out/index.d.ts` declares:

```ts
export interface TeamworkGraphFetchMethods {
  requestTeamworkGraph: (
    query: string,
    variables?: any,
    operationName?: string,
    extensions?: any,
    headers?: Record<string, any>,
  ) => Promise<APIResponse>;
}
type AsUserFetchMethods = RequestProductMethods &
  /* … */ TeamworkGraphFetchMethods &
  WithContextFetchMethods;
type AsAppFetchMethods = RequestProductMethods &
  GraphQLFetchMethods &
  ConnectedDataFetchMethods &
  RequestAtlassianMethods &
  WithContextFetchMethods;
```

What the types and the implementation show:

- **User only.** `requestTeamworkGraph` exists on `asUser()` and is absent from `asApp()`.
- **Fetch-style result.** It returns a fetch-style `APIResponse`, so code reads `.ok`, `.status` and `.json()`.
- **Endpoint and headers.** In `out/api/fetch.js`, the call POSTs `{ query, variables, operationName, extensions }` to `/graphql/twg` through the user-provider proxy. It adds an `X-Query-Context` header from the runtime `contextAri` unless the caller already passes one.

The official example matches: `api.asUser().requestTeamworkGraph(graphqlQuery, variables, null, null, headers)`, read with `r.status` and `await r.json()`. https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/

### 1.2 Status: Preview

- The API is available through Forge's Preview phase. "Schemas, fields, and behavior may still change before general availability (GA)", with breaking changes on at least one month's notice. https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/
- The changelog entry of 15 October 2026 is titled "Teamwork Graph API is now in Preview". It introduces fine-grained `read:graph:<object>:<product>` scopes "for admin control in Connected Apps". https://developer.atlassian.com/platform/teamwork-graph/changelog/
- "Raw `cypherQuery` is unavailable to new apps." New apps use curated queries or persisted Cypher queries. Same call page.
- None of the queries or scopes used here are GA. **All are Preview.** The `read:graph:jira` and `read:graph:confluence` scopes are the retired EAP scopes, and we do not use them. https://developer.atlassian.com/platform/teamwork-graph/scopes/

### 1.3 Which query answers each M4 need

The curated query catalogue has 25 root fields. **None covers Compass components, services, component ownership, or work items impacting components.** https://developer.atlassian.com/platform/teamwork-graph/curated-queries/

So needs (a) and (b) **require persisted Cypher queries**. Need (c) has a curated query.

| Need                                            | Query                                      | Kind             | Input                        | Output                                           | Relationship / source                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------ | ---------------- | ---------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Services the change impacts                 | `scenarioforge_changeImpacts` (our name)   | Persisted Cypher | `$id`: Jira work item ARI    | `CompassComponent` rows                          | `jira_work_item_impacts_compass_component`, JiraWorkItem → CompassComponent. https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/jira-work-item-impacts-compass-component/ |
| (b) Teams that own a service                    | `scenarioforge_componentOwners` (our name) | Persisted Cypher | `$id`: Compass component ARI | Team rows                                        | `atlassian_team_owns_compass_component`, team → CompassComponent. https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/atlassian-team-owns-compass-component/               |
| (c) Team membership (optional)                  | `atlassianTeamMembers(teamAri: ID!)`       | Curated          | Team ARI                     | Users in the team (`edges { node }`, `pageInfo`) | Curated queries page (above)                                                                                                                                                                                    |
| Alternative to (a) when the site has no Compass | `scenarioforge_changeAssets` (our name)    | Persisted Cypher | `$id`: Jira work item ARI    | `AssetsObject` rows                              | `jira_work_item_links_assets_object`. https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/jira-work-item-links-assets-object/                                              |
| Plumbing check (probe only)                     | `atlassianUserInTeams(userId: ID!)`        | Curated          | User ARI of the caller       | Teams the user belongs to                        | Curated queries page (above)                                                                                                                                                                                    |

Cypher text, adapted from the official forward-query examples on the relationship pages above:

```cypher
// (a) scenarioforge_changeImpacts
MATCH (item:JiraWorkItem {ari: $id})-[:jira_work_item_impacts_compass_component]->(component:CompassComponent)
RETURN component

// (b) scenarioforge_componentOwners (reverse direction of the official example)
MATCH (team:TeamsTeam)-[:atlassian_team_owns_compass_component]->(component:CompassComponent {ari: $id})
RETURN team

// Alternative (a) scenarioforge_changeAssets
MATCH (item:JiraWorkItem {ari: $id})-[:jira_work_item_links_assets_object]->(object:AssetsObject)
RETURN object
```

Unverified points about these queries:

- **[Unverified] Team label.** The official example for (b) labels the team node `TeamsTeam`, while the scopes page names the type `AtlassianTeam`. Validate the label in the query builder before registering. Queries are immutable, so a wrong label costs a new key.
- **[Unverified] Reverse traversal.** The pages show only the forward direction. Reverse matching (component → owning team) is standard Cypher, but it is not demonstrated in the docs.
- **[Unverified] Using `ownerId` instead.** The `CompassComponent` object type has an `ownerId` field. https://developer.atlassian.com/platform/teamwork-graph/api-reference/object-types/CompassComponent/ It might give the owner without query (b). Whether it holds a team ARI is not documented.
- **[Unverified] Field selection.** Exact GraphQL field names on each node type should be confirmed against the live schema at `GET https://one-atlas-cegq.atlassian.net/gateway/api/graphql/twg/schema`, as the curated queries page recommends.

### 1.4 Registering the persisted queries (owner action)

Source: https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/

1. **Who.** "Only a contributor can register queries for it", meaning a contributor on the owning app. Queries belong to the app, and only that app can execute them.
2. **Where.** Use TWG Labs, the recommended route. It validates the query and lists it under "Saved queries". Alternatively, send `POST https://one-atlas-cegq.atlassian.net/gateway/api/twg/cypher-queries` with `Content-Type: application/json` and this body:
   - `appId` (required)
   - `name` (required)
   - `cypher` (required; every value is a `$param` placeholder)
   - `paramsSchema` (optional; types `ARI`, `STRING`, `INTEGER`, `FLOAT`, `BOOLEAN`, `JSON`)
3. **Result.** A new query returns `201 Created` with a `queryKey`. Identical Cypher for the same app returns `200 OK` with the original key.
4. **Wait.** Allow about a minute before use. Until then the key returns `QUERY_NOT_FOUND`, which is expected and retryable.
5. **Execute.**
   - Call `customQuery(queryKey, queryParams, first ≤ 25, after)` on `/gateway/api/graphql/twg`. The operation signature in the docs is `query companyName_assignedWork($queryKey: String!, $queryParams: CypherRequestParams)`.
   - Results come back as `edges → node → columns { key value }` (call page).
6. **Immutability.** Registered queries cannot be edited. A change means new text, a new key, and an app update.

Gaps in that page:

- **[Unverified]** The exact `appId` format (app ARI or UUID).
- **[Unverified]** The JSON shape of `paramsSchema`.
- **[Unverified]** Whether keys are per environment. If they are, `graph-test` and production each need their own registration. Store the key in a Forge variable per environment (`forge variables set -e <env> …`).
- Other documented execution errors are `QUERY_NOT_ACTIVE`, `NOT_OWNER`, `FEATURE_UNAVAILABLE` and `NOT_FOUND` ("isn't enabled for this caller or environment").

Registering creates an Atlassian resource, so it is the owner's action. Lane D registers nothing.

### 1.5 Exact scopes per query

Source: https://developer.atlassian.com/platform/teamwork-graph/scopes/

The page's rule: an app needs one scope per object type the query starts from, passes through or returns. The curated page says the same: a token needs "a scope for every object type the field returns", plus the starting object type.

| Object type                               | Exact scope                          | Needed by                                                |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| JiraWorkItem                              | `read:graph:issue:jira`              | (a), alternative (a)                                     |
| CompassComponent                          | `read:graph:component:compass`       | (a), (b)                                                 |
| AtlassianTeam                             | `read:graph:team:atlassian`          | (b), (c), plumbing check                                 |
| AtlassianUser                             | `read:graph:user:atlassian`          | (c), plumbing check                                      |
| AssetsObject                              | `read:graph:assets-object:atlassian` | alternative (a) only                                     |
| ExternalService (not used; for reference) | `read:graph:service:external`        | Only for connector-ingested services, not JSM or Compass |

All are read-only and in Preview. Forge caps an app at 50 scopes (scopes page). Proposed production M4 would take us from 4 to 7 or 8 scopes.

### 1.6 What happens when a scope is missing

Source: scopes page.

- "A missing scope doesn't produce an error."
- "A query that reads an object type you weren't granted comes back successful and empty."
- "A missing scope anywhere in the traversal empties the whole result." In mixed traversals, "you get the types you were granted and silently miss the others."
- "When a scope is toggled off, any queries targeting that entity or relationship are blocked server-side." "Scope changes take up to a minute."
- The call page repeats the point: "Missing or disabled scopes do not produce a deployment or API error". Queries "succeed but omit unreadable data".

**Consequence:** at runtime an app cannot tell "no relation" apart from "scope off". §4 handles this.

### 1.7 Rate and size limits

- **Page size.** `first` defaults to 25 and has a maximum of 25. "Requesting more returns an error" (curated queries page). Persisted queries are capped the same way: a page can hold fewer rows than requested, and `pageInfo.hasNextPage` drives paging (persisted queries page).
- **Rate limits.** The official rate-limits page covers only the connector SDK. Limits there are "enforced per app and tenant combination". https://developer.atlassian.com/platform/teamwork-graph/rate-limits/
  - **[Unverified]** No official consumption-API rate limit, 429 behaviour or `Retry-After` handling is documented.
  - Community lead only: about 128 calls per 20 s, with rate-limited calls returning empty lists ([community 103629](https://community.developer.atlassian.com/t/reading-the-teamwork-graph-api-from-a-forge-rovo-agent-the-failures-that-return-http-200-or-an-empty-list/103629)).
  - M4 bounds already cap one build at 20 services and 20 teams (`MAX_GRAPH_SERVICES`, `MAX_GRAPH_TEAMS`). That is at most 1 + 20 calls, run sequentially.
- **[Unverified]** No maximum query text size or response size is documented.

### 1.8 Org admin requirement and what the admin sees

- "Installing apps with the Teamwork Graph scopes requires organization administrator permissions", "due to the organization-wide data access these scopes provide." https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/
- The API works only for apps installed in Jira or Confluence (same page).
- Admins control the new scopes in Connected Apps (changelog, 15 Oct 2026). "When a scope is toggled off…" (scopes page) implies per-scope toggles.
- Existing installs: "Admins are asked to grant the new scopes, so existing installations need to consent again" (scopes page).
- Connected apps path, for org or site admins: Atlassian Administration → **Apps** → **Sites** → site → **Connected apps** → **View App Details**. Major updates such as permission changes need admin approval. https://support.atlassian.com/organization-administration/docs/managing-an-installed-app/
- **[Unverified]** The exact wording of the consent screen, and where the per-scope toggle sits in View App Details. No official screenshot or text was found.

### 1.9 Does Compass data exist on our site?

- **The demo site has no Compass.** A Forge demo site includes "enterprise editions of Jira, Confluence, Jira Service Management, and Rovo". Compass is not listed. https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/
- **The documentation describes the component as Compass data.** The CompassComponent object "Represents a software component tracked in Compass". The relationship pages do not say how `jira_work_item_impacts_compass_component` is populated. **[Unverified]** whether JSM's Affected services field feeds it without Compass.
- **JSM services become Compass components only when both products are active.** "Services in Jira Service Management live in two pre-provisioned Assets schemas." "Objects in both schemas appear as Compass components when the products are connected." Conditions:
  - "The sync is automatic once both products are active on your Atlassian organization."
  - Only Software Services, Capabilities and Applications types sync.
  - The feature is limited to customers who gained access to both products after January 2024.
  - "Without both products active, services and components stay separate."
  - Source: https://support.atlassian.com/jira-service-management-cloud/docs/how-services-work-across-jira-service-management-and-compass/
- **Compass is changing.** "Compass scorecards and catalog functionality will transition into the DX app." https://support.atlassian.com/compass/docs/import-components-from-jira-service-management/ The effect on `CompassComponent` data in Teamwork Graph is **[Unverified]**. Building on Compass therefore carries risk.
- **How the owner checks, with no app and no new resources:**
  1. Go to Atlassian Administration → **Apps** → **Sites** → `one-atlas-cegq` and look at which apps the site lists (managing-an-installed-app page above). If Compass is not listed, the Compass path will return `empty`.
  2. In the Teamwork Graph query builder (https://teamwork-graph.atlassian.com/query-builder, "select the correct site" — call page), run query (a) for a change issue that has Affected services set.
- **Decision rule for the probe:**
  - If Compass is absent, the probe requests `read:graph:assets-object:atlassian` instead of `read:graph:component:compass` and tests the Assets path.
  - **[Unverified]** The Assets path cannot give an owner team: the AssetsObject type has no owner field (https://developer.atlassian.com/platform/teamwork-graph/api-reference/object-types/AssetsObject/).

### 1.10 Rovo credits

Source: https://support.atlassian.com/rovo/docs/rovo-usage-limits/

- Free: "Requesting single product context, such as looking up a Jira work item or Confluence page's content".
- Paid: "Rovo credits are consumed when enriched context is returned from Teamwork Graph via TWG API and tool calls." Enriched calls "involve complex queries, cross-product traversals, and enriched context lookups". "Vast majority of enriched TWG API and tool calls are 1-10 Rovo credits per call."
- Assessment:
  - **[Unverified]** The page does not mention Forge, so it does not say whether `requestTeamworkGraph` from a Forge function is billed.
  - If it is, (a) Jira → Compass and (b) team → Compass are cross-product traversals, so they are likely enriched. (c) team → users may count as single-product. That classification is **[Unverified]**.
  - Credits are paid by the customer org (see [BONUS_FEASIBILITY.md](BONUS_FEASIBILITY.md) §2 sources).
  - Keep the usage governor rule from M4_PLAN: TWG calls are bounded and never automatic on page load until this is settled.

### 1.11 Minimal proposals

**Probe on `graph-test`: 4 scopes, a throwaway branch, the owner's approval, and only after §3 confirms org admin.**

```yaml
# graph-test only; replaces TEAMWORK_GRAPH_TEST_PLAN.md §4 list
- read:graph:user:atlassian # plumbing check atlassianUserInTeams; (c) atlassianTeamMembers
- read:graph:team:atlassian # same, and (b)
- read:graph:issue:jira # start node of (a)
- read:graph:component:compass # (a)/(b) — ONLY if §1.9 shows Compass on the site
# otherwise, instead of the line above:
# - read:graph:assets-object:atlassian   # alternative (a) via jira_work_item_links_assets_object
```

**Production M4: 3 scopes, plus 1 optional.**

```yaml
- read:graph:issue:jira # (a) start node
- read:graph:component:compass # (a) result, (b) start node
- read:graph:team:atlassian # (b) result
# - read:graph:user:atlassian       # only if team membership (c) ships (M7 invite list)
```

Notes on production:

- Ship production scopes only after the probe has returned real data (M4_PLAN step 4).
- Adding them to an existing install triggers re-consent by an org admin (§1.8).
- If the probe shows no Compass data, production ships **no** Teamwork Graph service scopes. The graph keeps working from Jira, Confluence and JSM (M4_PLAN step 5).

## 2. JSM services

### 2.1 Endpoints that exist

| Purpose                                | Endpoint                                                                                                       | Scopes (from spec)                                                                                                          | Usable from Forge?                                                                                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service registry attributes            | `GET /rest/atlassian-connect/1/service-registry?serviceIds=`                                                   | none listed                                                                                                                 | **No.** "Only Connect apps can make this request". `x-atlassian-connect-scope: INACCESSIBLE`, `x-experimental: true`. Jira platform spec https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json                                                              |
| A list of services in the JSM REST API | none                                                                                                           | —                                                                                                                           | The JSM spec has no service or service-registry listing endpoint. https://dac-static.atlassian.com/cloud/jira/service-desk/swagger.v3.json                                                                                                                                    |
| `/rest/service-registry-api/service`   | not in any official spec                                                                                       | —                                                                                                                           | **Not a public API.** Community lead only ([58123](https://community.developer.atlassian.com/t/how-to-get-the-services-using-the-jira-service-desk-api/58123)). Do not use.                                                                                                   |
| Assets workspace ID                    | `GET /rest/servicedeskapi/assets/workspace`                                                                    | classic `read:servicedesk-request` (no granular alternative listed)                                                         | Yes, through `requestJira` (JSM spec above)                                                                                                                                                                                                                                   |
| Services as Assets objects (search)    | `POST /jsm/assets/workspace/{workspaceId}/v1/object/aql` (params `startAt`, `maxResults`, `includeAttributes`) | granular `read:cmdb-object:jira` (state Current)                                                                            | Yes. "`/ex/jira/{cloudId}` … is not required when making the request in a Forge app using `requestJira`", and the official example uses `api.asUser().requestJira`. https://developer.atlassian.com/cloud/assets/assets-rest-api-guide/scopes-for-oauth-2-3LO-and-forge-apps/ |
| One service object and its attributes  | `GET …/v1/object/{id}`, `GET …/v1/object/{id}/attributes`                                                      | `read:cmdb-object:jira`                                                                                                     | Yes (same). Assets spec https://dac-static.atlassian.com/cloud/assets/swagger.v3.json                                                                                                                                                                                         |
| Affected services on a change issue    | `GET /rest/api/3/issue/{issueIdOrKey}?fields=<affected services field id>`                                     | classic `read:jira-work` (Current); granular Beta set includes `read:issue:jira`, `read:field-configuration:jira`, and more | Yes. **Already granted.** Jira platform spec above                                                                                                                                                                                                                            |
| Find the Affected services field ID    | `GET /rest/api/3/field`                                                                                        | classic `read:jira-work` (Current)                                                                                          | Yes. **Already granted.**                                                                                                                                                                                                                                                     |

Where services live:

- JSM services are Assets objects in "two pre-provisioned Assets schemas" (support page in §1.9).
- **There is no stable public endpoint named "services".** The public route is the Assets REST API.

### 2.2 Availability

- "Services aren't available on the Free plan after **31 July 2026**". Upgrading to a paid plan "will unlock access to Services". https://support.atlassian.com/jira-service-management-cloud/docs/how-services-work-across-jira-service-management-and-compass/ So on JSM Free there is nothing to read.
- **[Unverified]** Whether Assets (and so the services API) is on Standard. Official support pages did not render the plan table. Treat Standard as uncertain until checked on a real Standard site.
- The demo site runs JSM enterprise edition (demo-site page), so services should be available there. **[Unverified]** until checked on the site.

### 2.3 asUser from Forge

- The official Assets guide example uses `api.asUser().requestJira(...)` (guide above). That is the documented pattern.
- **[Unverified]**, community leads only: Assets object permissions also apply, and users without Assets access get 401/403 ([100939](https://community.developer.atlassian.com/t/forge-apps-cannot-authenticate-to-the-assets-rest-api-cmdb-scopes-return-401-even-after-forge-install-upgrade/100939)). Map 401/403 to `not-permitted`, never to "no services".

### 2.4 Reading a service's owner team

- **[Unverified]** The Services schema's owner-team attribute name and type are not documented on any official page we could render.
- The plan is to read `GET …/v1/object/{id}/attributes` (`read:cmdb-object:jira`) and pick the attribute whose type references a team. The attribute name and team ID format come from a one-off inspection on the demo site.
- Until then no `team-owns-service` edge comes from JSM. The link is listed as `unassessed` with `source: 'jsm'`.

### 2.5 Minimal proposals

**(a) Services affected by a change issue.**

- **Step 1 (probe, no new scope).** Use the existing `read:jira-work`:
  1. Call `GET /rest/api/3/field` and find the Affected services field ID.
  2. Call `GET /rest/api/3/issue/{key}?fields=<id>` on a change issue with services set.
  3. Record the raw value shape.
  - **[Unverified]** The value shape (service IDs, Assets object IDs, or a workspace ID plus object ID) is not documented in the platform spec. The spec mentions the field only as the "Affected Services" option for pre-populating approvers.
- **Step 2 (only if Step 1 needs names).** Add `read:cmdb-object:jira` to resolve each referenced object to its label.
  - If the field value carries the workspace ID, nothing else is needed.
  - If it does not, add `read:servicedesk-request` for `GET /rest/servicedeskapi/assets/workspace`. This is a broad classic scope (it also covers reading requests) and the spec lists no granular alternative. It is proposed only as a last resort.

**(b) A service's owner.**

- Only `read:cmdb-object:jira`: `GET …/v1/object/{id}/attributes`, after the attribute is identified (§2.4).
- **Not proposed:** `read:cmdb-schema:jira`, `read:cmdb-type:jira` and `read:cmdb-attribute:jira`. They are needed only to browse schema metadata, which a one-off manual inspection replaces.

**Production minimum:**

- `read:jira-work` (existing)
- `read:cmdb-object:jira`
- `read:servicedesk-request`, conditional on Step 1

If Step 1 shows the field is empty or unreadable on the demo site, the change → service edge falls back to Teamwork Graph (§1), or stays `unassessed`.

## 3. Organisation admin verification (owner, browser only, changes nothing)

Atlassian Administration is at https://admin.atlassian.com.

### 3.1 Is the owner an org admin of the org that owns `one-atlas-cegq.atlassian.net`?

1. Sign in at https://admin.atlassian.com with the account that ran `forge install`.
2. If more than one organisation is offered, pick one: "Select your organization if you have more than one." https://support.atlassian.com/organization-administration/docs/managing-an-installed-app/
3. Find the org that owns the site:
   1. Select **Apps** → **Sites** (same page).
   2. Confirm `one-atlas-cegq` is listed.
   3. If it is not, switch org and repeat.
   4. If no org lists it, go to §3.3.
4. Confirm your role:
   1. Select **Directory** → **Users**.
   2. Select your own user to open the profile, then the more actions menu (**•••**).
   3. The menu offers the organisation admin action, and "Only an organization admin can assign this role". https://support.atlassian.com/user-management/docs/give-users-admin-permissions/
   4. An org admin also belongs to the `org-admins` group (or `site-admins`), "since that group grants the organization admin role" (same page). The group name may differ.
   - **[Unverified]** Whether the profile shows a visible "Organization admin" label. The support page only says the profile "should be updated" after a grant.
5. Record the result in `docs/SETUP_STATUS.md`: org name, site listed (yes or no), and role.

What each role means for this check:

| Role               | What they can do                                                                                                                                                            | What they see / enough for Teamwork Graph?                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization admin | "the highest level of admin"; can approve app access requests and add apps. https://support.atlassian.com/user-management/docs/what-are-the-different-types-of-admin-roles/ | **Enough.** Teamwork Graph scopes require this role (§1.8).                                                                                                                                           |
| Site admin         | Manages apps "only for the site they administer" (same page)                                                                                                                | Can open **Connected apps** ("organization admin or a site admin", managing-an-installed-app page). **Not enough** for Teamwork Graph scopes. **[Unverified]** what the Directory shows a site admin. |
| App admin          | "They don't have access to Atlassian Administration" (same page)                                                                                                            | No Atlassian Administration access.                                                                                                                                                                   |

A user with no admin role sees no organisation. The exact message is **[Unverified]**.

### 3.2 Alternative check

From **Directory** → **Users**, open the `org-admins` group (or the org's equivalent) under **Groups** and look for your account (give-users-admin-permissions page). **[Unverified]** whether the Users list can be filtered by role; a community answer says it can.

### 3.3 The demo site's org, and whether provisioning makes the requester org admin

- `forge site provision` shows the active demo site's "name, URL, status, and expiry date". If one already exists, it returns that site instead of provisioning another. "Only one active demo site is assigned to each developer." Sites last "90 days by default". https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/ The command does not show the org.
- **[Unverified]** The demo-site page does not say which organisation owns the site, or whether the requester becomes site admin or org admin. Neither does Forge getting started (https://developer.atlassian.com/platform/forge/getting-started/).
- Therefore steps 1 to 4 in §3.1 are the only reliable check. Re-running `forge site provision` only confirms the site name and expiry, and provisions nothing while a site is active. Any `forge` command is still the owner's call.
- **If the owner is not org admin:** the Teamwork Graph install is blocked on this site (TEAMWORK_GRAPH_TEST_PLAN.md §5). The JSM path in §2 does not need org admin; it needs only a normal install by a site admin.

## 4. Teamwork Graph probe design (consistent with `shared/graph/types.ts`)

Calls are server-side only and run `asUser`. The browser sends enum values only. Every operation is named `scenarioforge_<purpose>`. Each call returns `TeamworkGraphLookup` from `shared/agents/contracts.ts`.

### 4.1 Query to graph mapping

| Probe / query                                         | Graph nodes produced                                           | `GraphEdgeKind`                                                | `GraphSource`                   | Confidence                                |
| ----------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| `scenarioforge_changeImpacts` (persisted, (a))        | `service` per CompassComponent (`id: service:<component ARI>`) | `change-impacts-service` (change → service)                    | `teamwork-graph`                | `confirmed` (an explicit source relation) |
| `scenarioforge_componentOwners` (persisted, (b))      | `team` per row (`id: team:<team ARI>`)                         | `team-owns-service` (team → service)                           | `teamwork-graph`                | `confirmed`                               |
| `atlassianTeamMembers` (curated, (c))                 | none                                                           | none. The contract has no membership edge; data feeds M7 only. | (`teamwork-graph` in `sources`) | —                                         |
| `scenarioforge_changeAssets` (persisted, alternative) | `service` per AssetsObject                                     | `change-impacts-service`                                       | `teamwork-graph`                | `confirmed`                               |
| JSM Affected services field (§2.5)                    | `service` per referenced object                                | `change-impacts-service`                                       | `jsm`                           | `confirmed`                               |
| `atlassianUserInTeams` (plumbing check, probe only)   | none                                                           | none                                                           | —                               | —                                         |

Other rules:

- Nodes are capped by `MAX_GRAPH_SERVICES` and `MAX_GRAPH_TEAMS`. A truncated page is recorded in `SourceStatus.detail`.
- Each edge carries an `EvidenceReference` with the query name, the ARI and `retrievedAt`.
- **Contract gap for the lead:** `EvidenceReference.kind` has no Teamwork Graph value today (`'jira-issue' | 'confluence-page' | 'jsm-service' | 'runbook-step' | 'scenario-rule'`). Propose adding `'teamwork-graph'`. Lane D does not edit `shared/`.

### 4.2 Empty versus not permitted

| Observation                                                                                          | `SourceStatus.status` | Graph effect                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope not in manifest / environment without the Teamwork Graph build                                 | `not-connected`       | One `UnassessedLink` per expected link, reason "Teamwork Graph not enabled for this install".                                                                                                                                                          |
| HTTP 401/403                                                                                         | `not-permitted`       | `UnassessedLink`, reason with the status code.                                                                                                                                                                                                         |
| HTTP 200 with `errors[]` coded `NOT_OWNER`, `FEATURE_UNAVAILABLE`, `QUERY_NOT_ACTIVE` or `NOT_FOUND` | `not-permitted`       | `UnassessedLink`, reason from the error code (codes from the persisted queries page).                                                                                                                                                                  |
| HTTP 200 with `QUERY_NOT_FOUND`                                                                      | `error`               | Retry once later (propagation window). Otherwise `UnassessedLink`.                                                                                                                                                                                     |
| HTTP 429, 5xx, other `errors[]`, unexpected shape                                                    | `error`               | `UnassessedLink`. Never drawn.                                                                                                                                                                                                                         |
| HTTP 200, no errors, rows returned                                                                   | `used`                | Nodes and edges as in §4.1.                                                                                                                                                                                                                            |
| HTTP 200, no errors, **zero rows**                                                                   | `used`                | **No edge, and an `UnassessedLink`**. The reason states that Teamwork Graph returned no visible relation, and that a disabled scope also returns empty (scopes page, §1.6), so this is not evidence that no service exists. Never rendered as healthy. |

A control query narrows the ambiguous empty case:

- Register `scenarioforge_workItemSelf` as `MATCH (item:JiraWorkItem {ari: $id}) RETURN item`.
- If it returns the item, the issue scope works and the ARI is correct. That rules out the most common silent failure, an ARI mismatch (`siteId` vs `context.cloudId` is **[Unverified]**).
- No control can prove `read:graph:component:compass` is on without a known component. The owner confirms scopes once in **Connected apps** (§1.8).

The control query costs one extra registration and one call per build. The owner may drop it after the probe.

### 4.3 Probe order on `graph-test`

1. `atlassianUserInTeams` for the caller. This proves plumbing, consent and the user and team scopes.
2. `scenarioforge_workItemSelf` for a change issue. This proves the issue scope and the ARI.
3. `scenarioforge_changeImpacts`, or `scenarioforge_changeAssets` if the site has no Compass.
4. `scenarioforge_componentOwners` for the first component returned.
5. (Optional) `atlassianTeamMembers` for the first team.

Pass criteria are unchanged from TEAMWORK_GRAPH_TEST_PLAN.md §3.8. A step passes only on `ok` with items that match the query builder for the same user. Evidence goes to `docs/evidence/`.

## 5. Unverified items (to settle on the site or with Atlassian)

1. The node label for teams in Cypher (`TeamsTeam` in the example, `AtlassianTeam` on the scopes page).
2. `appId` format, the `paramsSchema` JSON shape, and whether persisted queries are per environment.
3. Consumption-API rate limits and 429 behaviour. Only connector limits are official.
4. Whether Forge `requestTeamworkGraph` calls consume Rovo credits, and which of our queries count as enriched.
5. Whether `jira_work_item_impacts_compass_component` is populated without Compass, and how the Compass to DX move affects `CompassComponent`.
6. Whether `CompassComponent.ownerId` is a team ARI.
7. ARI `siteId` equals Forge `context.cloudId`.
8. The value shape of the JSM Affected services field in Jira REST, and whether it carries the Assets workspace ID.
9. The owner-team attribute name and type in the JSM Services Assets schema.
10. Whether Assets/services are available on JSM Standard. (Services are not on Free after 31 July 2026; that is verified.)
11. Assets permission behaviour for `asUser` calls (401 reports in the community).
12. Whether demo-site provisioning makes the requester org admin, and the demo site's org. Not documented; check via §3.
13. The exact admin consent screen text, and where the per-scope toggles sit in Connected apps.

## 6. JSM probe (no new scope)

Added 2026-11-10 (Lane A, branch `lane-a/jsm-probe`). This is §2.5(a) Step 1, which the owner approved. **No scope and no manifest change.** It uses only `read:jira-work`, through `api.asUser().requestJira`.

### 6.1 Calls (checked on the Jira v3 spec, downloaded 2026-11-10)

Spec: https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json

| Call                                               | operationId          | Scopes in the spec                                                                                                                                                          | Notes                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rest/api/3/field`                            | `getFields`          | classic `read:jira-work` (Current); granular Beta `read:field:jira`, `read:avatar:jira`, `read:project-category:jira`, `read:project:jira`, `read:field-configuration:jira` | "Permissions required: None." It returns only the fields the user can view: those used in a project where the user has _Browse Projects_. Responses are 200 and 401. Connect scope is `READ`. |
| `GET /rest/api/3/issue/{issueIdOrKey}?fields=<id>` | `getIssue`           | classic `read:jira-work` (Current)                                                                                                                                          | This is the issue read the analysis already makes. The probe makes a second call that asks only for the field.                                                                                |
| `GET /rest/api/3/field/search` (**not used**)      | `getFieldsPaginated` | classic `read:jira-work` (Current)                                                                                                                                          | Described as "a paginated list of fields for Classic Jira projects", with Connect scope `NONE`. `getFields` is simpler and already covers the probe.                                          |

The field ID is looked up on every graph build and never cached across invocations. This matters because the field list depends on the user's project permissions.

### 6.2 Field detection rule, and its uncertainty

1. A custom field whose `schema.custom` is `com.atlassian.jira.plugins.service-entity:service-entity-field-cftype` (`AFFECTED_SERVICES_CUSTOM_TYPE`).
2. Otherwise, a custom field named "Affected services" (any case) whose `schema.type` is `array` and whose `schema.items` mentions "service". A name alone never matches.
3. If several fields match the same rule, the one with the lowest ID wins, so the result is deterministic.

- **[Unverified on developer.atlassian.com]** The custom type string. The Jira REST spec only mentions the field as the "Affected Services" option for `prePopulatedFieldId`. The string comes from Atlassian's public issue tracker, https://jira.atlassian.com/browse/CONFCLOUD-76552. There the field schema reads `"type": "array", "items": "service-entity-field", "custom": "com.atlassian.jira.plugins.service-entity:service-entity-field-cftype"`. The same type string appears in a community post (lead only).
- **[Unverified]** The value shape. The same tracker entry shows the value as `[{ "id": "ari:cloud:graph::service/<uuid>/<uuid>" }]`, with no name. The support KB https://support.atlassian.com/jira/kb/how-to-set-the-affected-services-field-from-referenced-services-on-an-assets-object-attribute-via-automation-for-assets/ writes the field as `[{"id": "<Service ID>"}]`.

### 6.3 Value parsing

- `null`, or the field missing from the issue response, means empty.
- An array of objects, each with a non-empty string `id`, is read. The optional string `name`, `workspaceId` and `objectId` are kept. Other keys are ignored.
- Anything else is **unreadable**: a string, a bare object, an entry without a string `id`, or a known key that holds something other than a string. The probe then shows no service and sets JSM to `error`. It never guesses which key holds a service.
- `workspaceId` and `objectId` are kept for the Assets proposal (§2.5 Step 2). They are never resolved, and the probe makes no Assets call.

### 6.4 What the probe can and cannot see

It can see:

- whether the user can see an Affected services field on the site;
- the entries of that field on the change, as Jira returns them to that user;
- the service name, but only if the value carries one.

It cannot see:

- **Service names when the value holds only IDs.** This is the shape on record. Such a service is labelled with its ID verbatim, and the JSM detail says that resolving names needs Assets.
- **Which service a runbook recovers.** No `page-recovers-service` edge is drawn. Each page with a finding gets an unassessed JSM service link instead.
- **Owning teams.** No `team-owns-service` edge is drawn. Each service gets an unassessed team link with `source: 'teamwork-graph'`, and the existing Teamwork Graph per-page entries stay.
- Service tier, dependencies, or anything else in the service registry or Assets.

### 6.5 Graph mapping

| Probe result                                              | JSM source status | Detail                                                             | Graph                                                                                                                                                                                            |
| --------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| no matching field                                         | `not-connected`   | "No Affected services field on this site."                         | Per-page unassessed JSM service links (the builder default)                                                                                                                                      |
| field read, N services                                    | `used`            | "Affected services field read on MC-62: N service(s)."             | Per service: a `service:jsm:<id>` node (source `jsm`, origin `live`) and a confirmed `change-impacts-service` edge with `jsm-service` evidence (excerpt = the service name, URL `/browse/<KEY>`) |
| field read, empty                                         | `used`            | "… 0 service(s)."                                                  | Unassessed `change:<KEY>` service link: "Affected services is empty on <KEY>."                                                                                                                   |
| HTTP 401/403 on either call                               | `not-permitted`   | names the call and the status                                      | No service; per-page unassessed links carry the detail                                                                                                                                           |
| other HTTP error, unreadable body or value, network error | `error`           | names the call and the status, or says the value could not be read | Same as above                                                                                                                                                                                    |

A probe failure never fails the graph, and `validateGraph` still guards every build.

### 6.6 What the live check should show (owner, MC-62 on the demo site)

1. **Field set on MC-62.**
   - JSM shows `used`, with the detail "Affected services field read on MC-62: N service(s)."
   - The impact path shows one service node per entry, joined to the change by a confirmed edge.
   - With the value shape on record (ID only), each label is the service ARI. The detail adds "N without a name in the field; shown by id (resolving names needs Assets, not connected)."
   - That result is the evidence for §2.5 Step 2. If the label is a readable name instead, the value carries `name` and Step 2 is not needed for names.
2. **Field empty on MC-62.** JSM shows `used`, and the change carries the unassessed note "Affected services is empty on MC-62."
3. **No field on the site** (for example, no JSM, or JSM Free after 31 July 2026). JSM shows `not-connected` with "No Affected services field on this site."
4. **JSM shows `error` with "could not read".** The value shape differs from §6.3. Record the raw shape by hand from the issue's REST response (`/rest/api/3/issue/MC-62?fields=<id>` in the browser) before any code change.
5. **In every case:**
   - No team node appears.
   - No runbook page is linked to a service.
   - The Teamwork Graph source stays `not-connected`.

### 6.1 Live result (2026-11-10, owner, `confluence-test` 2.4.0, MC-62)

| Check                                                                    | Result                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Affected services field found and read with `read:jira-work` only        | **Passed**: JSM "Used — Affected services field read on MC-62: 0 service(s)."         |
| Empty field shown honestly                                               | **Passed**: impact path says "Affected services is empty on MC-62."                   |
| Sources strip                                                            | Jira used; Confluence used (1 of 1 recovery pages read); Teamwork Graph not connected |
| No invented service or team                                              | **Passed**: owning team not assessed                                                  |
| Populated field (service node and confirmed change-impacts-service edge) | **Not yet verified live** (MC-62 has no affected service). Covered by tests only      |

Decision: no new JSM scope is needed for the field-read path. Assets scopes are not requested on the basis of an empty field.
