# Data handling and security self-assessment (DRAFT, for owner review)

These draft answers are based on the code on `integration/lanes-1` (`manifest.yml`, `src/`). Re-verify them against the exact build that is submitted. The Privacy & Security tab must be complete, or review is blocked.

## Scopes and justification

| Scope                  | Why                                                                                                 | Code                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `read:jira-work`       | Search the user's recent changes and read the fields of one issue (and the Affected services field) | `src/jira/client.ts`, `src/jira/affectedServices.ts` |
| `read:jira-user`       | `GET /rest/api/3/myself` for the connection check; nothing is stored                                | `src/index.ts` (`myself`)                            |
| `search:confluence`    | CQL search for recovery runbook pages (titles and links)                                            | `src/confluence/client.ts`                           |
| `read:page:confluence` | Read one runbook page body (`/wiki/api/v2/pages/{id}`)                                              | `src/confluence/client.ts`                           |

- There are no write scopes, and no `storage:app` in this build.
- Not requested: Teamwork Graph `read:graph:*` (prepared only, see M9_TWG_RUNBOOK.md on `m9/twg`) and `rovo:*` modules (on `rovo-test/*` only).

## Questionnaire answers (draft)

| Question                                            | Answer                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the app store End User Data outside Atlassian? | No. There is no egress (`permissions.external` is absent) and no remote.                                                                                                |
| Does the app store End User Data at all?            | Not in this build. It has no storage scope, and processing is per request and in memory.                                                                                |
| Remote hosts and data sent                          | None.                                                                                                                                                                   |
| Authentication to Atlassian APIs                    | Forge `api.asUser()` only. There is no Basic auth, no API tokens and no `asApp` product calls.                                                                          |
| Does the app use AI / LLM?                          | No. Findings come from the deterministic engine (`shared/analysis`). Rovo agents exist only on `rovo-test/*` branches and are not in this build.                        |
| Logging of personal data                            | No. The code logs only counts and codes (for example, `src/graph/getReadinessGraph.ts` logs a problem count). Rule: never log account ids, emails or names (CLAUDE.md). |
| Input validation                                    | Resolver payloads are validated (`src/validation.ts`). The browser sends issue keys and enums, never URLs, ARIs or queries.                                             |
| Content Security Policy                             | Default Forge CSP, with `styles: unsafe-inline` for Atlaskit runtime styles only. No external scripts.                                                                  |
| Data residency                                      | All data stays on Atlassian Forge infrastructure. "Runs on Atlassian" is likely; confirm with `forge eligibility` (owner).                                              |
| Personal data reporting / erasure                   | Not applicable, because no personal data is stored. Revisit if storage ships.                                                                                           |
| Encryption                                          | Provided by the Forge platform, in transit and at rest. The app adds nothing.                                                                                           |
| Vulnerability management                            | `npm audit` before each release; dependencies pinned via `package-lock.json`. [Owner: run and record the results before submission.]                                    |
| Incident contact                                    | [OWNER SECURITY CONTACT EMAIL]                                                                                                                                          |
| Third-party sub-processors                          | None besides Atlassian.                                                                                                                                                 |

## Before submission (owner)

- Run `forge eligibility` and record the result.
- Run `npm audit --omit=dev` and fix any critical or high findings.
- Fill in the bracketed contacts.
- If storage or Rovo ships in the listed build, update the scopes table, the storage answer, the AI answer and the privacy policy.
