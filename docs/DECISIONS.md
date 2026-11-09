# Decisions

## D1. Forge-hosted only, no external backend (2026-11-09)

Forge hosts the UI and functions. No Docker, database or third-party hosting for M0/M1. Keeps Runs on Atlassian eligibility and avoids running costs.

## D2. TypeScript with a shared domain package (2026-11-09)

`shared/` holds the domain model, API contract and simulation engine, imported by the resolver (Forge bundler) and the UI (Vite alias `@shared`). One definition of every entity, tested once.

## D3. Jira calls run `asUser` (2026-11-09)

Permission-safe by default: the app cannot show anything the user could not already browse. `asApp` will be considered only for specific background jobs, documented when introduced.

## D4. The browser never sends JQL (2026-11-09)

The resolver accepts enum values and builds the query, removing JQL injection and over-broad queries.

## D5. Deterministic simulation engine (2026-11-09)

Consequences are authored scenario data; the engine is pure (no clock reads, randomness or AI). AI may later draft scenarios or explain results, but never decides what an action does.

## D6. Unknown is a first-class state (2026-11-09)

`FindingConfidence` includes `unknown`; objectives stay `pending` until the clock passes them. The Overview shows "Not assessed" rather than any score.

## D7. Dependency overrides instead of `npm audit fix --force` (2026-11-09)

The suggested fixes downgraded `@forge/api` to 6.x and `@forge/bridge` to 5.x. Instead we pin patched transitive versions with `overrides` (`glob` ^14.0.4, `minimatch` ^11.0.5, `prosemirror-view` ^1.42.3) and verify with tests, lint and build. Review on every Forge SDK upgrade.

## D8. TypeScript 6.0, React 18.3, Vite 8 (2026-11-09)

TypeScript 7 is not yet supported by typescript-eslint. React 18.3 is the most widely tested Atlaskit peer. Vite 8 replaces the template's Vite 5 (removes the esbuild dev-server advisory and the CJS warning).

## D9. Hallmark custom design route, app-screen scope (2026-11-09)

Design follows Hallmark's floor and app-screen rules with an idea of our own (the incident clock) rather than a dealt theme. Host ADS tokens for ground, ink and status colours so the app matches Jira in light and dark; one forge-copper accent. See DESIGN.md.

## D10. In-app navigation synced with Forge history (2026-11-09)

Eight destinations in a sidebar (collapses to a menu under 60rem). The current screen lives in Jira's URL via `view.createHistory()`.

## D11. Dev-only preview fixtures (2026-11-09)

`@forge/bridge` throws on import outside Jira, so local visual review uses a bridge stub (only for `vite serve` with `SF_PREVIEW=1`) and fixture data (only when `import.meta.env.DEV`). A banner marks the preview, and CI fails if fixtures reach the production bundle.

## D12. Repo-local Git identity (2026-11-09)

The machine's global Git identity is an employer account. This repo uses a local identity with the personal GitHub no-reply email.

## D13. Four development lanes with worktree isolation (2026-11-09)

Lane A (integrations, owns `manifest.yml` and root package files), Lane B (UI, owns `static/app` package files), Lane C (simulation engine, pure modules in `shared/simulation`), Lane D (bonus research). Each lane ran as a separate agent in its own git worktree and branch; only the lead merges, through `integration/lanes-1`, and only the lead deploys. Shared contracts in `shared/domain/types.ts` are owned by the lead.

## D14. Confluence scopes held from deployment (2026-11-09)

Lane A's Confluence code is merged but not deployed. The scopes make a major version requiring admin re-approval and per-user consent, and the demo site's Confluence availability and the Jira-to-Confluence compatibility declaration are unverified. The development install stays on the M1 build until the owner approves.

## D15. Retest verdicts are rule-based and conservative (2026-11-09)

A gap is `resolved` only if the retest actually followed the procedure that had the gap, that step was effective, and the tied objectives were met. A retest that avoids the procedure is `inconclusive`, even with every objective met. The UI shows the procedure's assessment before and after, not just objectives, because an objective can be met in both runs.

## D16. Contract-change proposals pending (2026-11-09)

Proposed by lanes, not yet applied to `shared/domain/types.ts`: `remediatedFrom` on scenarios and `scenarioFingerprint` / `appliedRemediationIds` on sessions (Lane C, needed for M5 persistence); an optional `path` on `EvidenceReference` and confidence on `RecoveryStep.dependsOn` (Lane A); `'teamwork-graph'` as an evidence kind (Lane D). To be decided when M5 persistence starts, with tests.
