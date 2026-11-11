# UI redesign, Phase A: audit and design direction

Prepared 2026-11-10 on branch `ui/redesign-audit` (from `integration/lanes-1` @ `b728437`). **Audit and direction only: no application code changed.** Phases B to E implement it.

Journey the redesign serves: **Detect → Understand → Rehearse → Fix → Verify.** Reference story: MC-62 retires LegacyAuth; RB-AUTH-01 step 3 still uses it; first rehearsal 26 simulated minutes, 3 of 4 objectives; targeted retest 11 simulated minutes, 4 of 4, "Gap resolved" (modelled, not measured; docs/M4_M5_LIVE_TEST.md).

Non-negotiables carried from D5, D6, D15, D18 and the Hallmark Floor: no invented data or metric; a KPI appears only when it is computable from data the user can read; "Not assessed" never looks like success; synthetic and modelled content is labelled where it appears.

## 0. Evidence used

- Screenshots: `/private/tmp/claude-501/-Users-laxmanprasadsomaraju-Desktop-ScenarioForge/ca170f9b-e32e-42d0-9ddc-eaf16c12d125/scratchpad/ui-audit-shots/` (121 PNGs, full-page). Names are `<nn>-<screen>-<state>-<light|dark>-<width>.png`; this doc cites them without the folder.
- Capture script: `…/scratchpad/render/audit.mjs` (puppeteer-core with local Chrome, dev server `SF_PREVIEW=1 npx vite --port 3500`, `?preview=fixtures|empty|error`). The server was stopped afterwards.
- **How Jira theming was emulated.** The preview bridge stub rejects `view.theme.enable()`, so out of the box the preview shows only the literal fallbacks in `tokens.css` (`09-overview-fallbacks-only-1440.png`). For the light and dark sets the script reads `static/app/node_modules/@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-light.js` / `atlassian-dark.js` (each exports the ADS token CSS as a string), injects it as a `<style>`, and sets `html[data-color-mode="light|dark"][data-theme="light:light dark:dark spacing:spacing typography:typography"]`, which is the attribute pair those token selectors match and what Forge sets inside Jira. Probed values: light `--ds-surface #FFFFFF`, `--ds-text #292A2E`; dark `--ds-surface #1F1F21`, `--ds-text #CECFD2` (`probes.json`).
- Widths: every route and state at 1440 and 375, light and dark; Overview also at 768, 1024 and 1920. No horizontal overflow was detected at any captured width.
- Static review of `static/app/src/**` (33 files) and `static/app/test/**` (8 suites).
- Hallmark sloplint on the current tree: `0 FAIL, 0 REFLEX, 0 WARN across 37 files` (`--scope app --genre modern-minimal`). The current UI is clean at the Floor level. Its problems are structural, informational and visual hierarchy, which sloplint does not measure.

## 1. Skills inventory

| Skill                                                                    | Status            | How it is used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hallmark** (`~/.claude/skills/hallmark`, v2.0.0)                       | Installed, read   | Binding. The Floor (16 rules) applies to every phase. `references/flow.md` § App screens governs: theme lends palette/faces/radius only; accent marks primary action, selection and state only; sidebar earned (>7 destinations) and collapses under 60rem; controls 32 to 40px with 44px hit; four states per data region; state in the URL; motion is state only; figures are the product's own; one signature object. `docs/DESIGN.md` is the locked system per pre-flight, so this redesign **evolves DESIGN.md** rather than dealing a theme. sloplint gates every phase. |
| **Atlassian Forge skills** (`atlassian-forge-skills/forge-skills 0.1.0`) | Installed, read   | `forge-app-builder` → `references/custom-ui.md`: use ADS tokens/components/icons in Custom UI, ADS MCP first, official ADS docs as fallback (no ADS MCP is connected in this session, so official docs were fetched). Confirm CSP before fonts or remote assets. `forge-app-review` before any deploy of the redesign; `forge-security-review` for any theme script (no `eval`, no remote CSS). No other ADS-specific skill exists in the plugin.                                                                                                                              |
| Anthropic Frontend Design                                                | **Not installed** | Not used. Not installed per instruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| UI UX Pro Max                                                            | **Not installed** | Not used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Frontend UI Engineering                                                  | **Not installed** | Not used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Vercel Web Design Guidelines                                             | **Not installed** | Not used; WCAG 2.2 AA and Hallmark gates cover the same ground here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Vercel React Best Practices                                              | **Not installed** | Not used; performance rules in §2.5 and §8 are derived from the measured bundle instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Also available in the session but out of scope: `dataviz` (to be loaded in Phase C before drawing the before/after comparison and any Overview figure), Figma/Paper MCP (not used: no design file was requested).

## 2. Current state audit

### 2.1 Top 10 problems (ranked by harm to the journey)

1. **Overview answers no question.** It shows a static six-step "readiness loop" with milestone jargon ("Planned for M8") and a large "Not assessed" heading that is the same weight and colour as any headline, three explanatory paragraphs and a recent-issues table (`01-overview-fixtures-light-1440.png`). Nothing tells the user what to do next, and the loop is stale: stages 5 and 6 (remediation, retest) exist today.
2. **The live-data tag uses success colours.** `.origin-live` is `--color-success-soft` / `--color-success` (`app.css:180`). "Live Jira data" therefore reads green, like a pass, next to "Not assessed" (`01-overview-fixtures-*.png`, `04d-check-not-assessed-light-1440.png`). That violates the spirit of D6.
3. **No context survives navigation or reload.** The selected change (`changeSelection.tsx`), the rehearsal source and all completed exercises (`exercises.tsx`) live in React state. A readiness check, rehearsal or report cannot be linked, refreshed or reopened. The deep-link lane fixes the routing half; the visual design must assume addressable sub-routes.
4. **The after-action report is a 4,729px scroll at 1440 (5,218px at 375)** with no summary hierarchy. The "Scenario rule: modelled outcomes" quote repeats under every decision, and the Jira work-item draft is inlined at full length below the fixes (`05d-sim-debrief-dark-1440.png`, `05f-sim-retest-report-light-375.png`). The retest verdict, the product's payoff, is one heading among many.
5. **No before/after comparison as an object.** The 26 → 11 minute, 3/4 → 4/4 improvement is shown only as a small table inside "Retest verdict" (`RetestVerdict.tsx`); first-run minutes and objectives are not side by side with the retest's. The Verify step has no signature.
6. **The readiness check is a long, flat document** (2,641px at 1440, `04b-check-findings-light-1440.png`): the answer, findings, rehearse form, impact path, subjects and coverage all have equal weight. The primary action ("Rehearse this finding") sits mid-page behind a required free-text field with a disabled button. Coverage, which qualifies the answer, sits last.
7. **Milestone jargon and stale copy in the UI.** "M7" in the nav, "Planned for M8" on Overview, Settings "planned for M2/M6/M9" (M2 is done), Recovery plans "Mapping steps … arrives in M3" (M3 is done), Reports "Saved, shareable reports arrive with M5", Debrief "arrives in M8" (`Settings.tsx`, `RecoveryPlans.tsx:207`, `Reports.tsx:56`, `Debrief.tsx:155`).
8. **Shell does not scale either way.** At 1024 the fixed 248px sidebar squeezes Overview's side column to ~210px and the origin tag pushes past the region edge (`10-overview-width-light-1024.png`). At 1920 `.main` has `max-width` but no `margin-inline: auto`, so the content hugs the left with a ~350px empty right gutter (`10-overview-width-light-1920.png`; Floor rule 14 wants the container centred). Nav items have no icons and cannot collapse to a rail.
9. **Buttons without affordance.** Subtle Atlaskit buttons read as plain text ("Filter and sort all changes", "Open readiness checks", "Open PREVIEW-14 in Jira", "Leave rehearsal"; `01-overview-*`, `04b-*`, `05c-*`). Confidence styling is inconsistent: "Confirmed" is a warning-orange lozenge in Findings but a neutral outline in the impact path (`04b-check-findings-light-1440.png`).
10. **Theme control and OS fallback absent.** Inside Jira the app follows Jira (good). There is no user choice, and outside Jira (or if `enableTheming` fails) an OS dark preference is ignored (`09-overview-os-dark-no-jira-1440.png` renders light).

### 2.2 Per screen

| Screen                         | Screenshots                                                                                              | Problems                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                          | `00-nav-menu-open-*-375`, all `*-1440`                                                                   | Dev banner and page header take ~180px before content. Sidebar tagline duplicates the Overview lead. "ScenarioForge AI" in the sidebar vs "ScenarioForge" in the topbar. Mobile menu has no Escape-to-close and no focus return to the toggle. Brand "AI" suffix appears though the build uses no AI (Settings says so).                                         |
| Overview                       | `01-overview-{fixtures,empty,error}-*`                                                                   | Problem 1 and 2. Error state shows the full loop and three "Not assessed" paragraphs above one error. Empty state still says "Nothing is checked automatically" twice. "Exercise activity" shows `metCount/totalCount` without "modelled".                                                                                                                       |
| Changes                        | `02-changes-*`                                                                                           | Solid. Six controls in one toolbar wrap to six stacked fields at 375 (~420px before the first row). Raw JQL printed in the results line is developer copy. Filters are not in the URL. Row action is the only way to start a check; keys open Jira instead.                                                                                                      |
| Recovery plans (list, page)    | `03-plans-*`, `03b-plan-procedure-*`                                                                     | Raw CQL in results line. Procedure view ends with a stale "arrives in M3" fact. Page text is an unstyled blockquote. No link from a runbook to the findings that cite it.                                                                                                                                                                                        |
| Readiness checks (picker)      | `04-readiness-{picker,empty,error}-*`                                                                    | Duplicates Changes' table with no differentiation; no indication which changes were already checked this session.                                                                                                                                                                                                                                                |
| Readiness check (result)       | `04b-check-findings-*`, `04c-check-no-findings-*`, `04d-check-not-assessed-*`, `04e-check-graph-error-*` | Problem 6. "Not assessed" is a plain black heading identical in weight to "2 recovery steps may depend…". "No conflicts found" correctly carries the caveat, but its visual is identical to the other two outcomes. Origin tag says "Live Jira and Confluence data" in green. The impact path is good but visually dense (badge, source, evidence link per row). |
| Simulations (briefing)         | `05a-sim-briefing-demo-*`, `05-sim-briefing-generated-*`                                                 | Demo note and provenance note are two different visual treatments. The briefing's objectives and runbook are in a sidebar that drops below on mobile.                                                                                                                                                                                                            |
| Rehearsal (running)            | `05b-sim-running-start-*`, `05c-sim-running-mid-*`, `05e-sim-retest-running-*`                           | Strongest screen and the existing signature (time rail). Gaps: the clock is not sticky, so on mobile decisions push it off-screen; `Leave rehearsal` looks like text; the whole clock block is `aria-live`, so each decision is announced twice with the consequence region; deadlines ahead of "now" are not visually distinct from passed ones at 375.         |
| After-action report and retest | `05d-sim-debrief-*`, `05f-sim-retest-report-*`                                                           | Problems 4 and 5. Fix approval checkboxes, "Run targeted retest" (disabled until a box is ticked) and "Rehearse again" are below six decisions. The remediation draft (`RemediationPreview`) is a 900px form inline.                                                                                                                                             |
| Reports                        | `06-reports-{empty,list}-*`                                                                              | Session-only list, labelled with synthetic origin even when built from a real finding. No before/after pairing of a run and its retest. Will be superseded by History (upcoming lane).                                                                                                                                                                           |
| Crisis room                    | `07-crisis-room-planned-*`                                                                               | Honest placeholder, but occupies a top-level nav slot with "M7".                                                                                                                                                                                                                                                                                                 |
| Settings                       | `08-settings-*`                                                                                          | Stale source statuses (JSM "planned for M2", Confluence "In testing", Rovo "planned for M6"); Data handling lists only Jira scopes though Confluence scopes are in the manifest; no appearance (theme) control.                                                                                                                                                  |

### 2.3 Accessibility (WCAG 2.2 AA)

Good already: skip-free single landmark structure, focus moved to `main` on navigation, `:focus-visible` everywhere, one persistent `role="status"` for result counts, tables restack with labels, `prefers-reduced-motion` handled globally, contrast of all current text pairs passes (§5.2 uses the same ADS values).

Issues found:

- **1.4.1 Use of colour / meaning**: live origin coded green (success); "Confirmed" coded warning in one place and neutral in another.
- **2.4.11 Focus not obscured**: no sticky elements today, but the proposed sticky clock and app bar must use `scroll-padding-top`; current `base.css` sets `scroll-padding-top: var(--space-3xl)`, a token that does not exist, so the declaration is invalid.
- **2.5.8 Target size**: compact row buttons ("Check recovery impact", `spacing="compact"`) are 24px high; passes the 24px minimum but not the app's own 44px touch rule at 375.
- **4.1.3 Status messages**: rehearsal clock (`aria-live` on `.clock`) and the consequence region both announce on each decision; double speech.
- **2.1.2 / 2.4.3**: mobile menu has no Escape handling and does not return focus to the toggle on close.
- **3.3.2 Labels**: restore-target field relies on placeholder "For example 30" for the expected range until an error appears.
- **Forced colours**: no `forced-colors` rules; lozenges and dashed deadline lines rely on background/border colours. Headless emulation (`09-overview-forced-colors-1440.png`) did not apply, so this is untested: verify on Windows High Contrast in Phase E.
- **1.3.1**: `.state-unknown` "Not assessed" uses heading weight with no icon or text role; acceptable for screen readers, but sighted users get no distinct state cue.

### 2.4 Theme gaps

- `main.tsx` calls `view.theme.enable()` before render. Inside Jira this injects ADS token CSS and keeps `html[data-color-mode]` in sync with Jira, including live switches (Forge docs: "reactively apply theme changes that occur in the host environment"). Owner confirmed dark mode live on 2026-11-09 (MILESTONES M1).
- `tokens.css` maps ground/ink/status to `--ds-*` with literal light fallbacks, and redefines the copper accent under `html[data-color-mode='dark']`. Dark capture (`*-dark-*.png`) shows nothing breaking: accent `oklch(72% 0.13 55)` on `#1F1F21`, lozenges and section messages follow.
- What breaks or is missing: (1) no user Light/Dark/System choice; (2) outside Jira, or if `enableTheming` rejects, there is no `prefers-color-scheme` fallback, so an OS-dark user gets light fallbacks; (3) fallbacks are the **legacy** ADS palette (`#172b4d`, `#dcfff1`) while live Jira uses the refreshed one (`#292A2E`, `#EFFFD6`), so preview screenshots drift from production; (4) first paint happens before `enableTheming` resolves, so a dark-mode Jira user can see a white flash for one frame (`body` background falls back to `#ffffff`).

### 2.5 Responsive issues

- 375: works and does not overflow; the cost is length (Overview 2,200px, report 5,218px) and the non-sticky clock.
- 768: sidebar replaced by a "Menu" button (under 60rem); fine.
- 1024: sidebar + two-column Overview is cramped (problem 8).
- 1440: comfortable.
- 1920: left-hugging container (problem 8).

### 2.6 Performance baseline (production build, `npm run frontend:build`, Vite 8.3.7, 888 modules, built 2026-11-10)

| Loaded at start (from `build/index.html`)                     | Raw       | Gzip          |
| ------------------------------------------------------------- | --------- | ------------- |
| `index` (entry: App, Shell, Overview, Changes)                | 79.74 kB  | 20.19 kB      |
| `format` chunk (React DOM, emotion, Atlaskit primitives)      | 318.03 kB | 97.18 kB      |
| `button` chunk (`@atlaskit/button`, tooltip, feature flags)   | 242.82 kB | 65.91 kB      |
| `identifiers`, `toConsumableArray`, runtime, `hash`, `useApi` | 15.29 kB  | 6.32 kB       |
| **JS total at start**                                         | 655.9 kB  | **189.6 kB**  |
| CSS (`index` 54.02, `format` 38.69, `button` 9.15)            | 101.86 kB | **21.16 kB**  |
| **Initial total**                                             |           | **~210.8 kB** |

Lazy chunks: `Readiness` 38.96 / 11.19 kB, `Debrief` 26.69 / 8.87 kB, `Simulations` 12.77 / 4.17 kB, `RecoveryPlans` 5.45 / 2.02 kB, `Settings` 3.29 / 1.14 kB, `Reports` 2.42 / 0.97 kB, `Planned` 1.19 / 0.66 kB. Bridge internals: `iframe-resizer` 29.19 / 10.28 kB, `delivery` 23.14 / 6.82 kB. `@atlaskit/tokens` theme chunks (each ~21 kB / ~3.2 kB; `custom-theme` 67.13 / 16.62 kB) are emitted but only loaded on demand. `build/` totals 1.28 MB on disk across 42 assets.

Budgets for the redesign (§8): initial JS gzip ≤ 200 kB (+10 kB headroom), initial CSS gzip ≤ 26 kB, each route chunk ≤ 15 kB gzip, icons tree-shaken (per-icon imports only).

## 3. Information architecture

### 3.1 Sections and names (no milestone jargon)

The nav follows the journey, grouped in three, with icons from `@atlaskit/icon/core` (already installed, see §5.8):

| Group       | Item                       | Route (existing → proposed)                                    | Replaces                  | Icon (core)                   |
| ----------- | -------------------------- | -------------------------------------------------------------- | ------------------------- | ----------------------------- |
| —           | **Command center**         | `/` (unchanged)                                                | Overview                  | `home`                        |
| Detect      | **Changes**                | `/changes`                                                     | Changes                   | `changes`                     |
| Understand  | **Readiness checks**       | `/readiness-checks`, `/readiness-checks/:issueKey` (deep link) | Readiness checks          | `search`                      |
|             | **Runbooks**               | `/recovery-plans`, `/recovery-plans/:pageId`                   | Recovery plans            | `book-with-bookmark`          |
| Rehearse    | **Rehearsals**             | `/simulations`, `/simulations/:sessionId`                      | Simulations               | `clock`                       |
|             | **Crisis room** (upcoming) | `/crisis-room`                                                 | Crisis room (M7)          | `people-group`                |
| Fix, verify | **Fixes**                  | `/remediation` (upcoming lane: remediation request prep)       | inline RemediationPreview | `tasks`                       |
|             | **History**                | `/history`, `/history/:runId` (upcoming lane)                  | Reports                   | `chart-trend`/`list-bulleted` |
| Footer      | **Settings**               | `/settings`                                                    | Settings                  | `settings`                    |

Icon names are to be verified against `node_modules/@atlaskit/icon/core` (752 glyphs present) in Phase B; fall back to the nearest core glyph, never a new dependency.

Rules: "Overview" becomes "Command center" (Overview's job, §4). Paths do not change, so existing Jira URLs and the routing lane's paths stay valid; only labels change. "Reports" folds into **History** once that lane lands (until then "Reports" stays, renamed "History" only when persistence exists, so we never imply stored history that is not stored). Upcoming items that do not work are hidden, not shown with a milestone code; Crisis room stays reachable from Rehearsals as "Run with a team (coming later)" and from the route.

**Rovo assistant** is not a nav destination. Per M6_PLAN §4.4 it is an inline "Ask the Recovery investigator" / "Ask the Exercise facilitator" action on the readiness check and the report, rendered only when `rovo.isEnabled()` is true; absent otherwise.

### 3.2 First-time entry point

First visit (no completed checks or runs in this browser, and the onboarding flag in `localStorage` unset) shows the Command center in its **first-run state**: one sentence of what the app does, the five journey steps as a horizontal strip, and one primary action "Check a recent change" that opens Readiness checks. A secondary "Try the synthetic demo" opens the demo rehearsal, labelled synthetic. No modal tour. Dismissal stored per viewer in `localStorage` (try/catch, render correctly without it).

### 3.3 Deep-link compatibility

All addressable state goes through the router lane's `history.push(path)`; the redesign adds no state the router cannot express. Design assumptions: the readiness check header, rehearsal and report each have a stable URL; a reload of a sub-route re-fetches (check) or shows "This rehearsal was in another session" with a path back (session-only runs until storage exists). Breadcrumbs are derived from the path (`Readiness checks / MC-62`).

## 4. Screen inventory

Legend for backend: **exists** (resolver/engine today), **lane** (concurrent lane building it), **missing** (no backend; needs approval such as `storage:app` or `write:jira-work`).

| Screen                                         | Purpose and primary question                                                      | Primary action                         | Data sources                                                                                 | States                                                                                                         | Backend                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Command center** ("Recovery Command Center") | "What changed recently, what have I checked, and what should I do next?"          | Check the most recent unchecked change | `listRecentChanges` (live), this session's checks and runs (session), History when it exists | loading, empty (no changes), error, first-run, not-assessed (no checks yet), unavailable (History absent)      | exists for changes; session-only for checks/runs; History **lane**, cross-session KPIs **missing** (`storage:app`) |
| Changes                                        | "Which recent changes could touch recovery?"                                      | Check recovery impact (row)            | `listRecentChanges`                                                                          | loading, empty, filtered-empty, error, truncated                                                               | exists                                                                                                             |
| Readiness check `/:issueKey`                   | "Does this change break a recovery step, how sure are we, and what was not read?" | Rehearse this finding                  | `getReadinessGraph` (fallback `analyzeChange`)                                               | loading, findings, no-findings (with caveat), not-assessed (reason), graph-error with findings, error          | exists                                                                                                             |
| Runbooks list / page                           | "What recovery procedures exist and what steps do they have?"                     | Open runbook                           | `listRecoveryPages`, `getRecoveryProcedure`                                                  | loading, empty, error, no numbered steps (not assessed), truncated                                             | exists (Confluence scopes held from `development`, D14)                                                            |
| Rehearsal briefing                             | "What am I about to rehearse, from which evidence, against which deadlines?"      | Start rehearsal                        | generated scenario (`generateRehearsal`) or synthetic demo                                   | ready, synthetic label, modelled label                                                                         | exists (client engine)                                                                                             |
| Rehearsal (incident command)                   | "What is happening now and what do I do next, against the clock?"                 | Choose a decision                      | engine session                                                                               | in progress, deadline passed, leave-confirm                                                                    | exists                                                                                                             |
| After-action report                            | "How did recovery go, why, and what is the gap?"                                  | Approve fixes and run targeted retest  | completed session, evaluation, remediation model                                             | gap found, gap not found, all met                                                                              | exists                                                                                                             |
| Retest comparison                              | "Did the fix close the gap?"                                                      | Prepare the fix as a Jira work item    | `compareRetest` result, both runs                                                            | resolved, still failing, inconclusive (D15)                                                                    | exists                                                                                                             |
| Fixes (remediation request prep)               | "What exactly would be created in Jira, and is it approved?"                      | Approve this exact draft               | `@shared/remediation` draft, approval hash                                                   | draft invalid, ready to review, approved, stale approval, create blocked (scope)                               | draft **exists** (client); prep lane **lane**; create **missing** (`write:jira-work`, `storage:app`)               |
| History                                        | "What have we rehearsed and verified over time?"                                  | Open a run / its comparison            | rehearsal-history entity (D19)                                                               | loading, empty, error ("History could not be loaded", never empty), unavailable (no `storage:app`: tab absent) | **lane**; storage **missing**                                                                                      |
| Crisis room                                    | "Who holds which role in a shared rehearsal?"                                     | — (not available)                      | Forge Realtime                                                                               | unavailable only                                                                                               | **missing**                                                                                                        |
| Rovo assistant (inline)                        | "Why is this only suspected? What would confirm it?"                              | Ask the investigator / facilitator     | M6 actions                                                                                   | hidden when Rovo off; agent errors handled by Rovo                                                             | **missing** (M6 deploy pending `whoami-probe`)                                                                     |
| Settings                                       | "What can the app read, as whom, and how does it look?"                           | Change appearance                      | `getConnectionStatus`, `view.getContext`, manifest facts                                     | checking, connected, not connected                                                                             | exists; appearance is client-only                                                                                  |

**Command center KPIs, only those computable today:** recent changes in window (count, live), changes checked this session (count), findings by confidence this session (confirmed / suspected / not assessed, counts, with "this session" label), rehearsals completed this session and latest result ("3 of 4 objectives, modelled"). Cross-session trends, "readiness score", MTTR or coverage percentages across all runbooks are **not shown** (no source). When History exists, the same tiles read from it and drop the "this session" label.

## 5. Design-system proposal

### 5.1 Principle: one theme system, two layers

ADS tokens (`--ds-*`) stay the single source of light/dark truth for every neutral and status colour. ScenarioForge adds a thin semantic layer `--sf-*` in `tokens.css` that (a) aliases ADS roles under product names, and (b) owns only what ADS does not have: the copper brand ramp, the command band surface and the data-origin set. Both layers flip on the **same** attribute (`data-color-mode`), so there are never two competing switches. Components read only `--sf-*` (or Atlaskit components, which read `--ds-*`). The existing `--color-*` names are kept as aliases during migration (Phase B) and removed in Phase E.

### 5.2 Token table with WCAG contrast

Brand values are authored in OKLCH and converted to sRGB hex (rounded); ADS values are the shipped `atlassian-light` / `atlassian-dark` values from `@atlaskit/tokens` 20.11.0. Contrast computed with the WCAG 2.x formula (alpha tokens composited on the background first). Script: `…/scratchpad/contrast.py`. Text requires 4.5:1, UI boundaries 3:1.

**Surfaces and neutrals**

| Token                  | Maps to                                                | Light       | Dark        |
| ---------------------- | ------------------------------------------------------ | ----------- | ----------- |
| `--sf-surface`         | `--ds-surface`                                         | `#FFFFFF`   | `#1F1F21`   |
| `--sf-surface-sunken`  | `--ds-surface-sunken`                                  | `#F8F8F8`   | `#18191A`   |
| `--sf-surface-raised`  | `--ds-surface-raised`                                  | `#FFFFFF`   | `#242528`   |
| `--sf-surface-overlay` | `--ds-surface-overlay`                                 | `#FFFFFF`   | `#2B2C2F`   |
| `--sf-surface-command` | own: `oklch(97.5% 0.012 62)` / `oklch(23.5% 0.018 58)` | `#FDF5EF`   | `#251C16`   |
| `--sf-text`            | `--ds-text`                                            | `#292A2E`   | `#CECFD2`   |
| `--sf-text-subtle`     | `--ds-text-subtle`                                     | `#505258`   | `#A9ABAF`   |
| `--sf-text-subtlest`   | `--ds-text-subtlest`                                   | `#6B6E76`   | `#96999E`   |
| `--sf-border`          | `--ds-border`                                          | `#0B120E24` | `#E3E4F21F` |
| `--sf-border-bold`     | `--ds-border-bold`                                     | `#7D818A`   | `#7E8188`   |
| `--sf-focus`           | `--ds-border-focused`                                  | `#4688EC`   | `#8FB8F6`   |

`--sf-surface-command` is the incident-clock band (rehearsal bar, Command center "next action" band): a warm tint of the surface, the one place the brand colours the ground.

**Brand (copper, "forge")**

| Token                | Light OKLCH → hex                  | Dark OKLCH → hex                  | Use                                        |
| -------------------- | ---------------------------------- | --------------------------------- | ------------------------------------------ |
| `--sf-accent-text`   | `oklch(50% 0.13 48)` → `#9C470D`   | `oklch(80% 0.115 60)` → `#F4AC6F` | Clock, issue keys, current nav item        |
| `--sf-accent-bold`   | `oklch(53% 0.145 48)` → `#AC4B00`  | `oklch(76% 0.14 58)` → `#F2994E`  | Clock "now" marker, selected decision fill |
| `--sf-accent-ink`    | `#FFFFFF`                          | `#1F1F21`                         | Text on `accent-bold`                      |
| `--sf-accent-subtle` | `oklch(95.5% 0.03 62)` → `#FFECDC` | `oklch(31% 0.055 52)` → `#462814` | Current nav item, selected row             |
| `--sf-accent-border` | `oklch(62% 0.15 50)` → `#CB6620`   | `oklch(68% 0.14 55)` → `#D97E38`  | Selected outline, deadline line "ahead"    |

Primary buttons stay ADS brand blue (`--ds-background-brand-bold` `#1868DB` / `#669DF1`), as DESIGN.md decided: Jira users read blue as "the action". Copper is identity and state, never a second primary.

**Status (always paired with a word and an icon)**

| Token                      | Maps to                                                                                | Light text / bg       | Dark text / bg        |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------- | --------------------- |
| `--sf-status-success[-bg]` | `--ds-text-success`, `--ds-background-success`                                         | `#4C6B1F` / `#EFFFD6` | `#B3DF72` / `#28311B` |
| `--sf-status-danger[-bg]`  | `--ds-text-danger`, `--ds-background-danger`                                           | `#AE2E24` / `#FFECEB` | `#FD9891` / `#42221F` |
| `--sf-status-warning[-bg]` | `--ds-text-warning`, `--ds-background-warning`                                         | `#9E4C00` / `#FFF5DB` | `#FBC828` / `#3A2C1F` |
| `--sf-status-info[-bg]`    | `--ds-text-information`, `--ds-background-information`                                 | `#1558BC` / `#E9F2FE` | `#8FB8F6` / `#1C2B42` |
| `--sf-status-unknown[-bg]` | `--ds-text-subtle`, `--ds-background-accent-gray-subtlest` + dashed `--ds-border-bold` | `#505258` / `#F0F1F2` | `#A9ABAF` / `#303134` |

Mapping of product states: gap resolved, objective met → success; gap still failing, objective missed, error → danger; confirmed finding, inconclusive retest, deadline approaching → warning; suspected finding → warning text with dashed outline; **not assessed, no findings, not measured, not connected → unknown** (grey, dashed, question icon). "No findings" is never green.

**Data origin (every data region carries one)**

| Token                   | Maps to                                                          | Light text / bg       | Dark text / bg        | Label                                     |
| ----------------------- | ---------------------------------------------------------------- | --------------------- | --------------------- | ----------------------------------------- |
| `--sf-origin-live`      | `--ds-text-information` / `--ds-background-information`          | `#1558BC` / `#E9F2FE` | `#8FB8F6` / `#1C2B42` | "Live from Jira" / "Live from Confluence" |
| `--sf-origin-modelled`  | `--ds-text-accent-teal` / `--ds-background-accent-teal-subtlest` | `#206A83` / `#E7F9FF` | `#9DD9EE` / `#1E3137` | "Modelled from MC-62"                     |
| `--sf-origin-synthetic` | `--ds-text-discovery` / `--ds-background-discovery`              | `#803FA5` / `#F8EEFE` | `#D8A0F7` / `#35243F` | "Synthetic demo data"                     |
| `--sf-origin-session`   | `--sf-text-subtle` / `--sf-surface-sunken`                       | `#505258` / `#F8F8F8` | `#A9ABAF` / `#18191A` | "This browser session only"               |

Live moves off success green (problem 2) to information blue; modelled gets teal so it is distinct from both copper (identity) and purple (synthetic).

**Contrast results (all pass)**

| Pair                                                  | Light                                 | Dark                                | Need            |
| ----------------------------------------------------- | ------------------------------------- | ----------------------------------- | --------------- |
| text on surface / sunken / raised / overlay / command | 14.34 / 13.50 / 14.34 / 14.34 / 13.30 | 10.56 / 11.30 / 9.84 / 8.96 / 10.73 | 4.5             |
| text-subtle on the same five                          | 7.81 / 7.35 / 7.81 / 7.81 / 7.25      | 7.15 / 7.66 / 6.66 / 6.07 / 7.27    | 4.5             |
| text-subtlest on the same five                        | 5.10 / 4.80 / 5.10 / 5.10 / 4.73      | 5.76 / 6.16 / 5.36 / 4.88 / 5.85    | 4.5             |
| accent-text on surface / sunken / command             | 6.32 / 5.95 / 5.87                    | 8.60 / 9.20 / 8.74                  | 4.5             |
| accent-text on accent-subtle                          | 5.51                                  | 6.97                                | 4.5             |
| text on accent-subtle (current nav item)              | 12.48                                 | 8.56                                | 4.5             |
| accent-ink on accent-bold                             | 5.58                                  | 7.40                                | 4.5             |
| inverse on brand-bold (primary button)                | 5.20                                  | 6.00                                | 4.5             |
| success on surface / on success-bg                    | 6.12 / 5.81                           | 10.75 / 8.87                        | 4.5             |
| danger on surface / on danger-bg                      | 6.53 / 5.74                           | 7.90 / 6.81                         | 4.5             |
| warning on surface / on warning-bg                    | 6.02 / 5.54                           | 10.50 / 8.59                        | 4.5             |
| info (live) on surface / on info-bg                   | 6.66 / 5.90                           | 8.11 / 7.03                         | 4.5             |
| teal (modelled) on surface / on teal-bg               | 6.09 / 5.62                           | 10.65 / 8.77                        | 4.5             |
| discovery (synthetic) on surface / on discovery-bg    | 6.62 / 5.88                           | 8.06 / 6.97                         | 4.5             |
| unknown text on unknown-bg                            | 6.91                                  | 5.66                                | 4.5             |
| All status/origin text on overlay (lowest dark pair)  | ≥ 6.02                                | ≥ 6.70                              | 4.5             |
| border-bold on surface / sunken (control boundary)    | 3.90 / 3.68                           | 4.22 / 4.51                         | 3.0             |
| focus ring on surface / sunken                        | 3.50 / 3.30                           | 8.11 / 8.68                         | 3.0             |
| accent-border on surface / sunken                     | 3.85 / 3.62                           | 5.48 / 5.86                         | 3.0             |
| `--sf-border` hairline on surface                     | 1.35                                  | 1.39                                | decorative only |

`--sf-border` is decorative (region separators); any boundary that identifies a control uses `border-bold`. Lowest text pair: text-subtlest on the light command band, 4.73:1, so subtlest text is not used on that band at sizes below 14px bold.

### 5.3 Theme control (Light / Dark / System) in a Forge Custom UI iframe

**Findings.**

- `view.theme.enable()` (`@forge/bridge` 7.3.0, `callBridge('enableTheming')`) fetches the host theme, applies it, and reactively applies host changes. Forge docs say `data-color-mode` (`light`, `dark`, `auto`) is the attribute to rely on and `data-theme` "should not be read or modified in any way". There is no documented opt-out or override API.
- `FullContext.theme` (from `view.getContext()`) exposes `colorMode`, but docs say to use `enable()` and tokens rather than read it.
- `@atlaskit/tokens` 20.11.0 theme CSS already supports **subtree theming**: every token block is selected by `html[data-color-mode][data-theme~=…]` **or** `[data-subtree-theme][data-color-mode="…"][data-theme~="…"]`. Atlaskit components inside a subtree element carrying those attributes resolve tokens from it, independent of `<html>`.

**Verdict: feasible, without fighting Jira.** Leave `<html>` entirely to Forge. Implement the choice on the app root:

1. Keep `view.theme.enable()` as is. "System" in ScenarioForge means **"Match Jira"** (Jira itself already offers Light/Dark/Match browser), labelled "Match Jira" in Jira and "Match device" outside Jira.
2. When the user picks Light or Dark, set on the app root element `data-subtree-theme`, `data-color-mode="light|dark"` and the matching `data-theme="light:light dark:dark spacing:spacing typography:typography"`, and import the corresponding `@atlaskit/tokens` theme CSS for that mode (static import of `artifacts/themes/atlassian-light|dark`, ~3.2 kB gzip each, loaded only when an override is chosen). The `--sf-*` dark overrides use the selector `[data-color-mode='dark']` (not `html[...]`) so they apply to whichever element carries the mode.
3. Body background is set from the app root (`.app-root { background: var(--sf-surface) }`, full height), so the Jira iframe never shows the host's ground around an overridden subtree.
4. Portals: Atlaskit layering (tooltips, modals, flags) portals to `body`, outside the subtree. Today the app uses no portalled components; if one is added, wrap its portal container in the same subtree attributes (Atlaskit `Portal` accepts a container) or keep overrides off for that release. Recorded as a risk.
5. Caveat from Forge docs: a self-chosen mode "may cause colour discrepancies between your app and the parent Atlassian app". The Settings control explains it in one line, and the default stays "Match Jira".

**Persistence.** `localStorage` key `sf.appearance` (`"system" | "light" | "dark"`), read inside try/catch; any failure means "system". The Custom UI iframe has its own origin per app, so the value is per user-browser and per app, never shared. Forge storage is not used (not approved). No cookie.

**No flash of wrong theme.** An inline script is assumed blocked by the Forge Custom UI CSP (the manifest relaxes only `styles`; verify against the current CSP reference in Phase B), so: (a) `index.html` gets a `<style>` (allowed: `styles: unsafe-inline`) setting `html, body { background: Canvas; color-scheme: light dark }`, which follows the OS until tokens load; (b) the first lines of `main.tsx`, before `createRoot`, read `localStorage` synchronously and set the root attributes, then `await view.theme.enable()` with a 300 ms timeout before the first render (the docs recommend enabling before mount). Outside Jira (bridge rejects), "system" resolves through `matchMedia('(prefers-color-scheme: dark)')` and loads the matching bundled ADS theme, fixing gap (2) in §2.4.

**OS / host changes.** In "system" mode inside Jira, Forge pushes host changes; nothing to do. Outside Jira, a `matchMedia` `change` listener swaps the subtree mode. Explicit Light/Dark ignore both. The control is an ADS-styled three-option segmented radio group (`role="radiogroup"`) in Settings → Appearance, plus a compact icon toggle in the app bar menu.

### 5.4 Typography

Keep the system stack (`ui-sans-serif, -apple-system, 'Segoe UI', Roboto…`) and system mono for the clock, keys and JQL. Reasons: matches Jira, zero bytes, and Forge Custom UI CSP would need a font egress/`fonts` permission and a manifest major version for a remote font; a bundled font adds ~30 to 60 kB per weight with no product gain. Scale stays 1.125 (12, 14, 16, 18, 20.25, 22.8, 25.6 px) per Hallmark app scope; one extra figure size (32px, tabular, mono) for the clock and the before/after numbers only. Weights: 400 body, 600 headings and labels (replace the current 650, which synthesises on some stacks).

### 5.5 Spacing, radii, elevation

- Spacing stays 2, 4, 8, 12, 16, 24, 40, 64 px; add 32 for column gaps (already `--gap-columns`). Define the missing `--space-3xl` (96px) or drop the reference in `base.css`.
- Radii: 4 (lozenge, tag), 6 (control), 8 (panel), 12 (command band). One radius per nesting level.
- Elevation: three levels only, from ADS: flat (hairline), raised (`--ds-shadow-raised`, cards that are clickable: decision options, runbook cards), overlay (`--ds-shadow-overlay`, menus). No card inside a card; regions remain hairline-separated.

### 5.6 Iconography

`@atlaskit/icon` 38.0.2 is already installed as a dependency of `@atlaskit/button` (752 icons under `@atlaskit/icon/core`). Phase B adds it to `static/app/package.json` as a direct dependency at the same version (no new code downloaded, reviewed package from the same vendor). Per-icon deep imports only (`@atlaskit/icon/core/clock`), for tree-shaking; budget ≤ 4 kB gzip for all icons. Every status lozenge pairs icon + word; icons are `label=""` (decorative) when the word is present. No emoji, no custom SVG except the existing brand mark.

### 5.7 Motion

- Durations: 120 ms (micro: hover, press, colour), 220 ms (short: disclosure, panel). Easing `--ease-out` for enter, `--ease-in-out` for state swaps.
- Animate `opacity`, `transform`, `color`, `background-color` only; never `all`, never layout properties.
- Signature motion, one only: when a decision lands, its rail event fades and slides 4px into place, and the "now" marker moves by `transform`. Deadline lines turn colour on pass. Nothing on page load.
- `prefers-reduced-motion: reduce` removes all transforms and transitions (existing global rule stays); the rail updates instantly.

### 5.8 Layering on ADS without conflicts (rules)

1. `--sf-*` tokens are defined once at `:root` as `var(--ds-…, <current ADS light value>)`; dark brand/origin overrides under `[data-color-mode='dark']`.
2. No component sets `--ds-*`.
3. Fallback literals are updated to the refreshed ADS palette (§2.4 gap 3), so preview matches production.
4. sloplint Floor rule 1 continues to hold: no literal colour outside `tokens.css`.

## 6. Shared component plan

| Component                                  | Props sketch                                                          | States                                                           | Replaces                                       |
| ------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `AppShell`                                 | `nav: NavGroup[]`, `collapsed`, `onCollapse`, `children`              | expanded (248px), rail (64px, icons + tooltips), mobile drawer   | `Shell` (keeps focus-on-navigate)              |
| `NavItem`                                  | `icon`, `label`, `to`, `current`, `badge?`                            | default, hover, focus, current, rail                             | `.nav-link`                                    |
| `PageHeader`                               | `title`, `lead?`, `crumbs?`, `origin?`, `actions?`                    | —                                                                | `PageHeader`                                   |
| `OriginBadge`                              | `origin: 'live'                                                       | 'modelled'                                                       | 'synthetic'                                    | 'session'`, `source?: string`                   | four origins                                            | `OriginTag`, `.origin-modelled`                    |
| `StatusBadge`                              | `status: 'met'                                                        | 'missed'                                                         | 'resolved'                                     | 'failing'                                       | 'inconclusive'                                          | 'confirmed'                                        | 'suspected'  | 'not-assessed' | 'no-findings'` | icon + word, never colour alone | `.confidence-*`, `.assessment-*`, objective states, `StatusLozenge` (Jira status stays Atlaskit Lozenge) |
| `AnswerBanner`                             | `kind: 'findings'                                                     | 'no-findings'                                                    | 'not-assessed'                                 | 'error'`, `title`, `detail`, `coverage?`        | four kinds; not-assessed grey dashed with question icon | `AnalysisStatement`, Overview "Not assessed" block |
| `StatTile`                                 | `label`, `value: number                                               | null`, `unit?`, `scope: 'session'                                | 'stored'`, `origin`                            | value, null → "Not assessed" (never 0), loading | Overview side regions                                   |
| `NextActionBand`                           | `title`, `reason`, `action`                                           | first-run, has-unchecked-change, has-finding, has-gap-unretested | Overview loop                                  |
| `JourneyStrip`                             | `current: 'detect'                                                    | 'understand'                                                     | 'rehearse'                                     | 'fix'                                           | 'verify'`                                               | step done, current, ahead (no milestone codes)     | `.loop-list` |
| `DataRegion`                               | `title`, `origin`, `state: RemoteState<T>`, `empty`, `children(data)` | loading skeleton, empty, error (retry), ready                    | repeated loading/error/empty JSX in every page |
| `EvidenceQuote`                            | `kind`, `title`, `excerpt`, `link?`                                   | with link, without link, missing excerpt                         | `SourceQuote`, `EvidenceItem`                  |
| `FindingCard`                              | `finding`, `change`, `onRehearse`                                     | confirmed, suspected                                             | `FindingItem`                                  |
| `CoveragePanel`                            | `coverage`, `analyzedAt`                                              | full, partial, nothing read                                      | `CoverageFacts`                                |
| `ImpactPath`                               | unchanged API                                                         | restyled with `StatusBadge`, `OriginBadge`                       | (kept)                                         |
| `IncidentClock`                            | `elapsed`, `deadlines`, `sticky`                                      | running, deadline near, deadline missed, ended                   | `.rehearsal-bar .clock`                        |
| `TimeRail`                                 | unchanged data; `compact?`                                            | in progress, ended; compact horizontal at 375                    | `TimeRail` (kept, restyled)                    |
| `DecisionOption`                           | `label`, `detail?`, `onChoose`                                        | default, hover, focus, pressed, disabled while applying          | `.decision`                                    |
| `ObjectiveList`                            | `objectives`, `progress`                                              | open, met, missed                                                | `ObjectiveList`, debrief objectives            |
| `RunComparison`                            | `before: RunSummary`, `after: RunSummary`, `verdict`, `gaps`          | resolved, still failing, inconclusive                            | `RetestVerdict` table                          |
| `FixApproval`                              | `fixes`, `approved`, `onChange`, `onRetest`                           | none approved (button explains), some approved                   | Debrief fixes list                             |
| `WorkItemDraft`                            | existing `RemediationPreview` props, collapsed by default             | collapsed summary, expanded draft, approved, stale, blocked      | `RemediationPreview` layout                    |
| `AppearanceControl`                        | `value`, `onChange`, `inJira`                                         | system, light, dark                                              | new                                            |
| `EmptyState`, `ErrorPanel`, `SkeletonRows` | unchanged APIs, restyled                                              | —                                                                | (kept)                                         |
| `AskRovo`                                  | `agent`, `prompt`                                                     | rendered only if `rovo.isEnabled()`                              | new (M6)                                       |

Every interactive component ships the eight Hallmark states (default, hover, focus-visible, active, disabled, loading, error, success where relevant).

## 7. Responsive strategy

| Breakpoint | Shell                                                                          | Layout                                                                                                             |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 375        | App bar (48px) with menu button; drawer nav with Escape and focus return       | Single column; toolbars collapse to search + "Filters" disclosure; tables restack (existing pattern); sticky clock |
| 768        | App bar + drawer                                                               | Single column, two-up stat tiles; report sections become disclosures                                               |
| 1024       | Rail nav (64px, icons, tooltips), expandable                                   | Two columns where content is paired (findings and coverage); Command center 2 + 1                                  |
| 1440       | Expanded nav (240px), user can collapse to rail (remembered in `localStorage`) | Three-column rehearsal (rail, stage, objectives); report summary row + two columns                                 |
| 1920       | Expanded nav                                                                   | Content capped at 1360px and **centred**; gutters grow, measure does not (fix problem 8)                           |

**Simulation on mobile.** The incident clock and the current decision are the screen: sticky `IncidentClock` band (elapsed, next deadline countdown in simulated minutes), then situation and options as full-width 48px targets, then a horizontal compact `TimeRail` (scrollable, last event in view) collapsed under "Timeline", objectives and evidence as disclosures. The last consequence stays above the options. No hover-dependent content.

## 8. Implementation phases

Order respects the concurrent lanes: the router/deep-link lane owns `lib/router.tsx`, `lib/routes.ts`, `lib/changeSelection.tsx`; the History lane owns `pages/History*`; the remediation-prep lane owns `components/simulation/RemediationPreview.tsx` logic. The redesign touches their files only after they merge.

### Phase B: foundation (one lane)

Files: `styles/tokens.css`, `styles/base.css`, new `styles/components/*.css` split out of `app.css`, `main.tsx` (theme bootstrap), new `lib/appearance.ts`, `components/Shell.tsx` → `AppShell`, `NavItem`, `OriginBadge`, `StatusBadge`, `DataRegion`, `index.html` (`<style>` only), `package.json` (`@atlaskit/icon` direct dep).
Deliver: `--sf-*` tokens with aliases, theme control and persistence, collapsible shell with icons and IA labels, centred container, mobile drawer fix, refreshed fallbacks. Tests: appearance resolution (system/light/dark, storage throws, no bridge), shell collapse and focus.

### Phase C: Detect and Understand (two lanes, disjoint files)

- C1 Command center: `pages/Overview.tsx`, `NextActionBand`, `JourneyStrip`, `StatTile` (session scope only). Load `dataviz` skill before any figure.
- C2 Readiness check and lists: `pages/Readiness.tsx`, `pages/Changes.tsx`, `pages/RecoveryPlans.tsx`, `components/readiness/*` (`AnswerBanner`, `FindingCard`, `CoveragePanel`, ImpactPath restyle). Depends on the router lane for `/readiness-checks/:issueKey`.

### Phase D: Rehearse, Fix, Verify (two lanes)

- D1 Incident command: `components/simulation/{Rehearsal,TimeRail,Briefing,Objectives,Evidence}.tsx`, `IncidentClock`, `DecisionOption`, mobile layout.
- D2 Report and comparison: `components/simulation/{Debrief,RetestVerdict}.tsx`, `RunComparison`, `FixApproval`, `WorkItemDraft` shell (after the remediation-prep lane merges), `pages/Reports.tsx` until History replaces it.

### Phase E: settings, onboarding, polish, verification (one lane)

`pages/Settings.tsx` (appearance, honest source statuses, no milestone codes), first-run state, `AskRovo` (if M6 deployed), remove `--color-*` aliases, forced-colors rules, full screenshot re-capture with `audit.mjs`, sloplint, axe pass, bundle check, `forge-app-review` before any deploy.

### Risks

- Subtree override and Atlaskit portals (§5.3 item 4).
- `enableTheming` timing: a 300 ms wait before first render could add latency on slow hosts; measure in Jira, fall back to rendering immediately with `Canvas` background.
- Concurrent lanes editing `app.css`: Phase B splits it first; other lanes rebase onto that split.
- Copy drift: every claim string must still match tests (`Readiness.test.tsx`, `Retest.test.tsx` assert wording); update tests with the copy, never weaken them.
- Icons import size if a barrel import slips in; CI bundle budget catches it.

### Dependencies

Router lane (deep links) before C2/D2 sub-routes; History lane before "History" label replaces "Reports"; remediation-prep lane before `WorkItemDraft`; `storage:app` approval before any cross-session KPI; M6 deploy before `AskRovo`.

### Acceptance checklist

- [ ] No milestone codes (`M1`–`M10`) in any rendered string.
- [ ] Every data region shows its origin badge; live is blue, modelled teal, synthetic purple, session grey; none uses success colours.
- [ ] "Not assessed", "No findings", "Not measured", "Not connected" render grey/dashed with a question icon, never green; a null KPI shows "Not assessed", never 0.
- [ ] Every number on the Command center is computable from data loaded in that view; session-only figures say "this session".
- [ ] All text pairs ≥ 4.5:1 and control boundaries ≥ 3:1 in light and dark (re-run `contrast.py` against shipped tokens).
- [ ] Appearance: Match Jira/device, Light, Dark; persists across reload; survives `localStorage` throwing; no white flash in Jira dark (screen recording); follows Jira live switch in "Match Jira".
- [ ] Shell: expanded, rail and drawer; Escape closes drawer and returns focus; current page `aria-current`.
- [ ] No horizontal scroll at 375, 768, 1024, 1440, 1920; container centred at 1920.
- [ ] Rehearsal at 375: clock visible while choosing; options ≥ 44px.
- [ ] Before/after comparison shows first run and retest minutes and objectives side by side with the D15 verdict word, labelled modelled.
- [ ] Keyboard-only run of Detect → Understand → Rehearse → Fix → Verify; one announcement per decision.
- [ ] sloplint `--scope app`: 0 FAIL, 0 REFLEX; Floor rule 14 satisfied.
- [ ] Bundle: initial JS gzip ≤ 200 kB, CSS ≤ 26 kB, route chunks ≤ 15 kB gzip; theme override chunks loaded only when chosen.
- [ ] Forced colours checked manually on Windows High Contrast.
- [ ] Existing test suites pass; new tests for appearance, shell and comparison.
