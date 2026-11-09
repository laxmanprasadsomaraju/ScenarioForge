# Test strategy

## Unit tests (Vitest, `npm test`)

| File                        | Covers                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/simulation.test.ts`   | Scenario validity, every branch, determinism, immutability, invalid decisions, version mismatch, objective progress, late-objective wording         |
| `test/jira.test.ts`         | Issue mapping with complete and missing fields, unusable keys, truncation, HTTP 401/403/404/429/500/503 mapping, malformed bodies, connection check |
| `test/validation.test.ts`   | Payload defaults, enum enforcement, JQL injection attempts, numeric bounds                                                                          |
| `test/issueFilters.test.ts` | Text, status and type filters; date and key sorting; undated issues last                                                                            |

Latest run: **194 root tests in 8 files, plus 19 component tests in 3 files, all passing** (2026-11-09, integration branch).

Added since M1: `test/confluence.test.ts` (Lane A: CQL building, HTML stripping, step extraction, HTTP error mapping), `test/retest.test.ts`, `test/replay.test.ts` and `test/scoring.test.ts` (Lane C: remediation variants, retest rules, audit tamper detection).

## Component tests (Vitest + Testing Library, `npm test --prefix static/app`)

`static/app/test/` mocks `@forge/bridge` and the API layer. It covers error/empty/filtered states on Changes, origin labels, Jira links, rehearsal focus management and announcements, planned screens, Settings honesty when the connection fails, and the full **fix → retest** loop with resolved, still-failing and inconclusive verdicts.

## Static checks

`npm run typecheck`, `npm run frontend:typecheck`, `npm run lint` (ESLint with typescript-eslint and react-hooks), `forge lint`.

## Visual and accessibility review (local preview)

Done with Hallmark's `sloplint` (static and render tiers) plus a puppeteer-core script against the dev preview at 1440, 820 and 375 px:

- All screens and states: loading, empty, filtered-empty, error, full, planned.
- No horizontal overflow at any width.
- Keyboard focus visible (2px outline) and the tab order starts at the navigation.
- `prefers-reduced-motion` stops the skeleton animation.
- No uncaught page errors.

## Security checks

- CI fails when the production bundle contains preview fixtures.
- CI runs `npm audit --audit-level=high` for backend and frontend.
- Secret scan before each commit (`ATATT`, GitHub tokens, private keys).

## Not yet covered

- **In-Jira end-to-end.** Needs a signed-in session. Planned for M10 as Playwright with a stored auth state on the demo site, kept out of CI secrets until a safe approach exists.
- Component tests with React Testing Library (planned with M5, when the rehearsal UI gains persistence).
- Automated contrast measurement inside Jira's dark theme.
