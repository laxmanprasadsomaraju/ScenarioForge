# Five-minute demo storyboard (MC-62)

Target length **4:40**, hard limit 4:50 (rule says under 5 minutes, unverified; see [REQUIREMENTS.md](REQUIREMENTS.md)). The core story lands by **3:00**. Setup: [DEMO_SETUP.md](DEMO_SETUP.md).

**Honest-claims rules for narration:** say "modelled" or "simulated" for every rehearsal time. Never say "prevents incidents", "guarantees recovery" or "certifies". The data is synthetic and labelled `[DEMO]`. Conditional segments (marked **[C]**) are recorded only with live evidence; otherwise the fallback runs.

## Shot list

| #   | Time      | Stage         | Screen                                                                                               | Narration (plain English)                                                                                                                                                                                                                                |
| --- | --------- | ------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:20 | Hook          | MC-62 in Jira, then RB-AUTH-01 step 3 in Confluence, side by side                                    | "This Jira change retires LegacyAuth. This runbook still tells on-call to fail over to LegacyAuth. Nobody notices until the outage. ScenarioForge connects the two before then."                                                                         |
| 2   | 0:20–0:50 | Detect        | ScenarioForge → Readiness checks → Check recovery impact on MC-62                                    | "It reads the change from Jira as you, finds recovery runbooks in Confluence, and reads only what you can see. All of this is synthetic demo data."                                                                                                      |
| 3   | 0:50–1:30 | Understand    | Finding card: Suspected, quotes, coverage; then add `Related change: MC-62` and re-check → Confirmed | "A deterministic engine, not an AI, found it: step 3 depends on what this change removes. Both quotes are exact and linked. Once the runbook names the change, it is Confirmed. When there's nothing to check, it says Not assessed, never 'all clear'." |
| 4   | 1:30–1:55 | Understand    | Impact path graph                                                                                    | "Here is the path: change, system, runbook step, page. Service and owning team stay 'not assessed' because we don't have that source yet. We don't invent them."                                                                                         |
| 5   | 1:55–2:45 | Rehearse      | Rehearse this finding, 30-minute target, follow step 3 as written                                    | "Now rehearse the outage on a simulated clock. Following the runbook as written fails at step 3. In this model, recovery takes 26 simulated minutes and misses the notify deadline. These are modelled numbers, not measurements."                       |
| 6   | 2:45–3:10 | Fix           | Approve only "replace LegacyAuth with NimbusID in step 3"; remediation request preview               | "The fix is a preview. Nothing is written to Jira or Confluence without a person approving it."                                                                                                                                                          |
| 7   | 3:10–3:40 | Verify        | Targeted retest → 11 simulated minutes, 4/4, "Gap resolved"; report                                  | "A targeted retest runs only the changed step. In the model, recovery is 11 minutes and every objective is met. The report keeps the evidence, timeline and fix."                                                                                        |
| 8   | 3:40–4:10 | Bonus **[C]** | Rovo: ask Recovery Investigator "What recovery risks does MC-62 create?"                             | "Rovo can explain the same finding and cite it. It can't create or change findings; the engine owns them." **Fallback:** Settings page showing read-only scopes: "Everything runs as you, with four read-only permissions."                              |
| 9   | 4:10–4:25 | Bonus **[C]** | One of: MCP client call / Teamwork Graph owning team / Crisis room / created work item               | Only the one with live evidence, one sentence. **Fallback:** dark mode and narrow-window drawer: "It follows Jira's theme and works in a narrow window."                                                                                                 |
| 10  | 4:25–4:40 | Close         | Command center / title card                                                                          | "ScenarioForge: one real change, one rehearsal, a fix you approve, and a retest that shows the gap is closed. Built on Forge, read-only by default."                                                                                                     |

## Not to show

- Mocked Rovo replies, the crisis-room "planned" screen presented as working, or any created Jira item that was not really created.
- Account names, emails or site admin pages.

## Recording notes

- Record each shot separately; cut on actions. Keep cursor movement slow.
- Captions on (YouTube auto-captions reviewed by hand).
- Re-time after editing; if over 4:50, cut shot 9 first, then shot 4.
