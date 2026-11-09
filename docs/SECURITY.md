# Security and dependency audit

## Dependency audit (2026-11-09)

The template install reported 10 vulnerabilities (4 moderate, 6 high), from:

| Advisory                       | Package                   | Path                                                      | Resolution                                   |
| ------------------------------ | ------------------------- | --------------------------------------------------------- | -------------------------------------------- |
| GHSA-67mh-4wv8-2f99 (moderate) | esbuild ≤0.24.2           | Vite 5 dev server                                         | Upgraded to Vite 8                           |
| GHSA-c8x8-7fp4-3x9w (high)     | prosemirror-view <1.42.3  | @forge/bridge → @atlaskit/adf-schema → editor-prosemirror | Override `prosemirror-view` ^1.42.3 (1.42.9) |
| GHSA-g3hv-75wg-m249 (moderate) | minimatch 7.0.0 to 11.0.0 | @forge/manifest, eslint, typescript-eslint                | Override `minimatch` ^11.0.5                 |
| GHSA-3g3m-2fjr-6pw4 (moderate) | glob 9.0.0 to 14.0.1      | @forge/manifest                                           | Override `glob` ^14.0.4                      |

`npm audit fix --force` was rejected: it would have downgraded `@forge/api` to 6.1.1 and `@forge/bridge` to 5.5.0.

**Result:** `npm audit` reports **0 vulnerabilities** for both the root and `static/app`. Lint, tests, build and Forge deploy all pass with the overrides.

Notes:

- `prosemirror-view` is not used by our UI at runtime (no rich-text editor); it arrives through the bridge's document schema.
- The template's deprecated `@atlaskit/theme` is gone (React 18 and current Atlaskit packages replace it).
- The frontend bundle is about 670 kB minified (190 kB gzip), mostly Atlaskit and the bridge. Code-splitting is planned for M10.

## Application security

See [ARCHITECTURE.md](ARCHITECTURE.md#security-model). In short: two read-only scopes, all Jira calls as the user, no client-built JQL, typed errors instead of fabricated data, no storage, and no external egress.

## Credentials

- No credentials are stored in the repository. `.gitignore` excludes `.env*`, keys, `.npmrc` and `.forge/`.
- Forge CLI credentials live in the OS keychain via `forge login`.
- An Atlassian API token was exposed in a chat transcript on 2026-11-09; the owner must revoke it.
