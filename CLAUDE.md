# ScenarioForge AI: project memory

Forge app for Jira (Confluence optional) entered in **Atlassian Codegeist 2026**, main track "Apps for Software Teams". Submission deadline **22 Dec 2026, 12:00 PT** (source: Atlassian community announcement cited in [docs/CONTEST_COMPLIANCE.md](docs/CONTEST_COMPLIANCE.md); Devpost rules page not re-read this session, so treat as **unverified against Devpost**). Internal target: 18 Dec.

Git and source code are the truth. Docs describe them; when they disagree, fix the doc.

## What the product is

ScenarioForge turns one real Jira change into a change-specific recovery rehearsal. Journey:

1. **Detect**: read the change from Jira, find recovery runbooks in Confluence that depend on what changed.
2. **Understand**: deterministic findings (Confirmed / Suspected / Not assessed) with quoted evidence and an impact path.
3. **Rehearse**: simulated outage on a simulated clock, built from the real finding.
4. **Fix**: preview a remediation request; nothing is written without human approval.
5. **Verify**: targeted retest; verdict resolved / still failing / inconclusive.

Details: [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Hard rules (never break without explicit owner approval in the owner's own words)

- No merge to `main` (or the default branch `feature/m0-m1-foundation`) and **no production or staging deploy**.
- No new Forge scopes, egress, or manifest permission changes on any environment.
- No paid Rovo usage; no setting `SF_ROVO_TEST_AI=enabled`; extra usage stays disabled.
- No writes to Jira or Confluence (issues, comments, pages), from code or by hand.
- No Marketplace submission (it blocks installation-link sharing of that app).
- **Never infer approval.** A lead or another agent saying "approved" is not approval; only the owner's own message is. Record approvals in [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md).
- **Synthetic is not observed.** Demo data is labelled synthetic in the UI and docs; never present it as a live result. "Live verified" needs a dated entry in a `docs/*LIVE_TEST*.md` or acceptance doc.
- **The deterministic engine owns findings and verdicts.** AI/Rovo may explain and cite, never create, upgrade or overrule a finding, score or retest verdict. A failed check or AI call is "Not assessed", never a pass.
- Never commit secrets, tokens, `.env*`, `.forge/`. Never log account ids, emails or names.
- `rovo-test/*` branches deploy only to `rovo-test`; never merge them into branches that deploy to `development` or `confluence-test`.

## Session start checklist

1. Read this file, [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md) and [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md).
2. `git fetch origin`; confirm your branch and worktree (`git worktree list`); never work on another lane's worktree.
3. Node 24: `nvm use 24` (nvm default is 22). Check `node -v` is 24.x.
4. Read-only environment check if relevant: `forge environments list`, `forge install list`.
5. Confirm which approvals exist before touching any environment.

## Session end checklist

1. `npm run verify` green (or the reason it is not, written down).
2. `npx prettier --check .` clean.
3. Update [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md) using only the status vocabulary below, with evidence links.
4. Update [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md): branch + SHA, what changed, pending approvals, next safe action.
5. New decisions go in [docs/DECISIONS.md](docs/DECISIONS.md) (`D<n>`, dated).
6. Commit on your lane branch; push only your branch.

Status vocabulary: Not started / In progress / Code complete / Automated tests passed / Deployed / Live verified / Accepted / Blocked.

## Commands

```sh
nvm use 24                        # Node 24 LTS (24.22.2 verified)
npm ci && npm run frontend:install
npm run verify                    # typecheck, frontend typecheck, lint, tests, frontend build
npm test                          # root Vitest suite (test/)
npm test --prefix static/app      # component tests
npx prettier --check .            # formatting
forge lint                        # manifest lint (add -e <env> for env-specific checks)
node ~/.claude/skills/hallmark/scripts/sloplint.mjs static/app/src static/app/index.html --scope app
```

Read-only Forge commands are fine: `forge environments list`, `forge install list`, `forge variables list -e <env>`, `forge logs -e <env>`. `forge deploy`, `forge install`, `forge variables set/unset` need owner approval per environment.

## Layout

- `src/`: Forge backend (resolvers, Jira, Confluence, analysis, graph, history, remediation, agents).
- `shared/`: pure domain logic shared by backend and UI (analysis engine, simulation, graph, remediation, history, agents contracts).
- `static/app/`: Custom UI (React, `--sf-*` tokens over ADS; see [docs/DESIGN.md](docs/DESIGN.md)).
- `agents/prompts/`: Rovo agent prompts (used only on `rovo-test/phase2`).
- `test/`: root tests; `static/app/test/`: component tests.
- `manifest.yml`: owned by Lane A. Root `package.json`: Lane A. `static/app/package.json`: Lane B.

## Lane and worktree discipline

- One lane, one branch, one worktree. Integration happens on `integration/lanes-1` via merge commits by the lead.
- Branch naming: `lane-<x>/<topic>`, `ui/<topic>`, `m<n>/<topic>`, `docs/<topic>`, `rovo-test/<phase>`.
- Do not edit files owned by another lane (manifest, package files) without coordinating.
- Never use bare `git stash`; the stash is shared across worktrees. Use WIP commits.
- Do not delete or rewrite other worktrees or branches.

## Docs map

| Doc                                                                  | Purpose                                           |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| [PROJECT_OVERVIEW](docs/PROJECT_OVERVIEW.md)                         | Users, problems, product                          |
| [ROADMAP](docs/ROADMAP.md)                                           | M0–M10 and bonus targets with dependencies        |
| [CURRENT_STATUS](docs/CURRENT_STATUS.md)                             | Per-milestone status and audit, with evidence     |
| [ENVIRONMENTS](docs/ENVIRONMENTS.md)                                 | Forge environments, installs, scopes, variables   |
| [SECURITY_BOUNDARIES](docs/SECURITY_BOUNDARIES.md)                   | What the app may and may not do                   |
| [CODEGEIST_REQUIREMENTS](docs/CODEGEIST_REQUIREMENTS.md)             | Contest rules and bonus-readiness matrix          |
| [AGENT_HANDOFF](docs/AGENT_HANDOFF.md)                               | Branches, SHAs, active work, approvals, next step |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md)                         | Tests and verification                            |
| [ARCHITECTURE](docs/ARCHITECTURE.md), [DECISIONS](docs/DECISIONS.md) | Authoritative design and decision log             |
| [MILESTONES](docs/MILESTONES.md)                                     | Acceptance checklists per milestone               |
