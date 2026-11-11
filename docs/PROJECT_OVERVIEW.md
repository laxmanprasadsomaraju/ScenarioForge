# Project overview

Short orientation. The longer argument is in [PRODUCT_VISION.md](PRODUCT_VISION.md); the design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Users

- **Software and platform engineers** who ship changes through Jira.
- **SRE and incident-response leads** who own recovery runbooks in Confluence.
- **Engineering managers** who need evidence that recovery plans still hold after a change.

## Problems

- Runbooks drift: a change retires, renames or migrates something a recovery step depends on, and nobody notices until the incident.
- Full DR exercises are expensive, rare and not tied to the change that introduced the risk.
- Generic AI summaries are not evidence; teams need quoted sources and an honest "not assessed" when the check could not run.

## Product

A Forge app (Jira global full page, Confluence optional) with one journey:

| Step       | What happens                                                                                     | Where in code                           |
| ---------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Detect     | Read a Jira change; search and read Confluence recovery runbooks as the user                     | `src/jira`, `src/confluence`            |
| Understand | Deterministic findings (Confirmed / Suspected / Not assessed), exact quotes, impact path         | `shared/analysis`, `shared/graph`       |
| Rehearse   | Simulated outage from the real finding, decisions cost simulated time, deterministic scoring     | `shared/simulation`, `shared/rehearsal` |
| Fix        | Remediation request preview with exact payload and fingerprint; no write scope, nothing created  | `shared/remediation`, `src/remediation` |
| Verify     | Targeted retest; verdict resolved / still failing / inconclusive (D15); history with audit check | `shared/simulation`, `shared/history`   |

Rovo agents (Recovery Investigator, Exercise Facilitator) explain the same deterministic results with citations; they exist only on the `rovo-test` build (see [ENVIRONMENTS.md](ENVIRONMENTS.md)).

## Out of scope

Generic documentation-drift fixing, chatbots without a workflow, incident dashboards, and any claim that the app prevents incidents, guarantees recovery or certifies compliance.
