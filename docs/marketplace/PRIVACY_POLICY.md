# ScenarioForge for Jira: privacy policy (DRAFT, for owner review)

> DRAFT. This is not legal advice. The owner must review it, fill in the bracketed fields and publish it at a public URL before submission.

**Effective date:** [DATE]. **Publisher:** [OWNER LEGAL NAME / ENTITY], [CONTACT EMAIL].

## Summary

ScenarioForge for Jira is a Forge app that runs entirely on Atlassian's Forge platform.

- It reads Jira and Confluence content **as the signed-in user**, to show recovery readiness findings.
- It does not send data to any server outside Atlassian.
- It does not sell data and uses no third-party analytics or AI services.

## What the app reads

Read-only scopes: `read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`.

- **Jira:** issue keys, summaries, descriptions, status, type and updated time for changes the user opens. It also reads the user's own profile, only to confirm the connection; the profile is not stored.
- **Confluence:** page search results (titles and links) and the body of recovery runbook pages the user can view.

## What the app stores

- **This build stores nothing.** It has no `storage:app` scope, so all analysis happens in memory for one request and is then discarded.
- [IF A LATER VERSION ADDS STORAGE: rehearsal history is stored in Forge storage on Atlassian's infrastructure, keyed by the user's Atlassian account id. It is retained until the user deletes it or the app is uninstalled. Update this section.]

## What the app sends elsewhere

Nothing. The manifest declares no external egress. Data stays in Atlassian's Forge runtime and in the Atlassian products it reads from.

## Logging

Forge platform logs may record errors. The app is designed not to log issue text, page text, account ids, emails or names. It logs only counts and error codes.

## AI

This build uses no AI. Findings come from a deterministic rule engine. [IF ROVO AGENTS SHIP: describe Rovo use, which runs on Atlassian's platform under Atlassian's AI terms.]

## Personal data and your rights

The app processes personal data (for example, names that appear in issue text) only transiently, to answer the user's request. It keeps no personal data, so no personal data needs to be reported or erased.

- The app follows Atlassian's personal data reporting requirements for Forge apps. [CONFIRM per listing requirements.]
- Requests: [CONTACT EMAIL].

## Data residency

All processing happens on Atlassian-hosted Forge infrastructure. [CONFIRM the "Runs on Atlassian" eligibility with `forge eligibility` before claiming it.]

## Changes

Changes to this policy are posted at this URL, with a new effective date.
