# Security boundaries

What ScenarioForge may do, per environment, and what it must never do. Design detail: [ARCHITECTURE.md § Security model](ARCHITECTURE.md#security-model); dependency audit and credentials: [SECURITY.md](SECURITY.md); AI rules: [AI_USAGE_GOVERNANCE.md](AI_USAGE_GOVERNANCE.md).

## Data access

- Every Jira and Confluence call runs **as the signed-in user** (`asUser`). No `asApp` path for user data. Missing identity returns `IDENTITY_UNAVAILABLE` (D19); it never falls back to app identity.
- Read-only scopes only: `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`; plus `storage:app` on `rovo-test` only.
- No external egress, no remote backends. All compute runs on Forge.
- JQL and CQL are built server-side from validated inputs; the client never sends query text.

## Writes

- **No write scope is installed anywhere.** M8 prepares an exact request and shows it; it does not create Jira work items or Confluence comments.
- Any future write requires: owner approval of the scope, a per-item human approval re-checked server-side, an idempotency key, and creation as the approving user (see [M8_PLAN.md](M8_PLAN.md)).
- Rovo agents and MCP tools get no write actions.

## AI and Rovo

- AI never decides findings, scores or verdicts; the deterministic engine does. Agents cite evidence ids returned by actions; grounding checks reject uncited claims.
- AI is off unless the site opt-in is set (`SF_ROVO_TEST_AI=enabled`, rovo-test only) and the budget governor allows it; refusals are `USAGE_LIMITED`, never "not assessed" and never a pass.
- No paid Rovo usage; extra usage stays disabled.

## Storage

- Forge Custom Entity Store only (rovo-test). Per-user records; reads re-verify audit integrity. Entity names and attributes are permanent once deployed.

## Logging and secrets

- No account ids, emails, names or page bodies in logs. `test/logHygiene.test.ts` parses `src/` and `shared/` with the TypeScript compiler API and fails on any console or `log`/`logger` call whose argument is not a literal, a template of safe parts, `.name`/`.status`/`.code`/`.length`, `Number(...)`, or an object literal of those; aliasing `console` also fails. `src/probes/` (rovo-test diagnostics) is exempt. Automated tests passed.
- Crisis Room payloads carry no Atlassian account ids. Clients see opaque per-room participant ids (HMAC-SHA-256 under a server-only per-room key; rooms created before the key existed derive one from installation and room id). Identity and role checks use the real account id from the invocation context. Automated tests passed (leak test over all roles); not live verified.
- Deep-link base (`forgeLinkBase`) caches the validated `https://*.atlassian.net` origin per installation for 10 min (failures 5 s, max 32 entries); `appUrl` stays null on any failure.
- No credentials in the repo; Forge CLI credentials in the OS keychain. An API token exposed in chat on 2026-11-09 must be revoked by the owner (open).

## Approval boundary

Only the owner's own message is approval. Agents must not infer approval from a plan, a lead's summary or a previous approval for a different environment or phase.
