# Unified test environment (approval proposal)

Status: **proposal only. Nothing created, deployed, installed or set.** Prepared 2026-11-12 on `docs/unified-test-env` from `e70de12`; **re-checked 2026-11-12 on `release/unified` @ `4e216a7`** (adds the Session ID History row and the explain-outcome routing fix) by the `verify/unified` lane. Manifest, flags, entities, scopes and code claims below were read from `4e216a7`. If `release/unified` moves, re-check again before approval.

Goal: one new, isolated environment (suggested name **`unified-test`**) running the redesigned UI and every feature of `release/unified`, so the owner can test it without touching `development`, `confluence-test` or `rovo-test`.

## (a) Manifest to deploy

Use a **variant file**, not the unmodified root `manifest.yml`. Reasons (still true at `4e216a7`):

- The root declares four entities. `remediation-item` is unused (`remediationStorage()` uses `rehearsal-history`; `remediation-item:` is only a key prefix, per `src/platform/storageFactory.ts` and [MANIFEST_VARIANTS](MANIFEST_VARIANTS.md)). Entity names are permanent, so it must not ship.
- `manifests/judged-release.yml` is the closest existing variant but has no `crisis-room`, so a Crisis Room test would fail at runtime (the resolver answers an error; nothing else breaks). It is also **stale against `4e216a7`**: it still carries the old facilitator conversation starter ("Explain the outcome of my rehearsal") and the old action descriptions, so deploying it would lose the explain-outcome routing fix. Do not use it as is.

Proposed file `manifests/unified-test.yml` (not yet written; to be made from the `4e216a7` root manifest, not from `judged-release.yml`, and its contents approved by the owner): root minus `remediation-item`, minus `rovo:mcp`. It is deployed by copying it over `manifest.yml` in a throwaway branch or scratch directory. It is never merged over the root and never committed to a branch that deploys elsewhere.

| Item        | Value                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App id      | `ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355` (same app, new environment)                                                                                                                     |
| Runtime     | `nodejs24.x`, 256 MB, arm64 (unchanged)                                                                                                                                                                         |
| Modules     | `global:fullPage` (`scenarioforge-global-full-page`) and `resolver`; `rovo:agent` x2 (`recovery-investigator`, `exercise-facilitator`); `action` x4 (all `GET`); 5 functions; resources `main`, `agent-prompts` |
| `rovo:mcp`  | **Out** of the first deploy (see below)                                                                                                                                                                         |
| Entities    | `ai-governance`, `rehearsal-history`, `crisis-room` (each `version: integer`, `payload: string`, no indexes). Remediation approval and audit records are keys in `rehearsal-history`.                           |
| Write scope | **None.** No `write:*` and no `read:graph:*` scope. A test asserts the manifest, and `src/remediation/gateways.ts` states Jira would refuse any write.                                                          |

Scopes (five, all already in the root, so no new scope anywhere):

| Scope                  | Why                                                                               |
| ---------------------- | --------------------------------------------------------------------------------- |
| `read:jira-work`       | Search issues and read the change (summary, status, type, updated)                |
| `read:jira-user`       | The calling user's own profile for the connection check                           |
| `search:confluence`    | CQL search for recovery runbooks (titles and links)                               |
| `read:page:confluence` | Read one runbook body (`GET /wiki/api/v2/pages/{id}`; no classic scope covers it) |
| `storage:app`          | Forge KVS for the three entities (required by `@forge/kvs`, D17)                  |

`content.styles: unsafe-inline` (Atlaskit style tags) is unchanged. `forge lint` gave 0 errors, 0 warnings, 1 approval (`MAJOR_VERSION_RULE`) on the variants (2026-11-11) and on the `4e216a7` root (2026-11-12); re-run on the final file (read-only).

**MCP recommendation: keep it out.** It adds an external-exposure surface that stays off until a site or org admin enables it ([M9_MCP_RUNBOOK](../M9_MCP_RUNBOOK.md)). Nothing in the in-app or Rovo-agent tests needs it, and adding a module later is a normal deploy. Test it in a later, separately approved step.

## (b) Variables (set by the app developer; site users cannot set them)

| Variable               | In `unified-test`                              | Turns on                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SF_STORAGE=enabled`   | **Set**                                        | All KVS factories (history, remediation records, governance, crisis). Unset: no history, no Crisis Room, no cache; the app still runs. This code does **not** read the old `SF_ROVO_TEST_STORAGE`.                  |
| `SF_CRISIS=enabled`    | **Set** (only if `crisis-room` ships)          | Crisis Room event log in `crisis-room`. Needs `SF_STORAGE`.                                                                                                                                                         |
| `SF_AI`                | **Unset at first**; exact value `enabled` only | Site AI opt-in so Rovo actions may reach the governor. Unset: every action is denied (USAGE_LIMITED/DISABLED) and nothing is spent. Setting it is paid Rovo usage and needs its **own** owner approval (CLAUDE.md). |
| `SF_USER_DAILY_CAP`    | **Unset**                                      | Per-user daily AI cap, integer 50 to 300, otherwise 50. Matters only once `SF_AI` is on; set it in the same later approval (300 was used on rovo-test).                                                             |
| `SF_TWG`               | **Unset**                                      | Teamwork Graph reads. The manifest has no `read:graph:*` scope, so it cannot work.                                                                                                                                  |
| `SF_REMEDIATION_WRITE` | **Unset**                                      | Builds the Jira write gateway. There is no `write:jira-work` scope, so it could not write anyway; unset makes the create path answer WRITE_NOT_PERMITTED. Remediation stays preview-only.                           |

Rovo tests that need AI (Tests 3, 4, 9 to 12) cannot run with AI off. They are numbered rows 3, 4 (Block B, Investigator) and 9 to 12 (Block C, Facilitator) in `docs/M6_PHASE2_TEST_SCRIPT.md` (present on `4e216a7`). **That script still names the old variables `SF_ROVO_TEST_AI` / `SF_ROVO_TEST_STORAGE`; this code reads `SF_AI` / `SF_STORAGE`, so substitute them when following it.** Plan: phase 1 (AI off) covers everything else plus Block A (AI-off behaviour). Phase 2 sets `SF_AI=enabled` (and the cap) only after a separate written approval, and unsets it afterwards.

## (c) Forge commands the owner would approve (in order)

Node 24, from a worktree whose `manifest.yml` is the approved variant. Options checked read-only with `forge <command> --help` on 2026-11-12.

1. `forge environments create -e unified-test`. CLI text: "create a new development environment". Adds an empty DEVELOPMENT environment record to this app. Touches no other environment.
2. `forge lint -e unified-test`. Read-only check before deploying.
3. `forge deploy -e unified-test`. Uploads the build to `unified-test` only. **This is the step that makes the entity names permanent.** Do not use `-f/--no-verify` or `--approve`.
4. `forge install -e unified-test -p Jira -s one-atlas-cegq.atlassian.net`, then the same with `-p Confluence`. The CLI shows the scope list and asks for confirmation; do not pass `--confirm-scopes`. Installs on the demo site only.
5. `forge variables set -e unified-test SF_STORAGE enabled`, then `forge variables set -e unified-test SF_CRISIS enabled`. Each applies to that environment only. Whether running functions see a new value without a redeploy or `forge install --upgrade` is unverified; confirm by a test read after setting.
6. Read-only checks: `forge environments list`, `forge install list`, `forge variables list -e unified-test`.

Not run: any command with `-e rovo-test`, `-e confluence-test`, `-e development`, `-e staging` or `-e production`; `forge variables unset`; Marketplace commands.

Coexistence and limits: the same app id is already installed on `one-atlas-cegq.atlassian.net` in three environments (`development` on Jira; `confluence-test` and `rovo-test` on Jira and Confluence, per `forge install list` on 2026-11-12), each with its own storage. A fourth installation is the same pattern. Observed now: six environments (four development-type, staging, production). Any per-app or per-site limit on environments or installations is **unverified**; the CLI help does not show one, so check the developer console or Atlassian docs before step 1. The demo site's reported expiry (2027-02-07) ends the test bed.

## (d) Consent and re-consent

- Installing needs a **site admin** of the demo site (a Confluence admin for the Confluence install). The consent screen lists the five scopes above and nothing else; no write access.
- A new environment has no earlier version, so existing installs are not prompted. `rovo-test`, `confluence-test` and `development` are untouched.
- A later deploy to `unified-test` that adds a scope, or triggers `MAJOR_VERSION_RULE`, makes admins approve an upgrade. This proposal adds none after the first deploy. Setting variables needs no consent.

## (e) Permissions and data

- Storage is new and empty: the owner's saved rehearsal on `rovo-test` will **not** appear, because KVS data is per environment.
- Users see only their own history (explain-outcome reads the user's own audit-verified run). Users need Jira browse access to the change and view access to the Confluence runbook, as in earlier tests.
- Test data is created by the owner by hand (Claude makes no Jira or Confluence writes). Reuse the existing SFDEMO runbook pages and `MC-*` change issues on the same site; injection fixtures are in `docs/M6_PHASE2_TEST_SCRIPT.md` section 1. Run a few rehearsals in the app to create history. Demo data stays labelled synthetic.

## (f) Permanent commitments

| Commitment                                                       | Permanent? | Note                                                                                                                                              |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity `rehearsal-history` (`version`, `payload`)                | **YES**    | Already on `rovo-test`; new here                                                                                                                  |
| Entity `ai-governance` (`version`, `payload`)                    | **YES**    | Already on `rovo-test`                                                                                                                            |
| Entity `crisis-room` (`version`, `payload`)                      | **YES**    | New name anywhere. **Option B: omit it** from the first deploy, add it by a later redeploy, leave `SF_CRISIS` unset and skip the Crisis Room test |
| Environment name `unified-test`                                  | Probably   | Whether an environment can be deleted is unverified                                                                                               |
| Not committed: `remediation-item`, `rovo:mcp`, `write:jira-work` | n/a        | Excluded                                                                                                                                          |

Recommendation: Option A (include `crisis-room`) only if the owner wants the two-user Crisis Room test now. Otherwise Option B: the first deploy then commits nothing beyond what `rovo-test` already holds.

## (g) Test plan

| Feature                       | Steps                                                                                                   | Expected                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Readiness                     | Open the app, pick an `MC-*` change                                                                     | Findings Confirmed/Suspected/Not assessed, quoted evidence, impact path             |
| Simulations and report        | Run a rehearsal on a real finding; open the report                                                      | Simulated clock; report labelled simulated                                          |
| History and Session ID        | Complete a run; open History                                                                            | Run listed with a Session ID row (release/unified); survives reload                 |
| Fixes and retests             | Preview a remediation request; run the targeted retest                                                  | Verdict resolved / still failing / inconclusive; preview only, nothing written      |
| Rovo agents, AI off (phase 1) | Block A of the Phase 2 test script                                                                      | Actions deny cleanly; no credits used                                               |
| Rovo agents, AI on (phase 2)  | Tests 3, 4, 9 to 12 after a separate `SF_AI` approval, including explain-outcome with a UUID Session ID | Facilitator explains the user's own stored run; deterministic findings unchanged    |
| Crisis Room (Option A only)   | Two users (owner and a second site user): create room, assign roles, hand off command                   | Both see events from `crisis-room`; opaque participant ids; cross-user reads denied |
| Remediation                   | Preview only                                                                                            | Create answers WRITE_NOT_PERMITTED; no Jira issue appears                           |

Expected to stay "not enabled": remediation write, Teamwork Graph, MCP and, in phase 1, AI. A failed AI call must read "Not assessed", never a pass.

## (h) Rollback

- Behaviour: unsetting a variable (`forge variables unset -e unified-test <name>`, needs approval) reverts that feature, for example `SF_AI` back to off.
- Remove: `forge uninstall -e unified-test -s one-atlas-cegq.atlassian.net -p Jira`, and the same with `-p Confluence`. The environment is then left idle with no installation.
- Stays permanent: the environment record, the deployed entity names and attributes. Whether uninstalling purges stored KVS data is unverified.
- Other environments are unaffected at every step.

## (i) Approval checklist (plain language)

The owner answers yes or no, in their own message, to each:

1. Create a new environment called `unified-test` (or another name).
2. Deploy the approved variant manifest to `unified-test` only, accepting that entity names `rehearsal-history`, `ai-governance` and (Option A) `crisis-room` become permanent.
3. Install it on `one-atlas-cegq.atlassian.net` for Jira and Confluence, with a site admin accepting the five read and storage scopes.
4. Set `SF_STORAGE=enabled` (and `SF_CRISIS=enabled` for Option A) in `unified-test`.
5. Keep `rovo:mcp`, `write:jira-work`, `SF_REMEDIATION_WRITE` and `SF_TWG` out.
6. **Separate, later:** set `SF_AI=enabled` and `SF_USER_DAILY_CAP` (paid Rovo usage), and unset them afterwards.
7. Confirm no change to `rovo-test`, `confluence-test`, `development`, staging or production, and no merge.

## Open unknowns

- Resolved: the Session ID row and explain-outcome fix (`e70de12..4e216a7`) change only manifest description and conversation-starter text; no scope, entity, module or flag change.
- Any Forge limit on environments or installations per app or site; whether an environment can be deleted.
- Whether variable changes take effect without a redeploy or upgrade.
- Whether uninstalling purges KVS data.
- Whether the live Facilitator now routes a History UUID to `explain-outcome` (code complete and automated tests passed only; needs the AI-on phase).
- The test script's variable names are stale (see section b); fix it or substitute at run time.
- Resolved: `rovo-test` last deploy is 2026-11-12T00:05Z (`forge environments list`); `docs/ENVIRONMENTS.md` updated. Its variables were not re-read.
