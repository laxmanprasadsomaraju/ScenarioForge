# Codegeist 2026 rules checklist

Prepared 2026-11-09 (Lane D). Status reflects the repository on branch `feature/m0-m1-foundation` plus Lane D docs.

## Access to the rules page

**The Devpost pages are still blocked for automated reading.** On 2026-11-09, WebFetch returned HTTP 403 for:

- https://codegeist2026.devpost.com/rules
- https://codegeist2026.devpost.com/rules?ref_content=default&ref_feature=challenge&ref_medium=portfolio
- https://codegeist2026.devpost.com/
- https://codegeist2026.devpost.com/details/dates
- https://codegeist2026.devpost.com/resources

The Chrome extension was not connected, so the page could not be read through the owner's browser either. A scripted download was refused by the sandbox and was not attempted again.

So every item sourced from Devpost below is marked **"unverified – from search extract"**. Its short quote is the text a search engine returned for the rules page, not text read on the page itself. **The owner must open the rules page in a browser and tick the "Confirmed on page" column.** Items with an Atlassian URL were read directly on that page.

Legend: ☐ not done · ◐ in progress · ☑ done.

## 1. Dates and deadlines

| ✓   | Requirement                                    | Status                                                  | Source                                                                                                                                        | Confirmed on page |
| --- | ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| ☐   | Submit by 22 Dec 2026, 12:00 PT                | Planned. Internal target: 18 Dec                        | "December 22, 2026 at 12:00 PM PT" – https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 | ☐                 |
| ☐   | Submission period opened 27 Oct 2026, 09:00 PT | Our repo started 2026-11-09, within the period          | unverified – from search extract ("Tuesday, October 27, 2026 (9:00 am Pacific Time)") – https://codegeist2026.devpost.com/rules               | ☐                 |
| ☐   | Judging period                                 | DECISIONS/CONTEST_COMPLIANCE assume 5 Jan to 3 Feb 2027 | unverified. No extract found, and the owner's dates were not re-checked                                                                       | ☐                 |
| ☐   | Winners announcement date                      | Unknown                                                 | unverified                                                                                                                                    | ☐                 |

## 2. Participant eligibility

| ✓   | Requirement                                             | Status                  | Source                                                                                                                                                                              | Confirmed on page |
| --- | ------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| ☐   | Age of majority in country of residence                 | Owner to confirm        | unverified. Only third-party aggregators state it, and the rules extract did not include it                                                                                         | ☐                 |
| ☐   | Not resident in an excluded country or region           | Owner to confirm        | unverified. Aggregators disagree on the list                                                                                                                                        | ☐                 |
| ☐   | Not an Atlassian/Devpost employee or otherwise excluded | Owner to confirm        | unverified                                                                                                                                                                          | ☐                 |
| ☐   | Solo or team entry; a team appoints a Representative    | Solo (owner)            | unverified – from search extract ("Representative must meet the eligibility requirements") – https://codegeist2026.devpost.com/rules                                                | ☐                 |
| ☐   | Free Atlassian Cloud developer site available           | Using a Forge demo site | "Grab your free Atlassian Cloud developer site" – https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 (search-snippet wording) | n/a               |

## 3. Project requirements

| ✓   | Requirement                                                           | Status                                                          | Source                                                                                                                                                                                                                                                                    | Confirmed on page |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| ◐   | Built on Forge, with a manifest and at least one Forge module         | Done (`global:fullPage`, function)                              | unverified – from search extract (Forge manifest and at least one module) – https://codegeist2026.devpost.com/rules                                                                                                                                                       | ☐                 |
| ☑   | New, or updated/rebuilt on Forge after the period opened              | New repository created 2026-11-09                               | unverified – from search extract ("newly created by the Entrant, not yet published") – https://codegeist2026.devpost.com/rules                                                                                                                                            | ☐                 |
| ☐   | Installable in a judge's test environment via an installation link    | Not done. Needs a production deploy and Sharing enabled (M10)   | unverified – from search extract ("capable of being successfully installed in a judge's test environment") – https://codegeist2026.devpost.com/rules. How to create the link: https://developer.atlassian.com/platform/forge/distribute-your-apps/#start-sharing-your-app | ☐                 |
| ☐   | Runs consistently and works as shown in the video and description     | M10 judge-install test                                          | unverified – from search extract ("function as depicted in the video") – https://codegeist2026.devpost.com/rules                                                                                                                                                          | ☐                 |
| ☐   | Instructions for every configuration step and integration judges need | Not done (M10 judge guide)                                      | unverified. A community post quotes the rules as "instructions for every configuration step and integration the judges need" – https://community.developer.atlassian.com/t/codegeist-2026-two-installation-links-and-which-bitbucket-plan-do-judges-test-on/103715        | ☐                 |
| ☐   | Testing access: app ID and working link through judging               | Demo site expires 2027-02-07. Judges install on their own sites | unverified. App ID was asked for in 2025 and is not confirmed for 2026                                                                                                                                                                                                    | ☐                 |
| ☐   | Runs on Atlassian required?                                           | Kept eligible by design (D1). Not confirmed as a rule           | unverified. Not mentioned in the announcement                                                                                                                                                                                                                             | ☐                 |
| ☐   | Third-party SDKs, APIs and data used under licence                    | Only Atlassian SDKs and open-source packages                    | unverified                                                                                                                                                                                                                                                                | ☐                 |

## 4. Submission contents

| ✓   | Requirement                                                          | Status                | Source                                                                                                                                                                         | Confirmed on page |
| --- | -------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| ☐   | Demo video under 5 minutes, public on YouTube                        | Not started (M10)     | unverified – from search extract (video under five minutes, publicly visible on YouTube) – https://codegeist2026.devpost.com/rules                                             | ☐                 |
| ☐   | Judges may stop watching after 3 minutes, so the story lands by 3:00 | Plan the video for it | unverified. Only a third-party note (https://github.com/JannetEkka/DSProjects/issues/86) and a search summary                                                                  | ☐                 |
| ☐   | Text description of features and functionality                       | Not started           | unverified                                                                                                                                                                     | ☐                 |
| ☐   | Installation link                                                    | See §3                | see §3                                                                                                                                                                         | ☐                 |
| ☐   | Category selection (Apps for Software Teams)                         | Chosen                | Tracks "Software teams, Business teams, and Specialized industries" – https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 | ☐                 |
| ☐   | Bonus prize opt-in fields and links (e.g. Marketplace ticket)        | Not started           | unverified                                                                                                                                                                     | ☐                 |
| ☐   | Repository or code access (public or shared with judges?)            | Unknown               | unverified                                                                                                                                                                     | ☐                 |
| ☐   | English, or with English translation                                 | English               | unverified                                                                                                                                                                     | ☐                 |

## 5. Prizes and bonus eligibility

| ✓   | Requirement                                                                                        | Status                                          | Source                                                                                                                                                                                      | Confirmed on page |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| n/a | Bonus awards of $1,500 each: Rovo Agent, MCP App, Teamwork Graph, Marketplace                      | Info                                            | "$1,500 each for Best Rovo Agent, Best MCP App, Best Teamwork Graph Integration" – https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 | ☐                 |
| n/a | At most one Grand Prize and one Bonus Prize per submission                                         | Info                                            | unverified – from search extract ("can win up to one Grand Prize and one Bonus Prize") – https://codegeist2026.devpost.com/rules                                                            | ☐                 |
| ☐   | Best Agents: `rovo:agent`, `rovo:agentConnector`, or reusable skills/actions other agents can call | M6 (design in BONUS_FEASIBILITY §2)             | unverified – from search extract – https://codegeist2026.devpost.com/rules                                                                                                                  | ☐                 |
| ☐   | Best MCP: tools exposed via the Atlassian MCP server with `rovo:mcp`                               | M9                                              | unverified – from search extract ("exposes tools via the Atlassian MCP server using the rovo:mcp module") – https://codegeist2026.devpost.com/rules                                         | ☐                 |
| ☐   | Best Teamwork Graph: connects data into the graph and/or consumes the Teamwork Graph API           | M4/M9. Test plan in TEAMWORK_GRAPH_TEST_PLAN.md | unverified – from search extract – https://codegeist2026.devpost.com/rules                                                                                                                  | ☐                 |
| ☐   | Best Marketplace: published, or submitted for listing; give the listing link or review-ticket link | Plan in MARKETPLACE_PLAN.md                     | unverified – from search extract ("published to the Marketplace or submitted for listing") – https://codegeist2026.devpost.com/rules                                                        | ☐                 |
| ☐   | **Must the listed/ticketed app be the same app ID as the submission?**                             | **Open question**                               | **unverified. No extract addresses it.** Atlassian docs say a submitted app can't use installation links (https://developer.atlassian.com/platform/forge/distribute-your-apps/)             | ☐                 |

**Same-app question, our position.** The rules extract only says the app must be "published to the Marketplace or submitted for listing". Nothing found says the listed app must share an app ID with the judged build. Atlassian's own guidance accepts that one codebase can be several Forge apps with separate listings ("create two Forge apps using the same code base", https://developer.atlassian.com/platform/forge/migrating-a-forge-app-to-support-multiple-atlassian-apps/, per the search summary; not read directly).

To be safe:

1. The owner reads the Marketplace bonus text on the rules page.
2. If it is ambiguous, the owner asks in the Devpost discussion or the `codegeist-2026` community tag before submitting.
3. The submission states plainly that the listed app is built from the same source commit, under a separate app ID, because Marketplace submission disables installation links.

## 6. Judging

| ✓   | Item                                                                                                                                     | Status                                   | Source                                                                                                   | Confirmed on page |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------- |
| ☐   | Stage One: pass/fail check that requirements are met                                                                                     | Follow §3–§4                             | unverified                                                                                               | ☐                 |
| ☐   | Stage Two: equally weighted criteria                                                                                                     | Criteria names unknown                   | unverified – from search extract ("equally weighted criteria") – https://codegeist2026.devpost.com/rules | ☐                 |
| ☐   | Criteria names (2025 used Quality of the Idea, Implementation, Potential Impact; a third-party 2026 note says five criteria at 20% each) | Do not plan around these until confirmed | unverified                                                                                               | ☐                 |
| ☐   | Bonus prizes judged on the same criteria?                                                                                                | Unknown                                  | unverified                                                                                               | ☐                 |

## 7. Intellectual property, originality and conduct

| ✓   | Requirement                                                        | Status                                               | Source                                                                             | Confirmed on page |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------- |
| ☑   | Original work by the entrant                                       | Independent personal project (CONTEST_COMPLIANCE.md) | unverified                                                                         | ☐                 |
| ☐   | Entrant keeps IP; licence granted to sponsor/Devpost for promotion | Owner to read the clause                             | unverified                                                                         | ☐                 |
| ☑   | No employer code, data or credentials                              | Repo-local Git identity (D12)                        | Internal policy                                                                    | n/a               |
| ☐   | Submitting means agreeing to the rules                             | Owner reads the full rules before submitting         | unverified – from search extract ("constitutes agreement to these official rules") | ☐                 |
| ☐   | Each submission substantially different from the entrant's others  | One submission planned                               | unverified. Only a community quote                                                 | ☐                 |

## Owner actions on this checklist

1. Open https://codegeist2026.devpost.com/rules in a browser and fill in the "Confirmed on page" column. Capture exact wording for: video length, judging criteria, the Marketplace bonus (same app or not), testing access, and how long the app must stay installable.
2. Confirm personal eligibility (age, residence, employer).
3. Confirm the judging dates. The demo site expires 2027-02-07, and the judge build must not depend on it.
