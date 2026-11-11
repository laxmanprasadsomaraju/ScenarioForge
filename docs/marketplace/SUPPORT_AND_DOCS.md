# Support and documentation pages (DRAFT, for owner review)

## Support page

- **Contact:** [SUPPORT EMAIL]. Response target: [e.g. 2 business days], best effort, free app.
- **Before you write, include:** your site URL, the change issue key, the screen name and the message you saw. Do not send issue content or personal data.
- **Security issues:** [SECURITY EMAIL].
- **Status:** ScenarioForge depends on Jira and Confluence Cloud availability (status.atlassian.com).
- At least one partner contact must be registered in the Developer Community (listing requirement).

## Documentation page

### Install

1. A site admin installs ScenarioForge for Jira from the Marketplace.
2. Open **Apps → ScenarioForge** in Jira.

### Use

1. **Detect.** Open **Changes** and pick a change issue.
2. **Understand.** Open **Readiness checks**. Each finding is marked Confirmed, Suspected or Not assessed and quotes the runbook step. **Runbooks** shows the source page.
3. **Rehearse.** Open **Rehearsals** to start a simulated outage built from a finding. The clock is simulated and nothing touches real systems.
4. **Fix.** Preview a remediation request. Nothing is written until a person approves it outside the app.
5. **Verify.** Run a targeted retest to get a resolved, still failing or inconclusive verdict.

### Requirements

- Jira Cloud.
- Confluence Cloud on the same site for runbook checks. Without it, runbook links show as Not assessed.
- Users see only what their own Jira and Confluence permissions allow.

### FAQ

- **Why "Not assessed"?** A source could not be read or is not connected. That is never treated as a pass.
- **Does it write to Jira or Confluence?** No.
- **Does it use AI?** Not in this version.
