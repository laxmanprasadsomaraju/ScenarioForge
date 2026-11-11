# Manifest variants (reference)

Status: **Code complete, automated tests passed. NOTHING DEPLOYED, NOTHING COMMITTED TO.** Prepared 2026-11-11 on `release/manifest-variants` from `release/judged-full` @ `054195d`. The root `manifest.yml` is unchanged. Variants live in `manifests/*.yml`, are read by no script or deploy path, and are checked by `test/manifestVariants.test.ts`.

To try one locally: copy it over `manifest.yml` in a scratch directory (never commit it over the root), `forge lint` there.

## Irreversible commitments (entity names): NOT COMMITTED

Entity names and attribute names/types are permanent once deployed to any environment. No variant has been deployed. Candidate names, all with the same two attributes (`version: integer`, `payload: string`), no custom indexes:

| Entity name         | Needed by                                        | In variant     |
| ------------------- | ------------------------------------------------ | -------------- |
| `rehearsal-history` | history, Crisis Room save, remediation records   | all three      |
| `ai-governance`     | AI ledger, settings, cache (Rovo actions only)   | judged only    |
| `crisis-room`       | Crisis Room events (needs `SF_CRISIS`)           | m7-test only   |
| `remediation-item`  | nothing: records are keys in `rehearsal-history` | none (removed) |

`ai-governance` and `rehearsal-history` are already on `rovo-test` (earlier build). Deploying any variant to `rovo-test` therefore commits nothing new there. `crisis-room` would be new.

## Variant tables

|                 | m7-test                                                                                        | m8-write-test                                        | judged-release                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| File            | `manifests/m7-test.yml`                                                                        | `manifests/m8-write-test.yml`                        | `manifests/judged-release.yml`                                                       |
| Environment     | an existing test env or a new one                                                              | its own new env (e.g. `write-test`)                  | decided later                                                                        |
| Scopes          | `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`, `storage:app` | same five + `write:jira-work`                        | the five                                                                             |
| Entities        | `rehearsal-history`, `crisis-room`                                                             | `rehearsal-history`                                  | `ai-governance`, `rehearsal-history`                                                 |
| Modules         | `global:fullPage` + `resolver` function                                                        | same                                                 | root modules: page, 2 Rovo agents, MCP, 4 actions, 5 functions                       |
| Resources       | `main`                                                                                         | `main`                                               | `main`, `agent-prompts`                                                              |
| Flags to set    | `SF_STORAGE=enabled`, `SF_CRISIS=enabled`                                                      | `SF_STORAGE=enabled`, `SF_REMEDIATION_WRITE=enabled` | `SF_STORAGE=enabled`; `SF_AI=enabled` and `SF_USER_DAILY_CAP` only by owner decision |
| Must stay unset | `SF_AI`, `SF_TWG`, `SF_REMEDIATION_WRITE`, `SF_USER_DAILY_CAP`                                 | `SF_AI`, `SF_CRISIS`, `SF_TWG`, `SF_USER_DAILY_CAP`  | `SF_CRISIS`, `SF_TWG`, `SF_REMEDIATION_WRITE`                                        |

Diff vs root manifest (comments aside):

- **m7-test**: removes `rovo:agent`, `rovo:mcp`, `action`, 4 `fn-*` functions, `agent-prompts` resource, entities `ai-governance` and `remediation-item`.
- **m8-write-test**: m7-test minus entity `crisis-room`, plus scope `write:jira-work`.
- **judged-release**: removes entities `crisis-room` and `remediation-item`; everything else identical.

### Justification from code

- `ai-governance` is reached only through `usageGovernor`/`responseCache` in `src/agents/forge.ts` (a test asserts this is the only user outside `storageFactory.ts` and `src/probes`). Without Rovo functions in the manifest nothing builds a governor, so m7 and m8 omit Rovo and the entity. The judged build keeps Rovo, so it needs the entity; with `SF_STORAGE` set the factories touch it even when `SF_AI` is unset.
- `crisis-room`: `crisisStorage()` returns null unless `SF_CRISIS=enabled`; then it uses entity `crisis-room`. The judged variant omits it, so **setting `SF_CRISIS` there makes crisis calls fail at runtime** (the resolver is guarded and answers an error, nothing else breaks). Keep it unset.
- `remediation-item`: `remediationStorage()` calls `entityStorage(HISTORY_ENTITY)`; `remediation-item:` is only a key prefix (`src/remediation/create.ts`). The entity is unused, so it is removed everywhere. Disjointness from history keys is tested in `test/historyRemediationIsolation.test.ts`.
- `write:jira-work`: the only mutating calls are in `src/remediation/forgeWrite.ts` (POST `/rest/api/3/issue`, `/issueLink`, `/issue/{key}/remotelink`). Reads in the same flow (`prepareRemediationRequest`, `checkRemediationApproval`) use the existing Jira and Confluence read scopes, so m8 keeps the read set. Confluence write is not used.
- `storage:app` is needed by every variant that declares an entity (Forge KVS, D17). Without it history is unavailable; the app still runs with `SF_STORAGE` unset.
- `SF_TWG` needs graph scopes that no variant has; it stays unset (`getReadinessGraph` then makes no graph call).

## Verification run (2026-11-11)

- `test/manifestVariants.test.ts` (20 tests): parses each variant; real factories (`historyStorage`, `crisisStorage`, `remediationStorage`, `governanceStorage`) with a recording client prove the entities reachable under the variant's flags equal the declared set, so none is missing or unused; `*_ENTITY` constants are all root-declared and no entity name appears as a literal elsewhere; `write:jira-work` only in m8; app id and entity shape equal the root's.
- `forge lint` on each variant copied as `manifest.yml` into a scratch directory with a stub `static/app/build`: **0 errors, 0 warnings, 1 approval** (`MAJOR_VERSION_RULE`: the scope change triggers a major version upgrade in the default environment, so deploying a variant to an environment that already has an install asks admins to consent). The root manifest lints with the same approval note.

## App id and environments (read-only, 2026-11-11)

`app.id` is `ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355` in the root and all variants (one app, many environments).

| Environment                     | Last deployed (UTC)  | Install           | Variables                                                         |
| ------------------------------- | -------------------- | ----------------- | ----------------------------------------------------------------- |
| development                     | 2026-11-09T23:07:09Z | Jira              | none                                                              |
| confluence-test                 | 2026-11-11T15:41:53Z | Jira + Confluence | none                                                              |
| rovo-test                       | 2026-11-11T16:52:12Z | Jira + Confluence | `SF_ROVO_TEST_STORAGE=enabled`, `SF_ROVO_TEST_USER_DAILY_CAP=300` |
| graph-test, staging, production | n/a                  | none              | not checked                                                       |

No environment holds another environment's flags. The only variables are the two `SF_ROVO_TEST_*` names on rovo-test. **This code reads neither name** (a test asserts no `SF_ROVO_TEST` string exists in `src`/`shared`): a deploy of this code to rovo-test would leave storage and the cap at their defaults (storage off, cap 50) until `SF_STORAGE` and, if wanted, `SF_USER_DAILY_CAP` are set and the old names are unset. `docs/ENVIRONMENTS.md` is stale on rovo-test (it now shows Confluence installed and a later deploy time); not edited here.

## Approvals each later step would need (owner's own words, recorded in AGENT_HANDOFF)

1. Deploy a variant to an existing environment: approval for that environment and variant, plus acceptance of the major-version consent prompt and, for any `crisis-room` deploy, the permanent entity name.
2. m8 write-test: separate approval to create the environment, to install it, to set `SF_STORAGE` and `SF_REMEDIATION_WRITE`, and to add `write:jira-work` (new scope), and approval for any real Jira write. CLAUDE.md currently forbids all of these.
3. Judged release: approval to set `SF_STORAGE`; separate approval for `SF_AI=enabled` (paid Rovo usage); production/staging deploy; removal of the stale `SF_ROVO_TEST_*` variables on rovo-test.

## Uncertain

- Whether the `rovo:agent` modules require `ai-governance` at install time: not needed by Forge itself; only the code path needs it (verified by code, not by a deploy).
- Whether deploying a smaller entity set than already present on rovo-test (m7/m8 drop `ai-governance`) is allowed or treated as removal: not tested, treat as an irreversible-commitment question before deploying either to rovo-test.
- `forge lint` does not validate entity reachability; that is covered only by the test.
