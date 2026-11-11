# ScenarioForge design system

Built with the Hallmark design skill (custom route, app-screen scope, genre modern-minimal) on top of the Atlassian Design System (ADS). Source of truth: `static/app/src/styles/` (tokens in `tokens.css`, everything else reads them).

## Idea

Every surface is read on the incident clock. Changes, runbooks and rehearsals are placed against recovery deadlines. The signature object is the **rehearsal time rail**: decisions land as logged events at their simulated minute, and objective deadlines cut across the rail as dashed lines that turn met or missed.

## Tokens

Two layers. ADS tokens (`--ds-*`) own light/dark truth for neutrals and status. The semantic layer (`--sf-*`) names product roles, aliases ADS, and owns only what ADS lacks. Components read `--sf-*` only. The legacy `--color-*` aliases were removed in Phase E.

| Group    | Tokens                                                                                                                     | Notes                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Surfaces | `--sf-surface`, `-sunken`, `-raised`, `-overlay`, `-hover`, `-pressed`, `--sf-surface-command`                             | Light fallbacks tinted (`#fffdfb`), never pure white; command band is a warm copper tint  |
| Text     | `--sf-text`, `--sf-text-subtle`, `--sf-text-subtlest`                                                                      | ADS text roles                                                                            |
| Lines    | `--sf-border`, `--sf-border-bold`, `--sf-focus`                                                                            | Focus = ADS `border.focused`                                                              |
| Brand    | `--sf-accent-text`, `-bold`, `-ink`, `-subtle`, `-border`                                                                  | Forge copper (OKLCH), redefined for dark. Identity and state only, never a second primary |
| Actions  | `--sf-action-primary[-hover/-pressed/-text]`, `--sf-action-danger*`, `--sf-action-neutral*`, `--sf-action-disabled[-text]` | ADS button roles; primary stays Jira blue                                                 |
| Status   | `--sf-status-{success,danger,warning,info,unknown}[-bg]`, `--sf-status-unknown-border`                                     | Always paired with a word and an icon                                                     |
| Origin   | `--sf-origin-{live,modelled,synthetic,session}[-bg]`                                                                       | Live blue, modelled teal, synthetic purple, session grey; never success green             |
| Shadow   | `--sf-shadow-raised`, `--sf-shadow-overlay`                                                                                | ADS elevation                                                                             |
| Type     | `--font-display/body` system sans, `--font-outlier` system mono (clock, issue keys, JQL)                                   | Scale `--text-xs`…`--text-3xl`: 0.75 / 0.875 / 1 / 1.125 / 1.266 / 1.424 / 1.602 rem      |
| Space    | `--space-3xs`…`--space-2xl`: 2, 4, 8, 12, 16, 24, 40, 64 px                                                                |                                                                                           |
| Shape    | `--radius-badge` 4, `-control` 6, `-panel` 8, `-band` 12                                                                   |                                                                                           |
| Layout   | `--container` 1360px (centred), `--sidebar` 248, `--rail` 64, `--topbar-h` 56, `--control-h` 36, `--hit` 44                |                                                                                           |
| Motion   | `--dur-micro` 120ms, `--dur-short` 220ms, `--ease-out`, `--ease-in-out`                                                    |                                                                                           |

Status mapping: resolved / objective met → success; still failing / missed / error → danger; confirmed finding, inconclusive, deadline near → warning; suspected → warning text, dashed outline; not assessed, no findings, not measured, not connected → unknown (grey, dashed, question icon). "No findings" is never green; a null figure shows "Not assessed", never 0.

## Themes

- In Jira, `view.theme.enable()` injects ADS tokens on `html[data-color-mode]` and follows Jira's live theme switches.
- The Appearance control (sidebar footer and Settings) offers Match device / Light / Dark, stored in `localStorage` (`sf.appearance`, try/catch). An explicit choice loads the bundled ADS theme onto the app root as a subtree theme (`data-subtree-theme`), so the `--sf-*` aliases are re-declared there.
- `index.html` paints `Canvas` with `color-scheme: light dark` before the bundle runs (no inline script: Forge CSP).

## Components

| Component                                                                 | File                                    | States                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Shell (sidebar, rail, mobile drawer)                                      | `components/Shell.tsx`                  | expanded, rail (remembered), drawer with Escape + focus return              |
| PageHeader                                                                | `components/PageHeader.tsx`             | title, lead, aside                                                          |
| Button                                                                    | `components/Button.tsx`, `buttons.css`  | primary, secondary, subtle, danger; compact; hover, active, focus, disabled |
| StatusBadge, OriginBadge, OriginTag                                       | `components/Badge.tsx`, `OriginTag.tsx` | six tones, four origins                                                     |
| StatusLozenge (Jira status)                                               | `components/StatusLozenge.tsx`          | new, in progress, done, unknown                                             |
| Notice (section message)                                                  | `components/States.tsx`                 | error, warning, information, optional action                                |
| ErrorPanel, EmptyState, SkeletonRows, ScreenSkeleton, ScreenErrorBoundary | `components/States.tsx`                 | loading, empty, error with retry                                            |
| DataRegion                                                                | `components/DataRegion.tsx`             | loading, empty, error, ready                                                |
| JourneyStrip, StatTile, HowItWorks                                        | `components/command/*`                  | done/current/ahead; value or "Not assessed"; dismissible                    |
| AnalysisStatement, FindingItem, CoverageFacts, ImpactPath                 | `components/readiness/*`                | findings, no findings, not assessed                                         |
| AskRovo                                                                   | `components/AskRovo.tsx`                | rendered only when `rovo.isEnabled()` resolves true; hides if open fails    |
| Briefing, Rehearsal, TimeRail, Debrief, RetestVerdict, RemediationPreview | `components/simulation/*`               | briefing, running, ended; resolved / still failing / inconclusive           |
| AppearanceControl                                                         | `components/AppearanceControl.tsx`      | system, light, dark                                                         |

Native parts (Button, Notice, lozenge, spinner) replace `@atlaskit/button`, `section-message`, `lozenge` and `spinner` to keep the initial bundle small; they use the same ADS tokens and sizes.

## States

Every data region has loading (skeleton), empty (with one action), error (with retry) and full states, and an origin badge. Unavailable screens (Crisis room) say "Coming later", list planned capabilities and offer a working alternative; nothing non-functional looks operable.

## Responsive

| Width | Shell                          | Layout                                                         |
| ----- | ------------------------------ | -------------------------------------------------------------- |
| 375   | App bar + drawer               | single column; tables restack into labelled blocks under 40rem |
| 768   | App bar + drawer (under 60rem) | single column                                                  |
| 1024  | Rail                           | two columns where paired                                       |
| 1440  | Expanded sidebar, collapsible  | briefing: start action above the fold                          |
| 1920  | Expanded sidebar               | content capped at 1360px and centred                           |

`html` and `body` carry `overflow-x: clip`; no route scrolls horizontally at any of these widths.

## Motion

State only: colour and opacity, 120–220 ms. `prefers-reduced-motion` removes transitions and slows the connection spinner.

## Accessibility

- Focus: 2px `--sf-focus` outline, 2px offset, on every interactive element in both themes; `Highlight` in forced colours.
- Forced colours (`components/forced-colors.css`): borders restored on badges, notices, lozenges, decisions, nav and buttons; current/selected use `Highlight`/`HighlightText`.
- Status is never colour alone (word + icon). Text ≥ 4.5:1, boundaries ≥ 3:1 (Phase A contrast table).
- Route changes move focus to `main`; each rehearsal decision moves focus to the new situation.
- Keyboard-only MC-62 workflow is covered by `static/app/test/KeyboardFlow.test.tsx`.

## Rules

- Every colour goes through a token in `tokens.css`; no literal colour elsewhere.
- No card inside a card; regions are separated by hairlines.
- Labels sentence case, never tracked capitals; no decorative status dots.
- One primary button per view.
- No milestone codes in UI strings.

## Checking

```bash
node ~/.claude/skills/hallmark/scripts/sloplint.mjs static/app/src static/app/index.html --scope app
```

Latest result (Phase E): 0 FAIL, 0 REFLEX, 0 WARN across 73 files.
