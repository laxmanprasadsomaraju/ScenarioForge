# M3 live test: change to recovery

Goal: prove, on real Jira and Confluence data, that ScenarioForge links a change to the runbook steps it breaks, with verbatim evidence, and that unrelated changes produce no findings.

Runs in the isolated `confluence-test` environment after the M3 build is integrated and deployed there. The `development` install is not changed.

## Deployment

- 2026-11-10: `m3/change-to-recovery` @ `1f53f77` deployed to `confluence-test` as app version 2.1.0 (minor: manifest identical to the approved M2 build, no new scopes). `development` unchanged at version 2.
- Test URL: https://one-atlas-cegq.atlassian.net/apps/full-page/99a01e9b-c4c3-4634-94c4-634f521b7087/scenarioforge

## How to create the issues in Jira

1. In Jira, select **+ Create** in the top bar.
2. **Space:** any space you can create work in (for example the one holding MC-10).
3. **Work type:** Task.
4. **Summary** and **Description:** paste exactly as given below. Paste the description as plain text; two sentences in one paragraph is fine.
5. Leave the status as **To Do** (a status such as Won't Do is treated as cancelled, by design).
6. Select **Create**. Repeat for issue B.
7. In ScenarioForge, open **Readiness checks** and select **Check recovery impact** on each new issue. New issues appear in the list straight away because it shows changes updated in the last 30 days.

## Synthetic Jira issues (owner creates; the app has read-only scopes)

Create these in any Jira space you can edit. Every summary starts with `[DEMO]`.

### Issue A: should produce a finding

- **Summary:** `[DEMO] Retire LegacyAuth backup SSO tenant`
- **Description:**

  > Synthetic change for ScenarioForge testing.
  >
  > We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.

- Expected: subject `legacyauth` (retire, replacement NimbusID); **suspected** finding on `[DEMO] RB-AUTH-01` step 3 (`authctl failover --target legacyauth`).

### Issue A, confirmed variant

Edit the `[DEMO] RB-AUTH-01` Confluence page and add a line: `Related change: <Issue A key>`. Re-run the check.

- Expected: the same finding becomes **confirmed** with basis "page mentions issue".

### Issue B: should produce no findings

- **Summary:** `[DEMO] Upgrade marketing email templates`
- **Description:** `Synthetic change. Refresh the email campaign templates.`
- Expected: `no-findings` or `not-assessed`, never a finding, and never shown as "ready".

### Existing issues (MC-10, MC-9, MC-7, MC-42)

- Expected: `not-assessed` (no retirement, replacement or migration recognised). Never a finding.

## Checks

| #   | Check                                             | Expected                                                                         | Result  |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| 1   | Readiness checks lists recent changes             | Live Jira data, issues A and B visible                                           | Pending |
| 2   | Check issue A                                     | Subject LegacyAuth, replacement NimbusID, verbatim sentence from the description | Pending |
| 3   | Finding on RB-AUTH-01 step 3                      | Suspected, side-by-side change text and step text, both linking to source        | Pending |
| 4   | Add `Related change: <key>` to the page, re-check | Confirmed, basis includes "page mentions issue"                                  | Pending |
| 5   | Check issue B                                     | No finding; message says this is not a readiness pass; coverage shown            | Pending |
| 6   | Check MC-42                                       | Not assessed with a reason                                                       | Pending |
| 7   | Monitoring for `confluence-test`                  | `analyzeChange` invocations, no errors                                           | Pending |
