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
- Expected (corrected 2026-11-10): **`not-assessed`**, because the change names nothing that is retired, replaced, migrated, renamed, disabled or upgraded, so there is no subject to search runbooks for. `no-findings` is reserved for changes whose subjects were searched for and whose runbooks were read without a conflicting step. Reporting "no conflicts found" here would claim a check that never ran (D6, D18). Never a finding and never "ready" in either case.

### Existing issues (MC-10, MC-9, MC-7, MC-42)

- Expected: `not-assessed` (no retirement, replacement or migration recognised). Never a finding.

## Checks

| #   | Check                                             | Expected                                                                         | Result                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Readiness checks lists recent changes             | Live Jira data, issues A and B visible                                           | **Passed** (owner): MC-62 and MC-63 listed as live Jira data                                                                                                                                                                                                             |
| 2   | Check issue A                                     | Subject LegacyAuth, replacement NimbusID, verbatim sentence from the description | **Passed** (owner, MC-62): LegacyAuth retired, replaced by NimbusID; exact quote shown                                                                                                                                                                                   |
| 3   | Finding on RB-AUTH-01 step 3                      | Suspected, side-by-side change text and step text, both linking to source        | **Passed** (owner, MC-62): "Suspected — text match" on RB-AUTH-01 step 3 (`authctl failover --target legacyauth`), exact Jira and Confluence quotes and links; coverage 1 found, 1 read, 0 not read                                                                      |
| 4   | Add `Related change: <key>` to the page, re-check | Confirmed, basis includes "page mentions issue"                                  | **Passed** (owner, MC-62): after adding `Related change: MC-62`, "Confirmed — explicit link", explanation names MC-62; quotes and links intact; coverage 1/1/0                                                                                                           |
| 5   | Check issue B                                     | No finding; message says this is not a readiness pass; coverage shown            | **Passed against corrected expectation** (owner, MC-63): "Not assessed", reason "No retirement, replacement or migration was recognised", coverage 0 found/read, no finding. The original row expected the no-findings wording; that expectation was wrong (see Issue B) |
| 6   | Check MC-42                                       | Not assessed with a reason                                                       | **Passed** (owner, MC-42): "Not assessed" with a reason, coverage 0, no fabricated conflict                                                                                                                                                                              |
| 7   | Monitoring for `confluence-test`                  | `analyzeChange` invocations, no errors                                           | **Partly verified (CLI)**: no resolver errors in `forge logs`; invocation counts not available from the CLI                                                                                                                                                              |

## Expectation change for check 5

The plan was internally inconsistent: the Issue B section allowed `no-findings` or `not-assessed`, while check 5 expected the "not a readiness pass" wording that only `no-findings` shows. The implementation's behaviour (`not-assessed` when no subject is recognised) is the safer one and matches the contract (`shared/analysis/types.ts`): a change with nothing to look for cannot be said to have "no conflicts". The expectation was corrected; the implementation was not changed.

## M3 acceptance (2026-11-10)

- Live, passed: 1, 2, 3, 4, 6; 5 against the corrected expectation.
- CLI only: 7 (no errors logged; invocation counts not checked in the console).
- Automated: 34 labelled synthetic cases (precision 1.000, recall 0.923), cancelled, historical, partial, replacement-only and ambiguous categories, exact-quote substring tests, end-to-end orchestration with the real engine.
- Evidence improvements after the live run (approved): finding carries the runbook page path, coverage lists exactly the pages checked, and the analysis carries the Jira summary and link.
