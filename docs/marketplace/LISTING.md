# Listing copy (DRAFT, for owner review)

## Name

**ScenarioForge for Jira**

This follows the "App X for Jira" naming pattern from the approval guidelines (see MARKETPLACE_PLAN.md).

## Tagline (max ~80 characters)

Rehearse recovery for the Jira change you are about to ship, before it breaks.

## Category and products

- Category (proposal): IT & helpdesk / Project management. The owner picks from the live category list.
- Products: Jira Cloud (required). Confluence Cloud on the same site is optional; it is used to read runbooks.

## Long description

ScenarioForge turns one real Jira change into a recovery rehearsal built for that change.

Select a change, such as retiring a backup identity provider. ScenarioForge reads it as you, finds the Confluence recovery runbooks that depend on what is changing, and reports each finding as **Confirmed**, **Suspected** or **Not assessed**, with quoted evidence from the runbook step.

From a finding, you can run a simulated outage on a simulated clock to see whether the team would still recover. You can preview a remediation request; nothing is written to Jira or Confluence. Then check that a fix addresses the risk with a targeted retest.

- **Evidence, not guesses.** Findings come from a deterministic engine and quote the source text. If something could not be checked, it says "Not assessed", never "pass".
- **Your permissions only.** Every read runs as the signed-in user, so you see only what you can already see in Jira and Confluence.
- **Read-only.** The app has no write scopes, sends no data outside Atlassian, and uses no AI in this build.
- **Synthetic data is labelled.** Demo content is always marked as synthetic.

## Highlights (three)

1. **Change → runbook risk in one click.** Finds recovery steps that depend on what a change retires or replaces, and quotes the exact step.
2. **Rehearse on a simulated clock.** A safe, simulated outage built from the real finding. Nothing touches production.
3. **Verify the fix.** A targeted retest gives a resolved, still failing or inconclusive verdict.

## Screenshots plan (real screens, live demo site, synthetic data labelled)

| #   | Screen (route)                         | What it shows                                                                         |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Command center (`/`)                   | Journey overview: Detect, Understand, Rehearse, Verify                                |
| 2   | Changes (`/changes`)                   | Recent Jira changes the user can see, and selecting MC-62                             |
| 3   | Readiness checks (`/readiness-checks`) | MC-62 finding (RB-AUTH-01 step 3 depends on LegacyAuth) with confidence and quote     |
| 4   | Runbooks (`/recovery-plans`)           | The Confluence runbook with the affected step highlighted                             |
| 5   | Rehearsals (`/simulations`)            | A simulated outage in progress on the simulated clock                                 |
| 6   | History (`/reports`)                   | Outcome and retest verdict. Only if storage ships in the listed build; otherwise omit |

Rules:

- Capture at 1840×900 or larger in light theme, and add one dark-theme shot.
- The issue keys and page titles must be the `[DEMO]` synthetic ones. No real names or account ids may appear.
- Each caption states "synthetic demo data".

## Logo

144×144 PNG. **Owner to provide**; no asset exists in the repo yet.
