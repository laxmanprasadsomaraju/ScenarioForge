# Judge installation guide (draft)

Status: **draft**. The installation link does not exist yet. It needs an owner-approved production deploy and Sharing enabled. Placeholders are in `<angle brackets>`.

## Pending owner decisions

1. **Production deploy and distribution link.** Forge installation links need a production deploy and distribution set to **Sharing** ("Sharing within organization" would block judges outside the owner's org). Source: https://developer.atlassian.com/platform/forge/distribute-your-apps/
2. **Two app IDs for the Marketplace bonus.** An app submitted for Marketplace listing can't be shared by installation link (same source). If the Marketplace bonus is pursued, the judged app (`113a7a88-…`) stays unlisted with an installation link, and a second app ID built from the same commit goes to Marketplace ([../MARKETPLACE_PLAN.md](../MARKETPLACE_PLAN.md)). Devpost has not confirmed that this is acceptable ([REQUIREMENTS.md](REQUIREMENTS.md)).
3. **What the judged build contains.** Recommended: the `confluence-test` scope set (four read scopes, no storage, no Rovo). Adding `storage:app`, Rovo modules or `rovo:mcp` changes the consent screen and needs separate approval.

## Prerequisites

- An Atlassian Cloud site with **Jira** (required). You must be a **site admin** to install from a link.
- **Confluence** on the same site (optional but needed for the demo: runbooks are read from it).
- **Rovo** on the site, only if the judged build includes the Rovo agents (not decided). A free Forge developer/demo site includes Rovo (https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/).
- Permission to create a Jira work item and a Confluence space (for demo data).

## Install

1. Open the installation link: `<installation link>`.
2. Choose your site, select Jira, and also Confluence if offered. Accept the requested read-only access.
3. In Jira, open **Apps → ScenarioForge**. The first time, you may be asked to allow access to Confluence.
4. **Settings** lists the scopes the app actually has. With the recommended build: read Jira work, read your Jira profile, search Confluence, read Confluence pages. Nothing is written. The `release/judged-full` build also lists `storage:app` ("Off unless an admin enables it") and a "Not requested" row for `write:jira-work`.

## Create demo data (about 5 minutes; text verbatim from the live tests)

The app is read-only, so you create the data by hand. Everything is labelled `[DEMO]` and synthetic.

### Confluence: space **ScenarioForge Demo**, key **SFDEMO**

Page 1, title `[DEMO] RB-AUTH-01 Customer sign-in recovery`. Use a real numbered list (type `1.` then a space):

> Synthetic runbook for ScenarioForge testing. Not a real procedure.
>
> Use this runbook when customers cannot sign in.
>
> 1. Confirm elevated sign-in failures on the auth dashboard.
> 2. Check the primary IdP status page.
> 3. If the primary IdP is unavailable for more than 5 minutes, run `authctl failover --target legacyauth`.
> 4. Post a status update to customers.

Page 2, title `[DEMO] RB-DB-02 Database failover runbook`:

> Synthetic runbook for ScenarioForge testing. Not a real procedure.
>
> 1. Confirm the primary database is unreachable from two regions.
> 2. Promote the read replica in the secondary region.
> 3. Update the connection string secret.
> 4. Verify writes succeed, then notify the incident channel.

Page 3, title `[DEMO] Recovery notes without steps`:

> Synthetic page for ScenarioForge testing. This page discusses disaster recovery in prose only. It has no numbered list, so ScenarioForge should not invent steps.

### Jira: two Tasks in any space, status **To Do**

Issue A (the MC-62-style change):

- **Summary:** `[DEMO] Retire LegacyAuth backup SSO tenant`
- **Description:**

  > Synthetic change for ScenarioForge testing.
  >
  > We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.

Issue B (the control):

- **Summary:** `[DEMO] Upgrade marketing email templates`
- **Description:** `Synthetic change. Refresh the email campaign templates.`

Source: [../M2_CONFLUENCE_TEST.md](../M2_CONFLUENCE_TEST.md), [../M3_LIVE_TEST.md](../M3_LIVE_TEST.md).

## What to try

1. **Runbooks** (left navigation; the page heading reads "Recovery plans"): enter space key `SFDEMO` and press Search. Open page 1: four steps in order. Open page 3: the app says it did not guess any steps.
2. **Readiness checks → Check recovery impact** on issue A: subject LegacyAuth, replaced by NimbusID, with the exact sentence quoted. Finding: **Suspected** on RB-AUTH-01 step 3, with both quotes and links.
3. Add `Related change: <issue A key>` to page 1 and check again: the finding becomes **Confirmed — explicit link**.
4. Check issue B: **Not assessed** with a reason. The app does not claim "no conflicts" when it had nothing to search for.
5. Open the **impact path**: change → LegacyAuth → step 3 → runbook page. Service and owning team show as "not assessed", not invented.
6. **Rehearse this finding** (button in the "Rehearse a finding" panel; set a 30-minute restore target), then **Start rehearsal**. Follow step 3 as written. In the debrief tick **Approve for the retest** on the correction that replaces LegacyAuth with NimbusID, then press **Run targeted retest**. Expected: "Gap resolved" (in the simulation).
7. Optional: switch Light/Dark under Appearance (Settings, or the foot of the left navigation); narrow the window to see the drawer navigation.

## What is synthetic or modelled

- All demo pages and issues are synthetic and labelled `[DEMO]`.
- Rehearsal minutes, objectives and outcomes are **modelled** by fixed rules from the finding. They are not measurements of a real recovery.
- "Approve for the retest" is a demo step. No page is edited and no work item is created. The "Prepare the correction as a Jira work item" section only previews a draft; its **Create in Jira** button stays disabled ("Disabled: no write permission") in this build.
- Rehearsal history is kept in the browser tab only (no storage in the recommended build).
- Services and teams are not assessed without a JSM Assets or Teamwork Graph source.

## Uninstall

Admin → Apps → Manage apps → ScenarioForge → Uninstall. The recommended build stores no data.

## Validation note (Lane C, 2026-11-11, dev preview, not live)

Walked against the app in the Vite dev preview (synthetic fixtures; nothing here was run on a live site). Steps that match the real UI: install page labels, Appearance, Settings scope list, Runbooks search and the no-steps message, Readiness checks "Check recovery impact", "Confirmed — explicit link" and "Suspected — text match" labels, Impact path section, "Rehearse this finding", "Run targeted retest", "Gap resolved". Fixed in this guide: the Runbooks name, "Approve for the retest" wording, scope list. Not performable offline and still unverified on a live site: steps 3 to 6 against real MC-62-style data, and the dev preview cannot run "Rehearse this finding" (fixtures do not implement rehearsal generation). Related change lines: any mention of the change's issue key on the page makes the finding Confirmed, so `Related change: <key>` works.

## Earlier validation note (Lane 3, 2026-11-11)

This guide describes the four-scope recommendation. `release/judged-full` also requests `storage:app` and declares two Rovo agents and `rovo:mcp`, so its consent screen differs and installing it means a major version upgrade. With `SF_STORAGE` and `SF_AI` unset the extra modules do nothing: agent actions answer "AI features are switched off", history shows "not enabled", Crisis room is unavailable. Judges should only be told to try the steps under "What to try"; do not mention Rovo, MCP, Crisis room or Teamwork Graph until each has a dated live record ([BONUS_EVIDENCE_CHECKLIST.md](BONUS_EVIDENCE_CHECKLIST.md)). Demo script: [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
