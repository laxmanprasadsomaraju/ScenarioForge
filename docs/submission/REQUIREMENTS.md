# Codegeist 2026 requirements (verification pass)

Checked 2026-11-11 (Lane M10) from `m10/submission-prep`, based on `integration/lanes-1` @ `7a52db8`. This page records what could be read directly, what could not, and what the owner must confirm in a browser. Earlier detail: [../CONTEST_RULES_CHECKLIST.md](../CONTEST_RULES_CHECKLIST.md), [../CONTEST_COMPLIANCE.md](../CONTEST_COMPLIANCE.md).

## Fetch log (2026-11-11)

| URL                                                                                                      | Result                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------- |
| https://codegeist2026.devpost.com/rules                                                                  | **HTTP 403** (not read)   |
| https://codegeist2026.devpost.com/details/dates                                                          | **HTTP 403** (not read)   |
| https://codegeist2026.devpost.com/resources                                                              | **HTTP 403** (not read)   |
| https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 | Read                      |
| https://developer.atlassian.com/platform/forge/distribute-your-apps/                                     | Read                      |
| Web search "Codegeist 2026 devpost rules video installation link judging period"                         | No Codegeist 2026 results |

Devpost blocks automated reads, as it did on 2026-11-09. **Nothing below that comes from Devpost has been verified.**

## Verified (read on the page today)

| Fact                                                                                                                                                                                                                       | Source                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Deadline: "December 22, 2026 at 12:00 PM PT"                                                                                                                                                                               | https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 |
| Tracks: Software teams, Business teams, Specialized industries                                                                                                                                                             | same                                                                                                     |
| Bonus awards: $1,500 each for Best Rovo Agent, Best MCP App, Best Teamwork Graph Integration, Best Marketplace Published App                                                                                               | same                                                                                                     |
| Prize pool $120,000 USD; solo or team entries; free Atlassian Cloud developer site; questions under the `codegeist-2026` tag                                                                                               | same                                                                                                     |
| The announcement does not link to a rules document                                                                                                                                                                         | same                                                                                                     |
| Installation links need a **production** deploy and distribution set to **Sharing** (or Sharing within organization). Only site admins can install. Generating a new link disables the old one, and this cannot be undone. | https://developer.atlassian.com/platform/forge/distribute-your-apps/                                     |
| "Once an app has been submitted for listing on Marketplace, or has a license in the app manifest, it can't be shared via installation link." Sharing-within-organization apps can't be listed.                             | same                                                                                                     |
| "Sharing within organization" blocks installers outside the owner's organisation, so judges need **Sharing**, not the org-only option                                                                                      | same                                                                                                     |

## Unverified (search extracts or older notes; owner must confirm)

| Item                                                                             | Current assumption                                     | Where it came from                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Submission period opened 27 Oct 2026, 09:00 PT                                   | Yes                                                    | Search extract of /rules (CONTEST_RULES_CHECKLIST §1) |
| Judging 5 Jan – 3 Feb 2027                                                       | Yes                                                    | Earlier notes, never read on the page                 |
| Winners announcement date                                                        | Unknown                                                | none                                                  |
| Demo video under 5 minutes, public on YouTube                                    | Yes; we plan for ≤ 4:50                                | Search extract                                        |
| Judges may stop after 3 minutes                                                  | Plan for the story to land by 3:00                     | Third-party note only                                 |
| Installation link that works in a judge's environment through judging            | Yes                                                    | Search extract                                        |
| Instructions for every configuration step and integration the judges need        | Yes ([JUDGE_INSTALL_GUIDE.md](JUDGE_INSTALL_GUIDE.md)) | Community-forum quote                                 |
| App must work as shown in the video and description                              | Yes                                                    | Search extract                                        |
| At most one Grand Prize and one Bonus Prize per submission                       | Yes                                                    | Search extract                                        |
| Bonus definitions (rovo:agent / rovo:mcp / Teamwork Graph API / Marketplace)     | As in CONTEST_RULES_CHECKLIST §5                       | Search extract                                        |
| Marketplace bonus: must the listed app be the **same app ID** as the judged one? | Unknown; we plan for two app IDs from one commit       | No source addresses it                                |
| Judging criteria names and weights                                               | Unknown ("equally weighted criteria")                  | Search extract                                        |
| Repository access required? Eligibility (age, country, employer)                 | Unknown                                                | none                                                  |

## Owner: confirm these in a browser (about 15 minutes)

1. Open https://codegeist2026.devpost.com/rules and copy the exact wording for: deadline and time zone, video length and hosting, the installation-link/testing-access clause and **how long the app must stay installable**, judging criteria.
2. Same page: the Marketplace bonus text. Does it accept a listing or review ticket for a **separate app ID** built from the same code? If unclear, ask under the `codegeist-2026` tag before 1 Dec.
3. https://codegeist2026.devpost.com/details/dates: judging and winners dates.
4. The submission form fields: is an app ID, repository link or test credentials requested? Is there a bonus opt-in field?
5. Your own eligibility (age, residence, employer).
6. Tick the "Confirmed on page" column in [../CONTEST_RULES_CHECKLIST.md](../CONTEST_RULES_CHECKLIST.md).
