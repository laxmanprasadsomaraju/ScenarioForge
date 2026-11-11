# Final submission checklist

Deadline **22 Dec 2026, 12:00 PT** (verified on the Atlassian community announcement; Devpost still unverified: all Devpost pages returned HTTP 403 again on 2026-11-11, see [REQUIREMENTS.md](REQUIREMENTS.md)). Internal target **18 Dec**. **[OWNER]** = only the owner may do it.

## Devpost submission

- [ ] [OWNER] Confirm the rules in a browser ([REQUIREMENTS.md](REQUIREMENTS.md) owner list).
- [ ] [OWNER] Approve the production deploy of the judged build (recommended scope set: [PERMISSIONS_AUDIT.md](PERMISSIONS_AUDIT.md)).
- [ ] [OWNER] Set distribution to **Sharing**, generate the installation link (a new link disables the old one), paste into Devpost and [JUDGE_INSTALL_GUIDE.md](JUDGE_INSTALL_GUIDE.md).
- [ ] [OWNER] Judge-install test on a **second** site (not `one-atlas-cegq`, which expires 2027-02-07): follow the guide end to end, capture one dark and one narrow screenshot.
- [ ] [OWNER] Record the video per [STORYBOARD.md](STORYBOARD.md) (≤ 4:50); upload to YouTube as **public**; check captions.
- [ ] Write-up: problem, journey (Detect → Understand → Rehearse → Fix → Verify), how it's built, what is modelled, what's next. Agent drafts; owner edits.
- [ ] Category: Apps for Software Teams. Screenshots. Repository link if requested.
- [ ] [OWNER] Bonus (at most one wins): pick one with live evidence. Write a short bonus section citing the dated live-test doc.
- [ ] [OWNER] Marketplace bonus only: decide the two-app-ID strategy, partner KYC, submit by 1 Dec (latest 7 Dec), paste listing/ticket link ([../marketplace/SUBMISSION_CHECKLIST.md](../marketplace/SUBMISSION_CHECKLIST.md)).
- [ ] [OWNER] Decide judged build: four-scope ([../proposals/M10_JUDGING_RELEASE.md](../proposals/M10_JUDGING_RELEASE.md)) or feature-complete ([../proposals/M10_FEATURE_COMPLETE_RELEASE.md](../proposals/M10_FEATURE_COMPLETE_RELEASE.md)).
- [ ] [OWNER] Marketplace: free listings of Jira+Confluence (one required) apps are not supported per the Forge app-compatibility page; decide Jira-only listed build or drop the bonus (Verification 2026-11-12 in M9_MARKETPLACE_ELIGIBILITY.md).
- [ ] [OWNER] Submit on Devpost; check the confirmation email and the public project page.

## Dated plan

| Date           | Work                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Thu 12 Nov     | Owner confirms Devpost rules and Marketplace same-app wording; decides judged build contents and which bonus to chase            |
| 13–20 Nov      | Bonus proof: Rovo Phase 2 live test (owner approves AI + credits), or MCP / TWG per runbooks. Record a dated `*LIVE_TEST*` entry |
| 16–20 Nov      | Owner: Marketplace partner account and KYC, if pursuing                                                                          |
| 23–27 Nov      | Final security review, `npm audit`, log review (SECURITY_PRIVACY_CHECKLIST), pending UI checks (dark, 200% zoom, 600px)          |
| Mon 30 Nov     | **Owner approves production deploy**; deploy; enable Sharing; generate link                                                      |
| Tue 1 Dec      | Marketplace submission (separate app ID) if pursuing; judge-install test on a second site                                        |
| 2–4 Dec        | Fix anything the judge test finds (minor versions only)                                                                          |
| 7 Dec          | Latest Marketplace submission date                                                                                               |
| 7–11 Dec       | Record and edit the video; draft write-up                                                                                        |
| 14–16 Dec      | Owner review of video and write-up; upload video; fill Devpost draft                                                             |
| **Fri 18 Dec** | **Internal target: submit on Devpost**                                                                                           |
| 19–21 Dec      | Buffer; paste Marketplace ticket/listing link if it arrives late                                                                 |
| **Tue 22 Dec** | **Hard deadline 12:00 PT.** No changes to the production app after submission until judging ends                                 |

## During judging

- Do not regenerate the installation link or uninstall production.
- Watch `forge logs -e production` (read-only) for errors.
