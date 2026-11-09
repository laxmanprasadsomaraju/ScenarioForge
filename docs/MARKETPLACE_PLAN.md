# Marketplace plan

Prepared 2026-11-09 (Lane D). Owner decision: the **two-app-ID strategy is approved in principle**. The existing app is the judge build; a separate Marketplace app is built from the same source. Nothing has been registered, submitted or accepted. All facts below were read on the cited official pages on 2026-11-09, unless marked otherwise.

## 1. Verified requirements

### Eligibility of Forge apps and distribution

- A Forge app can be listed; the listing guide covers privacy and security, testing, licensing, distribution and review. https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- Distribution by installation link needs a production deploy and **Sharing** enabled in the developer console, and installing users must be site admins. "Apps with a manifest license, or submitted for Marketplace listing, can't be shared via installation link." https://developer.atlassian.com/platform/forge/distribute-your-apps/
- After listing, "you won't be able to distribute the app via the developer console". https://developer.atlassian.com/platform/marketplace/listing-forge-apps/

**This is why the judge build must be a different app ID from the listed app.**

### Free vs paid, and licensing

- Paid apps set `app.licensing.enabled: true` and deploy to production. A paid app cannot be installed from production until the listing is approved. Free apps have no `license` object. https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- **A free app does not need `licensing.enabled`.** Leave licensing off.
- What licensing would mean for Codegeist:
  - A licensed app can't be shared by installation link (distribute-your-apps page).
  - Production installs are blocked until approval.
  - Licence checks in the UI and resolvers would be required.
  - All three conflict with judge installation. **Recommendation: free listing.**
- The free/paid choice is hard to undo later. The rule "cannot switch FREE to PAID" was seen only for Atlassian Government Cloud (search summary of https://developer.atlassian.com/platform/marketplace/publish-and-list-agc-apps/). Commercial cloud is unverified.

### Partner onboarding (list only; nothing accepted)

1. **Create an Atlassian account and organisation, and set up the developer space for the partner account.** "Ensure the developer space is correctly setup for the corresponding Marketplace partner account." https://developer.atlassian.com/platform/marketplace/onboarding-hub/plan/register-as-an-atlassian-marketplace-partner/
2. **Create a partner profile.** An individual "can create a partner profile under your own name". https://developer.atlassian.com/platform/marketplace/become-a-partner/
3. **Accept the Marketplace Partner Agreement and Terms of Use.** Owner only. Lane D has not accepted and will not accept these. (Register page above.)
4. **Enable two-step verification.** (Register page above.)
5. **Partner verification (KYC/KYB).** "Partners must be Verified in order to obtain app approvals". https://developer.atlassian.com/platform/marketplace/partner-due-diligence/
   - The ticket is assigned when approval is requested.
   - The forms (Identity Information Collection and the Partner Security Questionnaire) must be submitted within 14 days, or the ticket is rejected.
   - Then Stripe Identity: ID document, selfie and phone.
   - Business verification runs asynchronously.
   - **Required data includes business name, address and registration and/or tax ID.** Same page.
   - Partner verification takes 2–3 business days. https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/
6. **Partner Portal access needs a paid app and a private-domain email.** "We cannot approve submissions from public domain addresses such as those from Google or Yahoo" (become-a-partner page). This applies to Partner Portal access. The listing itself is created in the Marketplace partner flow; whether a Gmail address blocks a **free** listing is **unverified**.

> **Risk for an individual entrant (unverified, community only).** Community threads report that verification requires a registered business entity ([97755](https://community.developer.atlassian.com/t/does-atlassian-no-longer-support-individual-developers-publishing-apps/97755), [101919](https://community.developer.atlassian.com/t/can-a-uk-sole-trader-no-limited-company-register-as-a-paid-marketplace-vendor/101919)). The official page asks for business details, but it does not say an individual is refused. **The owner should check this before investing in listing assets**, for example by asking Developer and Marketplace Support.
>
> If verification is impossible, the Marketplace bonus is blocked. The rules extract suggests a review ticket link may still count, but an approval may never come.

### Listing requirements

| Item                                 | Requirement                                                                                                                                            | Source                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata                             | Name, tagline, category, supported products, languages, long description                                                                               | https://developer.atlassian.com/platform/marketplace/onboarding-hub/launch/create-your-marketplace-listing-and-link-your-forge-app/                |
| Visual assets                        | Logo, screenshots; demo video optional. Approval guidelines: assets "recommended but not required for free apps"                                       | same; https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/                                                                |
| Privacy policy                       | Required; manually reviewed                                                                                                                            | approval guidelines; https://developer.atlassian.com/platform/marketplace/listing-forge-apps/                                                      |
| EULA or terms                        | End User Terms needed to transact with cloud customers; Atlassian offers a standard customisable agreement                                             | listing-forge-apps                                                                                                                                 |
| Documentation                        | The listing must reference setup and usage docs                                                                                                        | approval guidelines                                                                                                                                |
| Support contact                      | Required field; at least one partner contact registered in the Developer Community                                                                     | create-listing page; approval guidelines                                                                                                           |
| Privacy & Security tab               | "Incomplete compliance information will block your review"                                                                                             | create-listing page                                                                                                                                |
| App security questionnaire           | Fail-level answers block listing. The partner security questionnaire is informational                                                                  | https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/                                                               |
| Scope justification and remote hosts | List each scope and why; list remote hosts and the data sent                                                                                           | listing-forge-apps                                                                                                                                 |
| Personal data                        | GDPR compliance; flows to report and erase personal data; a DPA if acting as processor                                                                 | listing-forge-apps                                                                                                                                 |
| Data residency                       | If supported, list the in-scope End User data                                                                                                          | listing-forge-apps                                                                                                                                 |
| Runs on Atlassian                    | Automatic badge if Atlassian-hosted only, residency matches the host, no egress except analytics without in-scope data; check with `forge eligibility` | https://developer.atlassian.com/platform/marketplace/runs-on-atlassian/, https://developer.atlassian.com/platform/forge/cli-reference/eligibility/ |
| Naming                               | Trademark infringement means automatic rejection. "Jira App X" is rejected; "App X for Jira" is approved → **"ScenarioForge for Jira"**                | approval guidelines                                                                                                                                |
| Free-app usefulness                  | Must "provide some useful function in the Atlassian app 'as is'"                                                                                       | approval guidelines                                                                                                                                |
| No Basic auth                        | Public apps can't use Basic auth with Atlassian REST APIs (we use `asUser`)                                                                            | approval guidelines                                                                                                                                |
| Vulnerability scan                   | Critical and certain high findings block approval                                                                                                      | security workflow                                                                                                                                  |
| App key mapping                      | "A misconfigured app key or disabled distribution means customers can't install your app"                                                              | create-listing page                                                                                                                                |

### Review process and timelines

- Forge listing: "we aim to provide a decision within one week". https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- Security workflow: new submissions 5–10 business days; major version updates 5–10 business days; minor cloud updates instant; partner verification 2–3 business days. https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/
- Approval guidelines: "Approvals take 10-15 business days"; a few review rounds are common. https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/
- Community report of more than 10 business days pending with no feedback: https://community.developer.atlassian.com/t/two-forge-apps-pending-marketplace-review-for-10-business-days/99363 (unverified anecdote).

**Plan for 15 business days.** From Tue 1 Dec 2026 to Tue 22 Dec 2026 is 16 business days, ignoring holidays.

### Preview modules in listed apps

- Forge Preview features are "suitable and operationally supported for production apps" and "can be enabled on production environments". EAP features "can only be enabled on development environments". https://developer.atlassian.com/platform/forge/whats-coming/
- `rovo:skill` (Preview) says Preview apps deploy to development, staging and production. https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-skill/
- **Marketplace acceptance of Preview modules (`rovo:mcp`, Teamwork Graph API) is not stated anywhere I found: unverified.** Production use is allowed, which suggests listing is possible, but nothing confirms it.
- Conflict to resolve: the `requestTeamworkGraph` bridge reference still labels the method **EAP** with the old `read:graph:jira` scope (https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/requestTeamworkGraph/). The 15 Oct 2026 changelog and the "Call the Teamwork Graph API" page say **Preview** with per-object scopes. The newer pages are more likely correct, but if the API were EAP it could not run in production at all.
- **Recommendation:** submit the listing **without** Teamwork Graph scopes unless the TWG test (TEAMWORK_GRAPH_TEST_PLAN.md) has passed in a production deploy of the judge app. Adding them later is a major version, which needs a new 5–10 business day review.

## 2. Second app ID from the same source

### Facts

- `forge register` "updates the manifest with a new app ID". Running it on an already registered app gives a new ID and leaves the old registration intact. The app is "disconnected from all environments, stored variables, provider client secrets, and storage" of the previous ID. It has an `-y, --accept-terms` option, so **registering involves accepting terms (owner only)**. https://developer.atlassian.com/platform/forge/cli-reference/register/
- `forge deploy` has no option for an alternate manifest or app ID override. https://developer.atlassian.com/platform/forge/cli-reference/deploy/
- Manifest variables: `app.id: "ari:cloud:ecosystem::app/${APP_ID}"`, declared under `environment.variables`, optionally with a `default`. An exported variable overrides the default. They are evaluated only during CLI manifest parsing, **and are not supported for `forge build`**. https://developer.atlassian.com/platform/forge/manifest-reference/variables/

### Proposed mechanism (Lane A implements; not done here)

Use the **native manifest variable**, not a script that rewrites `manifest.yml`:

```yaml
# manifest.yml (proposal for Lane A, not applied)
app:
  id: ari:cloud:ecosystem::app/${SF_APP_UUID}
environment:
  variables:
    - key: SF_APP_UUID
      default: 113a7a88-0d52-4161-b72e-791a83bd9355 # judge build (existing app)
```

- **Judge build:** plain `forge deploy -e production`. It uses the default, the existing app.
- **Marketplace build:** run `scripts/deploy-marketplace.sh`, which reads the UUID from the gitignored `.marketplace-app-id` and runs `SF_APP_UUID=$(cat .marketplace-app-id) forge deploy -e production --non-interactive`. The script refuses to run if the file is missing, and prints which app it targets before deploying.
- `.marketplace-app-id` is listed in `.gitignore`. An app UUID is not secret, but keeping it out of the repo prevents accidental deploys of the listed app from CI or a contributor's machine.
- The repo never runs `forge register` in place. To create the Marketplace app, the owner runs `forge register "ScenarioForge for Jira"` in a **throwaway copy** of the repo, so the committed manifest is not rewritten. The owner then copies the new UUID into `.marketplace-app-id` and deletes the copy.
- Verify after each deploy: `forge environments list` and the developer console show the expected app.
- **Avoid `forge build`/`--tag` for the Marketplace build**, because variables are unsupported there.
- Fallback if variable substitution misbehaves: a script that writes a temporary copy of the manifest with `app.id` swapped. Because `forge deploy` has no `--manifest` flag, that would have to happen in a temporary directory copy of the repo, never by editing the tracked file.

Both apps then have their own installations, storage, environment variables and scopes consent. Data does not move between them, which is expected for a judge build.

## 3. Dated plan to an early-December submission

Today is Mon 9 Nov 2026. 13 Nov is an internal checkpoint only.

| Date (2026)       | Step                                                                                                                                                                                                    | Who            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Fri 13 Nov        | Internal checkpoint: confirm a Gmail account and an individual (no company) can pass partner verification (ask Developer and Marketplace Support), and read the rules for the Marketplace bonus wording | Owner          |
| Mon 16 Nov        | If clear: create the partner profile, accept the Partner Agreement, enable 2SV                                                                                                                          | Owner          |
| Mon 16 Nov        | Lane A: manifest variable for the app ID + `scripts/deploy-marketplace.sh` + `.gitignore` entry (PR, no deploy)                                                                                         | Lane A         |
| Fri 20 Nov        | Drafts: privacy policy, use of the Atlassian standard End User Terms, support contact, documentation page (Lane D drafts; owner publishes under their name)                                             | Lane D + Owner |
| Fri 20 Nov        | Draft scope justifications and the Privacy & Security answers from the final M6 manifest scope list                                                                                                     | Lane D         |
| Mon 23 Nov        | Freeze the scope list for the listing (§1 Preview note). `forge eligibility` clean on the judge app                                                                                                     | Lane A         |
| Thu 26 Nov        | US Thanksgiving; expect slower support                                                                                                                                                                  | n/a            |
| Fri 27 Nov        | Owner registers the Marketplace app (throwaway copy), deploys it to production with the script, enables Sharing, installs it on a fresh site and smoke-tests                                            | Owner + Lane A |
| Mon 30 Nov        | Listing assets: logo, 3–5 screenshots with demo data labelled, long description, docs link                                                                                                              | Lane D + Owner |
| **Tue 1 Dec**     | **Submit for listing (free).** Partner verification starts if not already triggered; forms are due within 14 days. Record the review ticket link                                                        | Owner          |
| Wed 2 – Fri 4 Dec | Complete KYC (Stripe Identity) quickly; answer the app security questionnaire                                                                                                                           | Owner          |
| Mon 7 Dec         | Latest acceptable submission date (12 business days to 22 Dec inclusive; below the 15-day conservative figure)                                                                                          | Owner          |
| 1–18 Dec          | Respond to review rounds within 1 business day. Minor updates to the listed app publish instantly; avoid major (scope/module) changes                                                                   | Owner + Lane A |
| Tue 22 Dec        | Devpost: give the listing link if approved, else the review ticket link                                                                                                                                 | Owner          |

## 4. Owner action list (only the owner can do these)

1. Ask Developer and Marketplace Support whether an individual with a Gmail address can pass partner verification and list a free app. Stop here if the answer is no.
2. Read the Devpost Marketplace bonus wording and confirm whether a separate app ID is acceptable.
3. Create the partner profile, accept the Marketplace Partner Agreement and Terms of Use, and enable 2SV.
4. Run `forge register` for the Marketplace app in a throwaway copy, accepting the Forge terms.
5. Publish the privacy policy, terms and support contact under the owner's name.
6. Submit the listing, complete KYC (Stripe Identity, ID document, selfie), and answer the security questionnaires.
7. Respond to review feedback; paste the ticket or listing link into Devpost.

## 5. Unverified

- Whether a free listing requires a business entity or a private email domain.
- Whether Preview modules and the Teamwork Graph API are accepted in listed apps, and the EAP vs Preview conflict on the bridge page.
- Real current review times.
- Whether the Devpost Marketplace bonus requires the same app ID as the judged submission.
- Whether a free → paid switch is restricted for commercial cloud.
