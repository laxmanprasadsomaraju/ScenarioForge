# Environments

Observed 2026-11-11 (re-read after merging m8/server-approvals and manifest-variants) with read-only `forge environments list`, `forge install list` and `forge variables list -e <env>`. App id `ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355`. Site: `one-atlas-cegq.atlassian.net` (Forge demo site; reported expiry 2027-02-07). No secrets are recorded here.

| Environment       | Type        | Installation id                        | Products          | Version (CLI major / reported) | Last deployed (UTC)  | Source branch                     | Variables                                                                                               |
| ----------------- | ----------- | -------------------------------------- | ----------------- | ------------------------------ | -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `development`     | DEVELOPMENT | `3edeba6c-fe02-4ad8-a48a-4468dc416a08` | Jira              | 2                              | 2026-11-09T23:07:09Z | `feature/m0-m1-foundation` (M1)   | none recorded                                                                                           |
| `confluence-test` | DEVELOPMENT | `99a01e9b-c4c3-4634-94c4-634f521b7087` | Jira + Confluence | 2 (up-to-date)                 | 2026-11-11T15:41:53Z | not re-read (check AGENT_HANDOFF) | none                                                                                                    |
| `rovo-test`       | DEVELOPMENT | `64f87111-c12f-4eff-8d69-58f4f8bdc4d9` | Jira + Confluence | 2 (up-to-date)                 | 2026-11-11T16:52:12Z | not re-read (check AGENT_HANDOFF) | `SF_ROVO_TEST_STORAGE=enabled`, `SF_ROVO_TEST_USER_DAILY_CAP=300`; `SF_ROVO_TEST_AI` **unset** (AI off) |
| `graph-test`      | DEVELOPMENT | none (not installed)                   | none              | n/a                            | 2026-11-10T10:45:15Z | probe branch (see M4_PERMISSIONS) | not checked                                                                                             |
| `staging`         | STAGING     | none                                   | none              | n/a                            | 2026-11-09T22:39:53Z | template registration             | not checked                                                                                             |
| `production`      | PRODUCTION  | none                                   | none              | n/a                            | 2026-11-09T22:39:53Z | template registration             | not checked                                                                                             |

## What each is for

- **development**: the original M1 build (Jira, two read scopes). Untouched since 2026-11-09 to avoid a major-version consent prompt.
- **confluence-test**: main integration test bed. Scopes `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`. No `storage:app`, no Rovo modules. Live tests M2–M5 ran here; UI redesign deployed here.
- **rovo-test**: the only place with `storage:app`, the `ai-governance` and `rehearsal-history` entities, and Rovo modules (Phase 2: agents `recovery-investigator`, `exercise-facilitator`; actions `find-recovery-risks`, `get-service-readiness`, `prepare-rehearsal`, `explain-outcome`, all `GET`). Installed on Jira and Confluence (as of 2026-11-11 `forge install list`). Same four scopes plus `storage:app`. Variables in the table above were last read before the 2026-11-11T16:52Z deploy and are not re-checked here. Runbook: `docs/M6_ROVO_TEST_RUNBOOK.md` on `rovo-test/phase2`.
- **graph-test**: reserved for the Teamwork Graph probe (`read:graph:*`), needs owner approval and org admin before install ([M4_PERMISSIONS.md](M4_PERMISSIONS.md)).
- **staging / production**: not used. Production deploy needs owner approval (M10).

- **Manifest variants** (`manifests/*.yml`, see [proposals/MANIFEST_VARIANTS.md](proposals/MANIFEST_VARIANTS.md)) are files only: none is deployed, and the root `manifest.yml` is unchanged.

## Rules

- Deploys, installs, upgrades and variable changes on any environment need owner approval; read-only CLI commands do not.
- `rovo-test/*` content (storage entities are permanent once deployed) must never reach `development`, `confluence-test` or production without approval.
- Record every deploy here (date, SHA, version) and in [AGENT_HANDOFF.md](AGENT_HANDOFF.md).
