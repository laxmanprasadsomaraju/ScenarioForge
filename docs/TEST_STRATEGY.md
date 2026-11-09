# Test strategy

## Unit tests (Vitest, `npm test`)

| File                        | Covers                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/simulation.test.ts`   | Scenario validity, every branch, determinism, immutability, invalid decisions, version mismatch, objective progress, late-objective wording         |
| `test/jira.test.ts`         | Issue mapping with complete and missing fields, unusable keys, truncation, HTTP 401/403/404/429/500/503 mapping, malformed bodies, connection check |
| `test/validation.test.ts`   | Payload defaults, enum enforcement, JQL injection attempts, numeric bounds                                                                          |
| `test/issueFilters.test.ts` | Text, status and type filters; date and key sorting; undated issues last                                                                            |

Latest run: **53 tests, 4 files, all passing** (2026-11-09).

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
