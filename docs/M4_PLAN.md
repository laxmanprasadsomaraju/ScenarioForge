# M4 plan: recovery readiness graph, Teamwork Graph, and the bridge to M5

Status: plan, 2026-11-10. Nothing here is built yet.

## Goal

For one change, show the path from what changed to who and what recovery depends on:

```
Change ──names──▶ Subject (LegacyAuth) ──used by──▶ Runbook step ──recovers──▶ Service ──owned by──▶ Team
                                │
                                └──replaced by──▶ Replacement (NimbusID)
```

Every edge says why it exists and cites its source. An edge without a source is not drawn. Anything we could not check is shown as not assessed, never as healthy.

## Graph model (lead-owned contract, `shared/graph/types.ts`)

| Node                  | Source                                             | Notes                         |
| --------------------- | -------------------------------------------------- | ----------------------------- |
| Change                | Jira issue (M3)                                    | Key, summary, link            |
| Subject               | M3 engine                                          | Term, action, replacement     |
| Runbook page and step | Confluence (M2/M3)                                 | Page link, step text verbatim |
| Service               | JSM services or Teamwork Graph (Compass component) | Only when a source returns it |
| Team / owner          | Teamwork Graph or Jira                             | Only when a source returns it |

| Edge                | Basis (always stored)                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| change → subject    | M3 subject excerpt                                                             |
| subject → step      | M3 finding (confirmed or suspected, with basis list)                           |
| step/page → service | Explicit reference only: page names the service, or the service links the page |
| service → team      | Teamwork Graph "team owns component" or the service record's owner field       |
| change → service    | Jira "impacts" relation (Teamwork Graph: work item impacts Compass component)  |

Rules:

- Built on demand for one change, server-side, bounded (the M3 limit of 5 runbooks; at most 20 services, 20 teams).
- No inferred edges from AI or name similarity. A suspected M3 finding stays suspected on the graph.
- Each node and edge carries `origin` and `evidence`; the UI never draws a node without them.

## Presentation (Hallmark app-screen rules)

An impact path, not a decorative network chart: a structured, keyboard-navigable list grouped by subject, each row expandable to its evidence. A small node-link drawing is added only if it explains something the list cannot, and it must have a text equivalent. Lives on the Readiness check for a change ("Impact path" section) rather than a separate dashboard.

## Teamwork Graph integration (Best Teamwork Graph bonus)

Status of facts: see docs/TEAMWORK_GRAPH_TEST_PLAN.md (Lane D, cited). Key constraints: Preview API via `api.asUser().requestTeamworkGraph`; curated or persisted queries only; read scopes per object type; installing needs an org admin; missing scopes return no data rather than an error.

Steps:

1. Owner confirms org admin on the demo site's organisation and runs the playground query (owner action, already listed).
2. New isolated environment `graph-test`; branch adds only the `read:graph:*` scopes the probe needs. Owner approval required before deploy.
3. Probe resolver (enum-only queries): curated `jiraSpaceWorkItems`, `atlassianTeamMembers`, and a persisted query for "work item impacts Compass component" / "team owns component" if Compass data exists.
4. Claim the integration only after a real query returns data on the site; record the evidence like M2/M3.
5. Fallback if blocked (no org admin, no Compass data, Preview restriction): document it, keep the graph working from Jira, Confluence and JSM sources, and keep the bonus target open.

Budget: enriched Teamwork Graph calls go through the usage governor (Lane D), which stays off until `storage:app` is approved with M6.

## JSM services (completes M2)

Find the official endpoint and scopes for listing services and their owners in Jira Service Management, verify on the demo site (JSM is licensed on the owner's other org; check the demo site first). Read-only scopes; same isolated-environment approval flow.

## Bridge to M5: a rehearsal from a finding

When a check has a finding, "Rehearse this change" builds a deterministic scenario from it:

| Scenario part | Built from                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Incident      | Outage of the primary path that the runbook step is the fallback for (step text)                                                                                         |
| Decisions     | Follow the step as written; check recent changes first (cites the change); use the replacement if the change names one; escalate; bypass controls                        |
| Consequences  | Fixed templates keyed to the finding: following a step that depends on a retired subject is costly; using the named replacement is effective only if the change says how |
| Objectives    | Restore within the service tier target (asked from the user if no service tier is known; never assumed), notify within 15 minutes, identify the gap, keep controls       |
| Evidence      | The finding's quotes and links                                                                                                                                           |
| Remediation   | Proposed edit of the step to reference the replacement; retest with Lane C's engine                                                                                      |

All consequences are labelled "modelled from the finding", not observed behaviour. Same determinism and audit rules as the demo scenario (replay, fingerprint).

## Lanes

| Lane | Work                                                                                          | Depends on                               |
| ---- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Lead | `shared/graph/types.ts` contract; approvals; integration                                      | —                                        |
| A    | Graph builder from M3 analysis + JSM services; Teamwork Graph probe on `graph-test`           | Contract; owner approvals for new scopes |
| B    | Impact path section on the Readiness check                                                    | Contract                                 |
| C    | Scenario generator from a finding (pure), with tests                                          | M3 contract                              |
| D    | Teamwork Graph queries design, Rovo action contracts for M6 (`find-recovery-risks` reuses M3) | —                                        |

## Acceptance criteria

- M4: for MC-62, the impact path shows change → LegacyAuth → RB-AUTH-01 step 3 with the same confidence as M3; every edge expands to its source; no edge without evidence; a service or team appears only if a real source returned it.
- Teamwork Graph bonus: at least one real query returns data on the site and is shown in the app with its source; documented.
- M5 bridge: "Rehearse this change" on MC-62 produces a deterministic rehearsal whose decisions and evidence come from the finding, replays identically, and supports fix → retest.

## Approvals needed

1. `read:graph:*` scopes on a new `graph-test` environment.
2. Org admin confirmation for the demo site's organisation.
3. JSM read scopes (after the endpoint is verified).
4. `storage:app` (deferred to M6, as agreed).
