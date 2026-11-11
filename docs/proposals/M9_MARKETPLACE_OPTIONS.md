# M9 Marketplace options (research, 2026-11-11)

Status: **PROPOSAL. Nothing registered, listed or submitted.** Research by Lane 3 on `release/judged-full-validation`. Extends [M9_MARKETPLACE_ELIGIBILITY.md](M9_MARKETPLACE_ELIGIBILITY.md). Owner rule: **do not create a Jira-only replacement listing to qualify for the Marketplace bonus.** That option is therefore listed below only as excluded.

## Sources fetched today (2026-11-11)

| Page                                                                        | Result                                                                                                                                                                                                                                                                                         | Status                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| https://developer.atlassian.com/platform/forge/app-compatibility/           | "They can only be listed on Marketplace as paid apps; free listings are not supported" for multiple-app compatible apps with a required Atlassian app. Global Apps: "Required linking are not supported"; EAP; no listing terms stated                                                         | Verified (re-fetched)                                                                                                                       |
| https://developer.atlassian.com/platform/marketplace/partner-due-diligence/ | Required: "Business name, physical address, registration number and/or tax identification number", government ID for the primary contact, camera phone (Stripe Identity). Forms due in 14 days or the ticket is rejected. Page does not address sole proprietors and does not exempt free apps | Verified text; individual outcome **unverified**                                                                                            |
| https://developer.atlassian.com/platform/marketplace/become-a-partner/      | Individual developer may create a profile with their name; public-domain emails (Google, Yahoo) not approved, in the Partner Portal section                                                                                                                                                    | Verified earlier (2026-11-11); scope for listing **unverified**                                                                             |
| https://codegeist.devpost.com/                                              | HTTP 403 to automated fetch                                                                                                                                                                                                                                                                    | **Not verified.** Rules page must be read by the owner in a browser                                                                         |
| Web search for the 2026 rules                                               | No Codegeist 2026 official rules page found. A Devpost page titled "Codegeist 2025: Atlassian Williams Racing Edition" shows three bonuses (Runs on Atlassian, Rovo Apps, Rovo Dev) and no explicit Marketplace bonus                                                                          | **Conflicts with** [CODEGEIST_REQUIREMENTS.md](../CODEGEIST_REQUIREMENTS.md), which lists "Best Marketplace". Owner must confirm on Devpost |

## Questions

1. **Individual paid listing.** Individuals may create a partner profile. A paid-via-Atlassian listing also needs payout/tax details; the due-diligence page asks for a registration and/or tax id. Whether a personal tax id suffices, and in which countries, is **unverified**. A paid listing means licensing, pricing, billing and Atlassian's revenue share, all of which need owner decisions and are out of scope for this branch.
2. **Does a second app id qualify for the Marketplace bonus?** **Unverified.** No public text found says the listed app must be the same app id as the submitted project. Because the judged project and the listed app would share source but not id, a judge could treat it as a different product. Ask the organisers in writing before relying on it.
3. **Is a review ticket enough?** **Unverified.** The Devpost rules page could not be read. Earlier docs assume "listing link or review ticket"; treat this as an assumption until the rules text is quoted.
4. **Keeping the full Jira + Confluence product.** The manifest is `jira: required`, `confluence: optional`. Per the compatibility page, that can only be listed **paid**. Compliant paths that keep Confluence:
   - A. List the full app **as paid** (new app id, separate licensing). Feasible in principle; cost: licensing/billing setup, KYC with tax id, support obligations. Risk: high (policy, money, deadline).
   - B. Drop the Marketplace bonus and pursue Rovo Agent or MCP. Lowest risk. Recommended default.
   - C. Global Apps EAP: listing terms not stated; requires EAP signup. Unknown. Not recommended this late.
   - D (excluded by owner): Jira-only free listing.

## Feasibility, effort, risk

| Option                     | Feasible by 22 Dec | Effort                                                                                                                    | Main risks                                                                                                                                           |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A paid listing, new app id | Unlikely           | 3 to 4 weeks elapsed: KYC (14 day form window), tax/payout, listing assets, review 5 to 10+ business days, licensing code | Individual/tax eligibility unknown; review may not finish; listing blocks install-link sharing for that id; bonus eligibility of a second id unknown |
| B skip Marketplace         | Yes                | none                                                                                                                      | Forgoes one bonus                                                                                                                                    |
| C Global Apps EAP          | Unknown            | unknown                                                                                                                   | EAP, no listing terms                                                                                                                                |

## Decision deadline

**27 Nov 2026** for Option A at the latest (listing submission by about 7 Dec leaves ten business days of review). If the three unknowns (individual tax id, second-id eligibility, review-ticket sufficiency) are not answered in writing by then, choose Option B.

## Owner actions (no agent may do these)

- Read the Devpost rules and confirm whether a Marketplace bonus exists in 2026 and what proof it needs.
- Ask Marketplace/Developer Support the questions in the eligibility proposal plus: "does a free-or-paid listing under a different app id qualify the Codegeist project?"
- Decide A or B. No agent registers an app, accepts terms or submits.
