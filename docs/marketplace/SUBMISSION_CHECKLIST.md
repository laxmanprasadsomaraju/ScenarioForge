# Submission checklist (DRAFT, for owner review)

Legend: **[OWNER]** means only the owner may do this, because it involves an account, terms, identity or a production action. **[AGENT]** means it can be prepared in the repo without any approval.

## A. Eligibility (do first; stop if blocked)

- [ ] [OWNER] Ask Developer and Marketplace Support whether an individual with a public-domain (Gmail) email can pass partner verification and list a **free** app. Community reports suggest a business entity may be required (unverified).
- [ ] [OWNER] Confirm the Devpost Marketplace bonus wording, including whether a separate app id is acceptable.

## B. Partner account (owner only; no agent may accept terms)

- [ ] [OWNER] Atlassian account and organisation; developer space linked to the partner account.
- [ ] [OWNER] Create the partner profile.
- [ ] [OWNER] Accept the Marketplace Partner Agreement and Terms of Use.
- [ ] [OWNER] Enable two-step verification.
- [ ] [OWNER] Partner verification (KYC/KYB): Identity Information Collection form and Partner Security Questionnaire within 14 days, then Stripe Identity (ID document, selfie, phone), and business name, address and tax/registration id. This takes 2–3 business days.

## C. App

- [ ] [OWNER] Run `forge register "ScenarioForge for Jira"` in a **throwaway copy** of the repo (this accepts the Forge terms), and record the new UUID in a gitignored `.marketplace-app-id`.
- [ ] [OWNER] Production deploy of the Marketplace app id (approval required by CLAUDE.md).
- [ ] [OWNER] Run `forge eligibility` and record the result.
- [ ] [AGENT] Run `npm run verify`, `npm audit --omit=dev` and `forge lint -e production`, and record the results.
- [ ] [AGENT] Confirm the manifest has only the four read scopes and no egress. Do not add Teamwork Graph or Rovo to the listed build.

## D. Listing content

- [ ] [AGENT] Listing copy: [LISTING.md](LISTING.md). Owner review.
- [ ] [OWNER] Logo, plus screenshots captured per the plan.
- [ ] [OWNER] Publish the privacy policy at a public URL ([PRIVACY_POLICY.md](PRIVACY_POLICY.md)).
- [ ] [OWNER] End User Terms: choose Atlassian's standard customisable agreement or your own.
- [ ] [OWNER] Publish the support and documentation pages ([SUPPORT_AND_DOCS.md](SUPPORT_AND_DOCS.md)) and register a support contact in the Developer Community.
- [ ] [OWNER] Privacy & Security tab: answers from [SECURITY_SELF_ASSESSMENT.md](SECURITY_SELF_ASSESSMENT.md).
- [ ] [OWNER] Accessibility statement ([ACCESSIBILITY.md](ACCESSIBILITY.md)), only after the audit.

## E. Submit (owner only)

- [ ] [OWNER] Link the Forge app to the listing; check the app key mapping and that distribution is enabled.
- [ ] [OWNER] Submit. Note: a submitted app cannot be shared by installation link, which is why a separate app id is used.
- [ ] [OWNER] Respond to review rounds (target about 1 week for Forge; 10–15 business days per the guidelines), then paste the listing or ticket link into Devpost.

Target: submit by early December so review can finish before **22 Dec 2026, 12:00 PT**.
