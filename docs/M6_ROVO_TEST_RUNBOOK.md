# M6 `rovo-test` runbook (phase 1: identity and storage probes)

Prepared 2026-11-10 (Lane A4). Status: **prepared only.** Nothing in this document has been run except `forge lint` (§2). No deploy, install, variable, uninstall or Atlassian change has been made. Each command block below is run by the owner (or the lead with the owner's go-ahead), in order, and only after the approvals in [M6_DEPLOYMENT_READINESS.md §6](M6_DEPLOYMENT_READINESS.md) items 1–5.

## 0. Branch README: `rovo-test/build`

- This branch exists **only to build the `rovo-test` environment**. It adds `storage:app`, the `ai-governance` and `rehearsal-history` entities, and a test-only `identity-probe` agent with two actions.
- **It must never be merged into a branch that deploys to `development` or `confluence-test` (or into `main`) without the owner's explicit approval.** Lint shows both would take a major version ("Change due to scope modification", §2), and the entities would become permanent there.
- Code paths are inert outside `rovo-test`: every storage factory returns `null` unless the Forge variable `SF_ROVO_TEST_STORAGE` is exactly `enabled`, and that variable is only ever set with `-e rovo-test`.
- The probe agent, its two actions and `src/probes/**` are removed in the next `rovo-test` deploy (phase 2).
- Base: `integration/lanes-1` @ `b728437` + `origin/lane-a2-forge-storage` @ `09d555b` (merged; current manifest kept as the base).

| Piece               | Where                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage adapter     | `src/ai/forgeStorage.ts` (`ForgeEntityStorage`, entities `ai-governance`, `rehearsal-history`)                                               |
| Wiring (flag-gated) | `src/platform/storageFactory.ts`: `governanceStorage`, `historyStorage`, `usageGovernor`, `responseCache`, `historyStore`, `perUserDailyCap` |
| Probes              | `src/probes/whoamiProbe.ts`, `src/probes/storageProbe.ts`, Forge entry `src/probes/forge.ts`, exported from `src/index.ts`                   |
| Tests               | `test/probes.test.ts`, `test/storageFactory.test.ts`, `test/forgeStorage.test.ts`                                                            |

## 1. Forge variables used (documented, NOT set)

| Variable                      | Value on `rovo-test` | Effect                                                                                                                                                    | Other environments          |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `SF_ROVO_TEST_STORAGE`        | `enabled`            | Switches the storage factories on. Anything else, or absent: every factory returns `null`; `storage-probe` returns `storage-disabled` and touches nothing | Never set                   |
| `SF_ROVO_TEST_USER_DAILY_CAP` | `300`                | Per-user daily governor cap. Accepts a plain integer 50..300 only; anything else or absent gives the code default 50                                      | Never set (code default 50) |

`forge variables set [options] [key] [value]` with `-e, --environment` and `--encrypt` (CLI 15.1.0 `--help`). Variables take effect only after a `forge deploy` ([variables set](https://developer.atlassian.com/platform/forge/cli-reference/variables-set/), cited in readiness §5.2). Neither value is secret, so no `--encrypt`.

```sh
# Run ONLY at step 4.2, with the owner's go-ahead. Not run by Lane A4.
forge variables set -e rovo-test SF_ROVO_TEST_STORAGE enabled
forge variables set -e rovo-test SF_ROVO_TEST_USER_DAILY_CAP 300
forge variables list -e rovo-test     # expect exactly these two keys
```

## 2. `forge lint` on this branch (run 2026-11-10, CLI 15.1.0, Node 24.22.2)

| Command                         | Output                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forge lint -e rovo-test`       | `No issues found.`                                                                                                                                                        |
| `forge lint -e development`     | `approval This deployment triggers a major version upgrade in the default environment because: Change due to scope modification  MAJOR_VERSION_RULE` (1 approval)         |
| `forge lint -e confluence-test` | `approval This deployment triggers a major version upgrade in the confluence-test environment because: Change due to scope modification  MAJOR_VERSION_RULE` (1 approval) |

The two approvals are the reason this branch is never deployed to those environments. Lint asked for no scope for the `rovo:agent` / `action` modules.

## 3. Pre-checks (no Atlassian change)

Run from a clean checkout of `rovo-test/build`.

```sh
source ~/.nvm/nvm.sh && nvm use 24            # node -v → v24.x
forge --version                               # ≥ 15.1.0
forge whoami                                  # must be the owner's developer account
forge settings list                           # note the default env; never rely on it
forge environments list                       # rovo-test exists
forge install list > /tmp/sf-install-before.txt
forge deploy list -e development     > /tmp/sf-deploy-development-before.txt
forge deploy list -e confluence-test > /tmp/sf-deploy-confluence-test-before.txt
git rev-parse HEAD                            # record the build SHA
npm ci && npm ci --prefix static/app
npm run typecheck && npm run lint && npm test && npm test --prefix static/app
npm run frontend:build && npx prettier --check .
npm audit --audit-level=high && npm audit --audit-level=high --prefix static/app
forge lint -e rovo-test                       # must print "No issues found." — any MAJOR_VERSION_RULE: STOP
```

Expected `before` install list: `development` and `confluence-test` rows on `one-atlas-cegq.atlassian.net`; **no** `rovo-test` row. If a `rovo-test` row already exists, stop and ask the lead.

**Extra usage confirmation (owner, browser, before any chat message):**

1. admin.atlassian.com → **Billing and subscriptions** → **Rovo credits** → **Update extra usage limit** ([Manage extra usage for a meter](https://support.atlassian.com/subscriptions-and-billing/docs/manage-extra-usage-for-a-meter/), as cited in readiness §5.3).
2. Confirm extra usage is **off** (or limit 0). Save if changed. Screenshot.
3. Record current Rovo credit usage (figure + timestamp) for the before/after comparison.
4. Confirm Rovo chat and **Browse agents** are available on `one-atlas-cegq` (SETUP_STATUS still "not checked").

Go only if all four are true.

## 4. Deploy and install (phase 1)

### 4.1 Deploy

```sh
forge deploy -e rovo-test --non-interactive
```

### 4.2 Variables (then redeploy so they take effect)

```sh
forge variables set -e rovo-test SF_ROVO_TEST_STORAGE enabled
forge variables set -e rovo-test SF_ROVO_TEST_USER_DAILY_CAP 300
forge deploy -e rovo-test --non-interactive
```

### 4.3 Install

```sh
forge install --site one-atlas-cegq.atlassian.net --product jira -e rovo-test
#   Review the consent screen: exactly read:jira-work, read:jira-user,
#   search:confluence, read:page:confluence, storage:app.
#   Do NOT pass --confirm-scopes. Any other scope: abort.
forge install list > /tmp/sf-install-after.txt
diff /tmp/sf-install-before.txt /tmp/sf-install-after.txt   # only one added rovo-test row
```

Record the `rovo-test` installation id from `after.txt` (needed for rollback).

### 4.4 Enable the probe agent in Rovo

Steps as cited in readiness §4.2 from the official [Build a Rovo Agent hello world app](https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-agent/) tutorial: Jira → **Chat** (Rovo) → agent selector → **Browse agents** → "ScenarioForge identity probe" → **Enable** (per user). **[Unverified by Lane A4]:** this lane could not re-read the page (tool usage limit); the readiness doc read it on 2026-11-10. No admin-level toggle is documented [Unverified]. Known issue: if Rovo was activated after the install, the agent can be missing until a redeploy ([community 86838](https://community.developer.atlassian.com/t/rovo-agent-missing-after-rovo-activation-deployment-required-to-restore-functionality/86838)) — in that case run `forge deploy -e rovo-test` once and retry.

## 5. Running the probes (≈5 chat messages, ≈50 credits)

Open a monitoring terminal first (§7). Each prompt is typed exactly, once, to the **ScenarioForge identity probe** agent.

| #   | Where                                                                       | Exact prompt             |
| --- | --------------------------------------------------------------------------- | ------------------------ |
| P1  | Rovo chat opened from a Jira issue view (e.g. MC-62)                        | `Run the identity probe` |
| P2  | Rovo chat from Jira home (no issue in context)                              | `Run the identity probe` |
| P3  | Same as P2, as a second user (only if one exists)                           | `Run the identity probe` |
| P4  | Rovo chat from Jira home                                                    | `Run the storage probe`  |
| P5  | Only if P4 returned `storage-disabled` after fixing the variable + redeploy | `Run the storage probe`  |

Do not send any other message to the agent. If the agent answers without calling the action (no log line), rephrase at most once with the conversation starter button.

## 6. Expected outputs and go / no-go

### 6.1 `whoami-probe` (returns `{ accountIdMatch, httpStatus }` only)

| Result                                                 | Log (`forge logs`)                              | Meaning                          | Decision                                                 |
| ------------------------------------------------------ | ----------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| `{"accountIdMatch":true,"httpStatus":200}`             | `accountIdIn: "context"` or `"payload.context"` | Runs as the chatting user        | **GO** (record which location holds `accountId`)         |
| `{"accountIdMatch":false,"httpStatus":200}`            | —                                               | Ran as someone else              | **NO-GO**: ship M6 actions disabled; report to Atlassian |
| `{"accountIdMatch":null,"httpStatus":200}`             | `accountIdIn: "none"`                           | No `accountId` in the invocation | **NO-GO** (per-user caps need it)                        |
| `{"accountIdMatch":null,"httpStatus":401}`             | `threw: "NEEDS_AUTHENTICATION_ERR"`             | No user token in actions         | **NO-GO**; no app-identity fallback, ever                |
| `{"accountIdMatch":null,"httpStatus":null}` or 4xx/5xx | `threw: "<name>"` or `httpStatus` line          | Platform refused                 | **NO-GO**; capture the error name                        |
| `httpStatus` 403/404                                   | —                                               | Consent/scope problem            | Check install consent, rerun once, else NO-GO            |
| No action log line                                     | —                                               | Rovo did not call the action     | Not a result; adjust and rerun once                      |

Logs carry key names, `accountIdIn`, `accountIdMatch`, status and error names only; never an accountId or profile field (unit-tested).

### 6.2 `storage-probe` (returns step results only)

Expected on a working store: `{"probe":"storage","status":"completed","passed":12,"total":12,"allPassed":true,"cleanup":"done","steps":[…]}` with:

| Step | Entity              | Expected `observed`       | Proves                                       |
| ---- | ------------------- | ------------------------- | -------------------------------------------- |
| S1   | `ai-governance`     | `absent`                  | Missing key reads as absent                  |
| S2   | `ai-governance`     | `ok:v1`                   | Create-only first write (`notExists`) works  |
| S3   | `ai-governance`     | `CONFLICT`                | Repeat create detected, not overwritten      |
| S4   | `ai-governance`     | `ok:v2,CONFLICT`          | Version check; stale write refused           |
| S5   | `ai-governance`     | `v2:{"n":2}`              | Failed writes did not apply                  |
| S6   | `ai-governance`     | `DISABLED`                | Governor fails closed before opt-in          |
| S7   | (none)              | `DISABLED,calls:0`        | Kill switch denies without storage access    |
| S8   | (none)              | `threw:ForgeStorageError` | Invalid key refused locally                  |
| S9   | `ai-governance`     | `absent`                  | Delete works                                 |
| H1   | `rehearsal-history` | `ok:v1`                   | Second entity provisioned, create-only works |
| H2   | `rehearsal-history` | `v1:{"n":1}`              | Read-back                                    |
| H3   | `rehearsal-history` | `absent`                  | Delete works                                 |

The probe writes only `probe:<uuid>` keys and deletes them in a `finally` block (`cleanup: "done"`). S6 never reserves on a fresh install; if the site had already opted in, S6 reports `RESERVED(released)` (fail) and releases the reservation (zero units charged). The log line `{"probe":"storage","entity":"ai-governance","op":"conditionalSet","error":{…}}` after S3 records the **real failed-condition error shape** — copy it into `docs/M6_LIVE_TEST.md` and D17.

| Outcome                             | Decision                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `allPassed: true`                   | **GO** for storage                                                                     |
| `status: "storage-disabled"`        | Variable missing/wrong or not redeployed: fix §4.2, redeploy, run P5                   |
| S2 or S3 fails (e.g. `threw:Error`) | **NO-GO**: AI stays off; adapter change (create path / error matching) and rerun S1–S9 |
| S6/S7 fails                         | **NO-GO**: governor wiring wrong; do not enable AI                                     |
| H1–H3 fail                          | History stays off; governance may still proceed                                        |
| `cleanup: "failed"`                 | Note the keys from the log line `keys: [...]`; harmless `probe:` rows; retry once      |

**Overall GO for phase 2** requires 6.1 GO on P1 and P2 and 6.2 `allPassed: true`.

## 7. Monitoring

```sh
forge logs -e rovo-test --since 15m --grouped
forge logs -e rovo-test -f action-whoami-probe --since 15m
forge logs -e rovo-test -f action-storage-probe --since 15m
```

(`-f` is `--functionKey`, not follow; `-g/--grouped` groups by invocation — CLI 15.1.0 `--help`.) After the session, the owner records Rovo credit usage in Atlassian Administration and compares with §3.

## 8. Kill switch (fastest first)

1. **Stop chatting** — chat credits are charged per user message.
2. **Disable storage paths** — `forge variables unset -e rovo-test SF_ROVO_TEST_STORAGE` then `forge deploy -e rovo-test --non-interactive`: all factories return `null`, probe touches nothing.
3. **Code kill switch** — `BudgetPolicy.enabled = false` (reviewed one-line change on this branch), `forge deploy -e rovo-test --non-interactive`.
4. **Uninstall** `rovo-test` (§9).
5. **Org spend** — extra usage stays off / limit 0 (§3).

(No governor opt-in exists in phase 1, so every governed call is already `DISABLED`.)

## 9. Rollback

```sh
forge install list                             # note the rovo-test installation id
forge uninstall -i <rovo-test-installation-id> # id form only; never --batch
forge install list > /tmp/sf-install-rollback.txt
diff /tmp/sf-install-before.txt /tmp/sf-install-rollback.txt   # must be identical
```

Stored `probe:` rows were already deleted; governance ledger/settings never existed (no opt-in). Entity **definitions** stay with the app regardless (readiness §2.1). Data lifecycle after uninstall: readiness §4.6.

## 10. Final check: `development` and `confluence-test` unchanged

```sh
forge install list > /tmp/sf-install-final.txt
diff <(grep -v rovo-test /tmp/sf-install-before.txt) <(grep -v rovo-test /tmp/sf-install-final.txt)   # empty
forge deploy list -e development     | diff /tmp/sf-deploy-development-before.txt -       # empty
forge deploy list -e confluence-test | diff /tmp/sf-deploy-confluence-test-before.txt -   # empty
forge variables list -e development       # no SF_ROVO_TEST_* keys
forge variables list -e confluence-test   # no SF_ROVO_TEST_* keys
```

Record all outputs, the build SHA and the probe results in `docs/M6_LIVE_TEST.md` (acceptance A6, A7).

---

## Phase 2: two read-only agents (branch `rovo-test/phase2`)

Prepared 2026-11-10 (Lane A5). Status: **prepared only.** Only `forge lint -e rovo-test` was run. No deploy, install, variable, uninstall or Atlassian change was made. Owner-approved scope: `rovo-test` only; two agents, four `GET` actions, the identity probe removed, the same five scopes, per-user cap 300, AI OFF until `SF_ROVO_TEST_AI=enabled`, no `asApp`, no write actions. Base: `rovo-test/build` @ `77e1262`.

### P2.1 Atlassian guidance checked (2026-11-10)

| Topic                                 | What the docs say (quotes under 15 words)                                                                                                           | Source                                                                                                     | What we did                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent prompt: inline vs resource file | "specify the `prompt` as a string or provide it as a relative path to a declared resource"; resource form needs "Forge CLI version 10.6.0 or above" | [Rovo Agent module](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/) | `prompt: resource:agent-prompts;investigator.md` / `facilitator.md`, resource `agent-prompts` → `agents/prompts`. CLI 15.1.0 `forge lint` accepts it (P2.4). |
| Agent name                            | "Must not exceed 30 characters."                                                                                                                    | same                                                                                                       | "Recovery Investigator" (21), "Exercise Facilitator" (20)                                                                                                    |
| Conversation starters                 | "suggested to the user when they engage with your Agent"; **no count or length limit is documented**                                                | same                                                                                                       | Two short starters per agent [limit unverified]                                                                                                              |
| Action inputs                         | each input has `title`, `type`, `required`, `description`; type "`string`, `integer`, `number`, or `boolean`"                                       | [Action module](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)    | Schemas match `src/agents/actions.ts` validation (test `agentForge.test.ts`)                                                                                 |
| Action verbs                          | `GET`, `CREATE`, `UPDATE`, `DELETE`, `TRIGGER`                                                                                                      | same                                                                                                       | All four actions `GET`                                                                                                                                       |
| Handler arguments                     | "The `payload` and `context` are passed into the function as arguments"; examples nest `context` inside `payload`                                   | same                                                                                                       | Adapter accepts both; second argument wins (`src/agents/forge.ts`)                                                                                           |
| accountId                             | "If you need a user's `accountId` read it from the `context`."                                                                                      | same                                                                                                       | accountId only from context; inputs never used for authorization                                                                                             |
| Finding an agent                      | "Open **Chat** in the navigation bar"; "From **Chat**, select **Agents**"; search "by typing its name"                                              | [Browse Rovo agents](https://support.atlassian.com/rovo/docs/browse-agents/)                               | P2.3 step 5                                                                                                                                                  |
| Code-built agents                     | "will have their knowledge and instructions hidden for privacy"                                                                                     | same                                                                                                       | Users cannot read the prompt; it still ships in the app bundle                                                                                               |
| Admin enablement of app agents        | **Not documented** on the agent module or Browse agents pages. A search found only that Rovo Agents need the site AI toggle on. [Unverified]        | as above                                                                                                   | Phase 1 showed the probe agent was usable after install with no admin step                                                                                   |
| Function key length                   | (CLI lint, not docs) "The function key exceeds 23 characters"                                                                                       | `forge lint` 15.1.0                                                                                        | Function keys `fn-*`, ≤ 23 characters                                                                                                                        |

### P2.2 What changes on `rovo-test`

|            | Phase 1 (`77e1262`)                           | Phase 2 (this branch)                                                                                                                                  |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agents     | `identity-probe`                              | `recovery-investigator` (find-recovery-risks, get-service-readiness), `exercise-facilitator` (find-recovery-risks, prepare-rehearsal, explain-outcome) |
| Actions    | `whoami-probe`, `storage-probe`               | `find-recovery-risks`, `get-service-readiness`, `prepare-rehearsal`, `explain-outcome` (all `GET`)                                                     |
| Functions  | `action-whoami-probe`, `action-storage-probe` | `fn-find-recovery-risks`, `fn-service-readiness`, `fn-prepare-rehearsal`, `fn-explain-outcome`                                                         |
| Resources  | `main`                                        | `main`, `agent-prompts`                                                                                                                                |
| Scopes     | five                                          | the same five (asserted exactly by `test/storageFactory.test.ts`)                                                                                      |
| Probe code | registered                                    | kept in `src/probes/**` with tests, **not exported, not in the manifest**                                                                              |

Wiring (`src/agents/forge.ts`): identity from context only → `IDENTITY_UNAVAILABLE`; then the AI opt-in → `USAGE_LIMITED` (DISABLED) with no Jira, Confluence or storage access; then governor and cache from `storageFactory` (null → `GOVERNANCE_UNAVAILABLE`, fail closed); then `createAgentActions` with user gateways built only from `api.asUser()`, engine `ruleEngine`, and a history reader over `historyStore()` scoped to `{installContext, accountId}`.

### P2.3 Variables and the AI opt-in

| Variable                      | Value                                                    | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SF_ROVO_TEST_STORAGE`        | `enabled` (already set in phase 1)                       | Storage factories on                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SF_ROVO_TEST_USER_DAILY_CAP` | `300`                                                    | Per-user daily cap, clamped to 50..300                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SF_ROVO_TEST_AI`             | **unset** until the owner starts testing; then `enabled` | Site AI opt-in. Unset or any other value: `BudgetPolicy.enabled = false`, every action returns `USAGE_LIMITED` ("AI features are switched off for this site…") before any read or spend. `enabled`: the governor treats it as settings `aiEnabled: true` when no settings record is stored; a stored record always wins (stored `aiEnabled: false` is an off switch; malformed fails closed; stored caps can only lower). The opt-in is never written to storage. |

Only the app developer can set Forge variables, so the switch is admin-only by construction.

```sh
# 1. Pre-checks: as phase 1 §3, on a clean checkout of rovo-test/phase2.
forge lint -e rovo-test                      # "No issues found." Any MAJOR_VERSION_RULE: STOP

# 2. Deploy with AI OFF
forge variables set -e rovo-test SF_ROVO_TEST_USER_DAILY_CAP 300
forge variables list -e rovo-test            # SF_ROVO_TEST_STORAGE, SF_ROVO_TEST_USER_DAILY_CAP only
forge deploy -e rovo-test --non-interactive
forge install list                           # rovo-test row still on 64f87111-…; scopes unchanged
# Only if the CLI reports the installation is out of date:
forge install --upgrade -e rovo-test --site one-atlas-cegq.atlassian.net --product jira

# 3. Smoke test with AI OFF (test script block A): expect USAGE_LIMITED, no Jira reads in logs.

# 4. Owner starts testing: switch AI ON
forge variables set -e rovo-test SF_ROVO_TEST_AI enabled
forge deploy -e rovo-test --non-interactive  # variables take effect only after a deploy
```

Find the agents: Jira → **Chat** → **Agents** → search "Recovery Investigator" / "Exercise Facilitator". If they are missing after a deploy, redeploy once (phase 1 §4.4, community 86838).

### P2.4 `forge lint -e rovo-test` (CLI 15.1.0, Node 24.22.2, 2026-11-10)

First run: four errors, three "The function key exceeds 23 characters" (`action-find-recovery-risks`, `action-get-service-readiness`, `action-prepare-rehearsal`) and missing `static/app/build` (not built yet). After renaming to `fn-*` and `npm run frontend:build`: **"No issues found."**

### P2.5 Kill switch (fastest first)

1. Stop chatting.
2. `forge variables unset -e rovo-test SF_ROVO_TEST_AI` then `forge deploy -e rovo-test --non-interactive`: every action answers `USAGE_LIMITED`, reads and spends nothing.
3. `forge variables unset -e rovo-test SF_ROVO_TEST_STORAGE` + deploy: governor null → `GOVERNANCE_UNAVAILABLE` for every action.
4. Code kill switch: `DEFAULT_POLICY.enabled = false` + deploy.
5. Rollback (P2.6). Extra usage stays off / limit 0.

### P2.6 Rollback

```sh
# A. Back to the probe build (keeps the installation):
git checkout 77e1262 && npm ci && npm ci --prefix static/app && npm run frontend:build
forge variables unset -e rovo-test SF_ROVO_TEST_AI
forge deploy -e rovo-test --non-interactive
# B. Remove the app from rovo-test entirely:
forge uninstall -i 64f87111-c12f-4eff-8d69-58f4f8bdc4d9    # id form only; never --batch
```

### P2.7 Isolation checks (before and after every deploy)

```sh
forge install list > /tmp/sf-p2-install.txt                # development, confluence-test rows unchanged
forge deploy list -e development     | diff /tmp/sf-deploy-development-before.txt -       # empty
forge deploy list -e confluence-test | diff /tmp/sf-deploy-confluence-test-before.txt -   # empty
forge variables list -e development       # no SF_ROVO_TEST_* keys
forge variables list -e confluence-test   # no SF_ROVO_TEST_* keys
git log origin/main -1                    # unchanged; rovo-test/phase2 never merged
```

Monitoring: `forge logs -e rovo-test --since 15m --grouped` and `-f fn-find-recovery-risks` (etc.). Scripted test: [M6_PHASE2_TEST_SCRIPT.md](M6_PHASE2_TEST_SCRIPT.md).
