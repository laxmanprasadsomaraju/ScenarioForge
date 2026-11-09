# Product vision

## Problem

Recovery procedures are written once and then drift. Teams retire a backup provider, move a database, or change a DNS failover, and the runbook that depends on it keeps pointing at something that no longer exists. Nobody finds out until the incident, when the documented step fails and the clock is running.

Full disaster-recovery exercises catch this, but they are expensive, infrequent and not tied to the change that introduced the risk.

## Audience

- Software and platform engineering teams that ship changes through Jira.
- SRE and incident-response leads who own recovery procedures.
- Engineering managers who need evidence that recovery plans still hold after change.

## What ScenarioForge does

For an important change, ScenarioForge:

1. **Change.** Reads the change from Jira.
2. **Recovery risk.** Finds the recovery procedures that depend on what changed, with the source text as evidence.
3. **Rehearsal.** Builds a short simulated outage specific to that change, played on a simulated clock.
4. **Evaluation.** Scores decisions against predefined recovery objectives with deterministic rules.
5. **Remediation.** Proposes corrective Jira work, created only with human approval.
6. **Retest.** Re-runs the targeted rehearsal and records whether the gap is closed.

## Differentiators

- **Change-specific, not generic.** Each rehearsal starts from one real change, not a library of generic drills.
- **Rehearsal, not a quiz.** Decisions cost simulated time, deadlines pass, and consequences come from the scenario's rules.
- **Evidence first.** Every finding cites its source. Unknown stays unknown: a failed check or failed AI call never becomes a pass.
- **Inside Atlassian.** Jira, Confluence, JSM, Rovo and Teamwork Graph are the sources and the destinations, with no external hosting.

## Out of scope

- Generic documentation drift detection or rewriting (ScenarioForge does not copy any other entrant's documentation-fixing workflow).
- Chatbots without a workflow, or incident dashboards.
- Claims that the app prevents incidents, guarantees recovery or certifies compliance.
