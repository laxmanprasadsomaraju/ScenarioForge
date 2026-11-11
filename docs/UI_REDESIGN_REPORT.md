# UI redesign report

Phases A–E of the ScenarioForge UI redesign (plan: [UI_REDESIGN_PHASE_A.md](UI_REDESIGN_PHASE_A.md); system: [DESIGN.md](DESIGN.md)). Branch `ui/e-polish`, based on `ui/redesign` at 5a5c4ac. No backend, manifest or permission changes; nothing deployed.

## Screen by screen

| Screen           | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Command center   | Connection line, dismissible "How ScenarioForge works" panel (five steps, no tour, `localStorage` `sf.howItWorks` with try/catch), session summary with source lines, journey strip, one next action (primary) with a labelled "Try the synthetic demo" entry, figures that never show 0 for unknowns, recent changes, exercise activity.                                                                                                                                                                                                        |
| Changes          | Live Jira list with window filter, restacking table, check action per row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Readiness checks | Deep-linkable check per change: answer headline (findings / no findings / not assessed), "Rehearse a finding" form, quoted evidence side by side, coverage and what was not checked, impact path. "Ask the investigator" appears only when `rovo.isEnabled()` is true.                                                                                                                                                                                                                                                                           |
| Runbooks         | Confluence recovery pages and their steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rehearsals       | Briefing with the start action directly under the summary (visible at 1440×900, button bottom at 515px), incident clock, decisions, time rail, objectives.                                                                                                                                                                                                                                                                                                                                                                                       |
| Report / retest  | After-action report, fix approval, targeted retest, before/after comparison with verdict, Jira work item draft (creation disabled).                                                                                                                                                                                                                                                                                                                                                                                                              |
| History          | Saved runs when storage is enabled; otherwise says "not enabled in this environment".                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Crisis room      | "Coming later" badge, why it matters, three planned capabilities as a description list, a working alternative. No controls besides that.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Settings         | Appearance; Jira connection; Connected sources (live Jira status, Confluence "permitted, checked on use", JSM and Teamwork Graph not connected); Permissions (exactly the manifest scopes, tested against `manifest.yml`, plus `storage:app` and `write:jira-work` listed as not requested); AI availability ("Not enabled in this environment", no toggles; Rovo detection from the bridge); Rehearsal history and retention (from `listRehearsalHistory`; 90 days, 50 runs, 5 retests from `shared/history/store.ts`); Safety rules; App info. |

Milestone codes: none remain in UI strings (grep `\bM[0-9]{1,2}\b` outside comments; asserted in Settings and Crisis room tests and in the QA script on every capture).

## Components

See DESIGN.md § Components. New in Phase E: `Notice`, native `Button` (`buttons.css`), native Jira status lozenge and spinner, `HowItWorks`, `AskRovo`/`useRovoEnabled`, `shared/environment.ts` (manifest scope truth), `forced-colors.css`.

## Bundle (production build, gzip -9 of what `build/index.html` loads)

|                     | Before (5a5c4ac) | After                                       |
| ------------------- | ---------------- | ------------------------------------------- |
| Initial JS          | 200.3 kB         | **85.5 kB**                                 |
| Initial CSS         | 24.4 kB          | 12.4 kB                                     |
| Largest route chunk | Debrief 10.2 kB  | Debrief 10.1 kB (Settings 2.5, Planned 0.9) |

How: `@atlaskit/button` (and with it the feature-gate client, Statsig, Popper, tooltip and motion), `@atlaskit/section-message`, `@atlaskit/lozenge` and `@atlaskit/spinner` were replaced by token-styled native parts. Icons remain per-glyph imports. No dependencies added or removed in `package.json`. The ADS theme chunks still load only when an explicit Light/Dark override is chosen.

## Accessibility

- axe-core is not installed in either `node_modules`, so no automated axe run (no dependency added). Manual checklist below instead.
- Keyboard: `static/app/test/KeyboardFlow.test.tsx` drives MC-62 deep link → check → "Rehearse this finding" → Start rehearsal → every decision → approve fix (Space) → retest → retest report using only Tab, Enter and Space, asserting focus reaches each control.
- Focus: global 2px `--sf-focus` outline with offset; captures `e17-focus-{light,dark}-*.png` show the ring in both themes.
- Forced colours: rules added; headless emulation captured as `e18-forced-colors-1440.png`. Real Windows High Contrast not tested (no Windows machine).
- Manual checklist: landmarks (nav, main, labelled regions) ✓; heading order per page ✓; tables have headers and accessible names ✓; status as word + icon ✓; no colour-only state ✓; dismissible panel reachable and named ✓; Rovo entry absent unless enabled ✓; controls ≥ 44px on coarse pointers ✓; reduced motion honoured ✓.

## QA checklist and evidence

Captures: `/private/tmp/claude-501/-Users-laxmanprasadsomaraju-Desktop-ScenarioForge/ca170f9b-e32e-42d0-9ddc-eaf16c12d125/scratchpad/ui-final-shots/` (script `…/scratchpad/render/final.mjs`, dev preview on port 4100 with fixtures). Every route plus empty/error states, light and dark, at 375/768/1024/1440/1920. `facts.json` in that folder logs overflow, milestone codes and the start-button position per capture.

- [x] sloplint `--scope app`: 0 FAIL, 0 REFLEX, 0 WARN
- [x] typecheck (root, app), lint, prettier, `npm test` (835), `npm test --prefix static/app` (152)
- [x] build has no `previewFixtures`, `PREVIEW-14` or `bridgeStub`
- [x] `npm audit --audit-level=high`: 0 (root and app)
- [x] No horizontal scroll at any width (see facts.json)
- [x] Start rehearsal above the fold at 1440×900
- [x] `--color-*` aliases removed
- [x] No milestone codes in rendered text

## Known limitations

- The manifest on this branch declares **four** scopes (`read:jira-work`, `read:jira-user`, `search:confluence`, `read:page:confluence`), not five; Settings shows exactly these. If the deployed environment adds `storage:app`, update the manifest and `shared/environment.ts` together (the test enforces it).
- In the dev preview, fixture history reads as "Saved on this site" while `storage:app` is listed as not requested; in a real install the history resolver returns "not enabled", so the two agree.
- "Ask the investigator" opens the `recovery-investigator` Rovo agent, which is declared on the Rovo branch, not in this manifest. If Rovo is enabled but the agent is missing, the first click fails and the entry hides itself.
- Forced colours verified only by emulation; axe not run (not installed).
- Native buttons approximate ADS button visuals; they do not carry Atlaskit analytics.

## Deployment recommendation

Ready for a development-environment deploy after the owner's review: run `forge lint` and the `forge-app-review` checklist (no manifest change in this branch, so no new consent). Verify in Jira: light/dark live switch, Appearance override, Settings truth against the installed scopes, and Windows High Contrast if available.
