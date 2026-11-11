# M9 proposal: Marketplace eligibility and listing (free app, individual owner)

Status: **PROPOSAL. Nothing registered, accepted or submitted.** Prepared 2026-11-11. Builds on [MARKETPLACE_PLAN.md](../MARKETPLACE_PLAN.md) and [marketplace/](../marketplace/).

## 1. Eligibility for an individual with a Gmail address

| Question                        | Official finding                                                                                                                                                                                                                                        | Status                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Can an individual be a partner? | "If you're an individual developer without a parent company, then simply create a partner profile using your name" — https://developer.atlassian.com/platform/marketplace/become-a-partner/ (re-read 2026-11-11)                                        | Verified                                                                                       |
| Gmail email                     | Same page: "We cannot approve submissions from public domain addresses such as those from Google or Yahoo." The sentence sits in the Partner Portal access section, which also requires "at least one paid-via-Atlassian app"                           | Verified text; **scope unclear** (Portal only, or listing too?)                                |
| Verification (KYC/KYB)          | "Partners must be Verified in order to obtain app approvals"; forms within 14 days; Stripe Identity; business name, address, registration and/or tax ID — https://developer.atlassian.com/platform/marketplace/partner-due-diligence/ (read 2026-11-09) | Verified 2026-11-09; **unverified** whether an individual without a tax/registration id passes |
| Free app                        | Free apps have no `licensing` object; listing guide applies — https://developer.atlassian.com/platform/marketplace/listing-forge-apps/                                                                                                                  | Verified 2026-11-09                                                                            |
| Community reports               | Business entity may be required (threads 97755, 101919)                                                                                                                                                                                                 | Unverified anecdote                                                                            |

### Exact questions for Developer and Marketplace Support

Open a ticket at https://ecosystem.atlassian.support/ **[unverified: current portal URL]**:

1. I am an individual developer (no company) with a Gmail Atlassian account. Can I create a Marketplace partner profile and list a **free** Forge app?
2. Does "We cannot approve submissions from public domain addresses" apply to app listing submissions, or only to Partner Portal access?
3. For partner verification, what do I enter for business name and registration/tax ID as an individual? Is a personal tax id acceptable, and in which countries?
4. Does a free app require the full KYC/KYB (Stripe Identity) before approval, or only paid apps?
5. If I list a second app id built from the same source as an app I share by installation link, is that acceptable?
6. Typical review time for a first free Forge app submitted in early December 2026?
7. Are Preview modules (`rovo:agent`, `rovo:mcp`) and Forge Realtime acceptable in a listed app? (Our listed build will not use them.)

**Stop rule:** if support says a private-domain email or a business entity is required and the owner cannot provide one by 27 Nov, drop the Marketplace bonus.

## 2. Two app ids

- Why: submitting an app for listing stops installation-link sharing (https://developer.atlassian.com/platform/forge/distribute-your-apps/). The existing app (`113a7a88-…`) stays the judged build.
- Register: owner runs `forge register "ScenarioForge for Jira"` in a throwaway copy of the repo (accepts Forge terms; changes the manifest app id in that copy only) — https://developer.atlassian.com/platform/forge/cli-reference/register/
- Separate everything: the new id has its own environments, installs, variables, storage and consent. Nothing moves between them.
- Same source: `app.id: ari:cloud:ecosystem::app/${SF_APP_UUID}` with a default for the judged id; the Marketplace deploy exports `SF_APP_UUID` from a gitignored `.marketplace-app-id`. Manifest variables are "not supported for `forge build`", so use `forge deploy` only — https://developer.atlassian.com/platform/forge/manifest-reference/variables/ . Implementing this is a manifest change and needs separate approval.
- Versioning: each app has its own Forge version sequence. Tag `judged-v*` and `listed-v*` separately on the same commits. The listed build ships the same four scopes; any scope added later is a major version and a new review (5–10 business days).

## 3. Listing checklist vs drafts

| Requirement                           | Draft                                                                     | Gap                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Name, tagline, category, description  | [LISTING.md](../marketplace/LISTING.md)                                   | Owner review; name "ScenarioForge for Jira" follows naming rule          |
| Logo, screenshots                     | LISTING.md screenshot plan                                                | Logo not made; screenshots not captured                                  |
| Privacy policy (public URL)           | [PRIVACY_POLICY.md](../marketplace/PRIVACY_POLICY.md)                     | Not published; needs a hosting URL and contact email                     |
| End User Terms                        | none                                                                      | Choose Atlassian standard agreement or write one                         |
| Documentation + support contact       | [SUPPORT_AND_DOCS.md](../marketplace/SUPPORT_AND_DOCS.md)                 | Not published; support contact must be registered in Developer Community |
| Privacy & Security tab, questionnaire | [SECURITY_SELF_ASSESSMENT.md](../marketplace/SECURITY_SELF_ASSESSMENT.md) | Owner must enter answers; incomplete info blocks review                  |
| Scope justification, no remote hosts  | SECURITY_SELF_ASSESSMENT.md                                               | Done for the four scopes                                                 |
| Accessibility                         | [ACCESSIBILITY.md](../marketplace/ACCESSIBILITY.md)                       | Audit pending (200% zoom, 600px, focus trap)                             |
| Versioning notes                      | [VERSIONING.md](../marketplace/VERSIONING.md)                             | Update once the listed app id exists                                     |
| Runs on Atlassian                     | none                                                                      | Run `forge eligibility` on the listed id after deploy                    |
| Partner account, agreement, 2FA, KYC  | [SUBMISSION_CHECKLIST.md](../marketplace/SUBMISSION_CHECKLIST.md) A–B     | All owner actions; none started                                          |
| Vulnerability scan                    | none                                                                      | `npm audit --omit=dev` result to record                                  |

## 4. Timeline to submit by ~7 Dec

| Date        | Step                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| 12 Nov      | Owner sends the support ticket (§1)                                                       |
| 12–20 Nov   | Partner profile, agreement, 2FA; wait for support answer                                  |
| by 20 Nov   | Go / no-go on eligibility (stop rule)                                                     |
| 20–27 Nov   | Logo, screenshots, publish privacy/docs/support pages; End User Terms                     |
| 23–27 Nov   | Manifest-variable change (separate approval); `forge register` in throwaway copy          |
| 30 Nov      | Judged production deploy (M10)                                                            |
| 1–4 Dec     | Listed app production deploy; `forge eligibility`; create listing; Privacy & Security tab |
| **≤ 7 Dec** | Submit; KYC ticket arrives on submission — complete forms within 14 days, ideally in 2    |
| 7–22 Dec    | Review rounds (plan 10–15 business days); paste ticket/listing link into Devpost          |

## APPROVAL REQUEST (M9 Marketplace)

```
APPROVAL REQUEST — M9 Marketplace eligibility and listing
Owner: please reply in your own words to approve or reject each line.
[ ] D1. I will ask Developer and Marketplace Support the seven questions in §1 and
        stop the Marketplace bonus if an individual/Gmail account cannot list by 27 Nov.
[ ] D2. I will create the partner profile, accept the Partner Agreement, enable 2FA
        and complete KYC myself (no agent accepts terms).
[ ] D3. Approve the manifest-variable change for app.id (default = judged app id).
[ ] D4. I will run `forge register "ScenarioForge for Jira"` in a throwaway copy and
        keep the new id in a gitignored .marketplace-app-id.
[ ] D5. Production deploy of the NEW app id with the same four scopes, free (no
        licensing), and submit it for listing by 7 Dec. The judged app id is never
        submitted.
```

## Verification 2026-11-12

Pages fetched by the docs lane on 2026-11-11 (session clock), recorded under the requested heading. Quotes are as returned by an automated fetch-and-extract tool; the owner should eyeball the two key sentences in a browser before acting. `developer.atlassian.com/platform/marketplace/app-compatibility/` and `/platform/forge/manifest-reference/compatibility/` returned **HTTP 404**; the app-compatibility page lives at https://developer.atlassian.com/platform/forge/app-compatibility/.

### (a) Free listing with Jira + Confluence compatibility

| Finding                                                  | Quote and context                                                                                                                                                                                                                                                                               | URL                                                                      | Status                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Multi-app apps with a required app cannot be listed free | Section "Multiple-app compatibility" → "Limitations and considerations": "Multiple-app compatible Forge apps with a required Atlassian app are subject to the following constraints:" first bullet: "**They can only be listed on Marketplace as paid apps; free listings are not supported.**" | https://developer.atlassian.com/platform/forge/app-compatibility/        | **CONFIRMED**                                     |
| Exactly one product required                             | Same list: "Only Jira and Confluence are supported. One must be required; the other can be optional." Also: "your Forge app must have one required Atlassian app"; "You can only have one required Atlassian app, which is defined in the `manifest.yml` file."                                 | same                                                                     | **CONFIRMED**                                     |
| Single site only                                         | "Currently multiple-app compatible Forge apps are restricted to a single site."                                                                                                                                                                                                                 | same                                                                     | CONFIRMED                                         |
| Global Apps (no required product)                        | "A new multiple-app compatibility feature is now available in EAP." "With Global Apps you can build a Forge app with no link or only optional links to an Atlassian app." "Required linking are not supported for Global Apps." Free/paid listing terms for Global Apps not stated              | same                                                                     | CONFIRMED text; listing terms **UNCERTAIN** (EAP) |
| Listing detects products from the manifest               | "it will detect which Atlassian apps it is compatible with based on the app's manifest"; "it will be installed in the required Atlassian app"; "Admins can also choose to connect it to any additional supported Atlassian apps during installation."                                           | https://developer.atlassian.com/platform/marketplace/listing-forge-apps/ | CONFIRMED                                         |
| Free apps have no license object                         | "The `license` object is only present for paid apps in the production environment."                                                                                                                                                                                                             | same                                                                     | CONFIRMED                                         |
| Listing stops console distribution                       | "Once you've listed an app on the Marketplace, you won't be able to distribute the app via the developer console." Sharing must be enabled before listing                                                                                                                                       | same                                                                     | CONFIRMED                                         |

**Consequence:** our manifest (`jira: required: true`, `confluence: required: false`) is a multiple-app compatible app with a required app, so a **free** listing of it is not supported. Options for the separate listed app id: (1) list **Jira-only** (remove the `confluence` compatibility block in the listed build; runbook reading then would not work there — needs code/manifest review and owner approval); (2) list it paid (contradicts the free plan, adds licensing and billing); (3) Global Apps EAP (uncertain, EAP). The judged app id is unaffected. Recommend (1) **only if** support confirms a Jira-only app can still call Confluence APIs on the same site (UNCERTAIN; the listing page's search summary said listed apps "aren't able to make API calls across different products", unverified on the page).

### (b) Individual with a Gmail address

| Finding                                       | Quote and section                                                                                                                                                                                                                                         | URL                                                                         | Status                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individuals may create a partner profile      | "Create your partner profile": "If you're an individual developer without a parent company, then simply create a partner profile using your name"                                                                                                         | https://developer.atlassian.com/platform/marketplace/become-a-partner/      | **CONFIRMED**                                                                                                                                                                           |
| Gmail restriction scope                       | Section on Partner Portal eligibility: "Marketplace Partners with at least one paid-via-Atlassian app and a private domain email address are eligible" … "We cannot approve submissions from public domain addresses such as those from Google or Yahoo." | same                                                                        | CONFIRMED text; it sits under **Partner Portal access**, which requires a paid app, so it does **not** on its face apply to listing a free app. Applicability to listing: **UNCERTAIN** |
| Verification applies to all uploaders         | "All Partners who want to upload an app to the Atlassian Marketplace will be assigned this ticket"; applies to "both new and existing Marketplace Partners" (enforced from 2 June 2025)                                                                   | https://developer.atlassian.com/platform/marketplace/partner-due-diligence/ | **CONFIRMED** (free apps not exempted; page does not distinguish free/paid)                                                                                                             |
| Required business data                        | Prerequisites: "Business name, physical address, registration number and/or tax identification number"; primary contact needs government ID and a camera phone; Stripe Identity (phone, email, selfie)                                                    | same                                                                        | CONFIRMED                                                                                                                                                                               |
| Deadline                                      | "You will need to complete and submit this step within two weeks (14 days), otherwise the ticket will be rejected."                                                                                                                                       | same                                                                        | CONFIRMED                                                                                                                                                                               |
| Rejection effect                              | "Partners with Rejected tickets won't be able to upload apps to the Atlassian Marketplace."                                                                                                                                                               | same                                                                        | CONFIRMED                                                                                                                                                                               |
| Individual without registration number passes | Page does not address individuals; "Any person employed at your organization can complete this step" assumes an organisation                                                                                                                              | same                                                                        | **UNCERTAIN**                                                                                                                                                                           |

### Questions for Developer and Marketplace Support (add to §1)

8. The app-compatibility page says multiple-app apps with a required app "can only be listed on Marketplace as paid apps; free listings are not supported." If I list a **Jira-only** free app, can it still read Confluence pages on the same site?
9. Are Global Apps (EAP) eligible for free Marketplace listings?
10. For partner verification as an individual with no business registration, is a personal tax id plus "and/or" sufficient, and is a Gmail contact email acceptable for the listing (not Partner Portal)?
