# M10 proposal: judged release (production build and installation link)

Status: **PROPOSAL. Nothing deployed, tagged or shared.** Prepared 2026-11-11 (docs lane, branch `docs/approval-proposals`). Read-only CLI checks run today: `forge environments list`, `forge install list`, `forge variables list -e production` ("There are no variables in the production environment"). `production` has never received a build (last deployed 2026-11-09T22:39:53Z = template registration) and has no installation.

## 1. Candidate build

| Item           | Value                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch         | `integration/lanes-1`                                                                                                                                                                                           |
| Commit         | `adbf613` (tip on 2026-11-11). Re-pin to the final tip after the 23–27 Nov security pass; the approval must name the exact SHA deployed                                                                         |
| App id         | `ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355` (existing app; the judge build)                                                                                                                 |
| Manifest       | One `global:fullPage` module, one resolver, four scopes, `unsafe-inline` styles, no egress, no storage, no Rovo modules, Confluence `required: false`                                                           |
| Closest tested | `confluence-test` (same scopes); 2.6.0 accepted for primary UI ([UI_SIDEBAR_ACCEPTANCE.md](../UI_SIDEBAR_ACCEPTANCE.md)); CLI shows a newer deploy at 2026-11-11T15:41:53Z, not yet recorded in ENVIRONMENTS.md |

### Features gated off in the judged build (as code stands at `adbf613`)

| Feature                            | Gate                                                          | What the judge sees                                                              |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Rehearsal history (M6)             | No `storage:app`; history store factory returns null          | History is not saved; message that storage is not enabled                        |
| Crisis room (M7)                   | `crisisStorage()` returns null; no `@forge/realtime`          | "Team rooms need storage that is not enabled in this environment"                |
| Rovo agents / AI explanations (M6) | Agents exist only on `rovo-test/phase2`; not in this manifest | No agents; deterministic findings only                                           |
| MCP (M9)                           | `m9/mcp` not merged                                           | Nothing                                                                          |
| Teamwork Graph (M9)                | `SF_TWG` unset; no `read:graph:*` scopes                      | Nothing                                                                          |
| Remediation write (M8)             | Writer factory returns null; no `write:jira-work`             | "Create in Jira" disabled with the permission message; preview and approval only |

## 2. Scopes for production

Current four only, unless the owner approves more:

- `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`.

Consequences of the four-scope build (accept explicitly):

1. **No history**: rehearsals are not persisted between sessions.
2. **No crisis rooms**: M7 shows the disabled state; no multi-user demo.
3. **No agents / MCP**: the Rovo and MCP bonus evidence must come from `rovo-test` recordings, not from the judged build.
4. **No remediation writes**: M8 stays preview + simulated approval.

Adding any of these later is a scope or permanent-storage change, i.e. a major version that every installed site (including judges) must re-consent to; do it before the link is shared, never during judging.

## 3. Deploy and share (owner runs every step)

1. On a clean checkout of the approved SHA: `nvm use 24`, `npm ci && npm run frontend:install`, `npm run verify`, `npx prettier --check .`, `forge lint -e production`.
2. `forge deploy -e production` (from the approved SHA; no `--tag`/`forge build`).
3. `forge install -e production --site one-atlas-cegq.atlassian.net --product jira` (owner's demo site), then add Confluence if wanted (`--product confluence`). Verify with `forge install list`.
4. Developer console → app → **Distribution** → select **Sharing** (not "Sharing within organization", which limits installs to the owner's orgs), fill in app details, **Save changes**, copy the installation link. Source: https://developer.atlassian.com/platform/forge/distribute-your-apps/
5. Link behaviour (same source, read 2026-11-11):
   - Installing users "must be an admin of the site they're installing the app on".
   - Regenerating the link "disables the previous installation link" and "can't be undone"; existing installs keep working and can update.
   - Permission changes "remain subject to admin approval", so a later scope change does not reach judges silently.
6. Paste the link into Devpost and [JUDGE_INSTALL_GUIDE.md](../submission/JUDGE_INSTALL_GUIDE.md). **Do not regenerate it after submission.**

## 4. One app id or two

"Once your app has been submitted for listing on Marketplace, or has a license in the app manifest," it can't be shared via installation link; "create a new, unlicensed copy of the app and share that" (https://developer.atlassian.com/platform/forge/distribute-your-apps/). Therefore:

- **Judged build only (no Marketplace bonus):** one app id, the existing one.
- **Also pursuing Marketplace:** two app ids. The existing id stays the judged build; a new id (registered by the owner) is listed. Mechanism: [MARKETPLACE_PLAN.md §2](../MARKETPLACE_PLAN.md) and [M9_MARKETPLACE_ELIGIBILITY.md](M9_MARKETPLACE_ELIGIBILITY.md). Never submit the existing id.

## 5. Fresh-install test on a second site

The demo site already has development/test installs, so it cannot prove a judge's first-run experience.

1. Owner creates a second site: a free Atlassian developer site (https://developer.atlassian.com/platform/forge/getting-started/ → "Get a cloud developer site"; Jira + Confluence) or a free Jira Cloud site with a different admin account. **[Unverified]** whether the free developer site offer still includes Confluence at the time of signup.
2. In a private browser profile, as that site's admin, open the installation link, install, accept the four-scope consent.
3. Follow [JUDGE_INSTALL_GUIDE.md](../submission/JUDGE_INSTALL_GUIDE.md) verbatim: create the demo data, run the MC-62 journey, confirm the gated features show their disabled messages, and the app works with Confluence absent.
4. Record a dated entry (`docs/M10_LIVE_TEST.md`): site type (not URL if private), version, results. Uninstall afterwards or keep as the judge rehearsal site.

## 6. Version control

- Tag the deployed commit: `git tag -a judged-v1.0.0 <SHA> -m "Production deploy for Codegeist judging; forge version <major.minor.patch>"` then `git push origin judged-v1.0.0`. Record the Forge version printed by `forge deploy` in [ENVIRONMENTS.md](../ENVIRONMENTS.md) and [AGENT_HANDOFF.md](../AGENT_HANDOFF.md).
- Any fix during 2–4 Dec: minor versions only (no scope/entity change), tagged `judged-v1.0.1`, etc.
- Freeze after the Devpost submission: no production deploy until judging ends.

## 7. Rollback

- Bad build: check out the previous tag and `forge deploy -e production` again (a redeploy creates a new version with the old code; installs on the same major update in place). **[Unverified]** whether a console "rollback to version" action is available for this app; the redeploy path does not depend on it.
- Bad scope change: remove it and redeploy; installs that already consented keep a major version until updated. Do not add scopes in the first place (§2).
- Last resort: `forge uninstall -e production --site <site>` on the owner's site, or disable Sharing in the console (stops new installs; existing installs keep running). **[Unverified]** whether turning Sharing off invalidates the link permanently or only until re-enabled.

## 8. Demo-site expiry risk

`one-atlas-cegq.atlassian.net` reportedly expires **2027-02-07** ([ENVIRONMENTS.md](../ENVIRONMENTS.md); the expiry date is not re-verified). Judging and winner announcements may run into early 2027 **[unverified dates]**.

Mitigation:

- Judges install on their own sites via the link; the link and production app do not depend on the demo site.
- Keep the video and screenshots as the primary evidence of the demo data.
- Before 2027-01-15, owner checks the site's renewal/expiry notice in admin.atlassian.com and, if needed, recreates the demo data on the second site from §5 (the guide's data steps are verbatim).

## APPROVAL REQUEST (M10 judged release)

```
APPROVAL REQUEST — M10 judged release
Owner: please reply in your own words to approve or reject each line.
[ ] A1. Deploy integration/lanes-1 @ <final SHA, currently adbf613> to `production`
        (app 113a7a88-…), Forge CLI, Node 24, no --tag.
[ ] A2. Scopes: exactly read:jira-work, read:jira-user, search:confluence,
        read:page:confluence. I accept: no history, no crisis rooms, no agents/MCP,
        no remediation writes, no Teamwork Graph in the judged build.
[ ] A3. Install on one-atlas-cegq.atlassian.net (production env), Jira (+ Confluence).
[ ] A4. Set Distribution to "Sharing" and generate the installation link; never
        regenerate it after the Devpost submission.
[ ] A5. Fresh-install test on a second site I create (free developer site or second
        demo site).
[ ] A6. Git tag judged-v1.0.0 on the deployed SHA and push the tag.
[ ] A7. Two app ids if (and only if) I pursue Marketplace; the existing id is never
        submitted for listing.
Rollback I accept: redeploy previous tag; disable Sharing; uninstall from my site.
Target date: Mon 30 Nov 2026.
```
