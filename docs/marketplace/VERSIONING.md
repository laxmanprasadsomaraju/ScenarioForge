# Versioning and upgrade notes (DRAFT, for owner review)

- Forge versions apps on deploy. A **minor** version (code-only changes) upgrades installs automatically. A **major** version (new scopes, egress or some module changes) needs site-admin consent. On the Marketplace, major updates get a new security review: new submissions and major updates take 5–10 business days; minor cloud updates are instant. Source: https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/
- **Listed version 1.0:** the four read scopes, no storage, no egress, no AI.
- **Planned major versions** (each one is a new consent and review):
  - Adding `storage:app` for rehearsal history.
  - Adding Teamwork Graph `read:graph:*` scopes (prepared on `m9/twg`; needs org-admin consent).
  - Adding `rovo:agent` / `rovo:mcp` modules (Preview; whether listed apps may use them is unverified).
- Group scope additions into as few major versions as possible.
- Upgrade note template for customers: "This version adds <scope> so that <feature>. A site admin must accept the update in Manage apps. Nothing changes until then."
- Free app: no `licensing` object. Switching to paid later is not planned. The restriction for commercial cloud is unverified (MARKETPLACE_PLAN.md).
- Listing disables installation-link distribution of the same app id. Keep the judge build on a separate app id (MARKETPLACE_PLAN.md §2).
