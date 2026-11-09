# Design system

Built with the Hallmark design skill (custom route, app-screen scope) on top of the Atlassian Design System.

## Idea

Every surface is read on the incident clock. Changes, plans and rehearsals are placed against recovery deadlines. The signature object is the **rehearsal time rail**: decisions land as logged events at their simulated minute, and objective deadlines cut across the rail as dashed lines that turn green (met) or red (missed).

## Look

| Role                 | Token                                                                    | Source                                                                                                        |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Ground, ink, borders | `--color-paper*`, `--color-ink*`, `--color-rule*`                        | Jira host ADS tokens (`--ds-surface`, `--ds-text`, `--ds-border` ...), so light and dark follow Jira          |
| Accent               | `--color-accent` `oklch(52% 0.13 50)`, dark `oklch(72% 0.13 55)`         | Forge copper, from the product name. Used only for the clock, issue keys, current nav item and decision hover |
| Status               | `--color-success`, `--color-error`, `--color-warning`                    | ADS semantic tokens, always paired with a word                                                                |
| Demo data            | `--color-demo`                                                           | ADS discovery tokens; every synthetic item says "Synthetic demo data"                                         |
| Type                 | System sans; system mono for the clock, issue keys and JQL               | Matches Jira; Forge CSP needs no font egress                                                                  |
| Scale                | 0.75 / 0.875 / 1 / 1.125 / 1.266 / 1.424 / 1.602 rem (ratio about 1.125) |                                                                                                               |
| Spacing              | 2, 4, 8, 12, 16, 24, 40, 64 px                                           |                                                                                                               |
| Controls             | 36px controls, 44px hit targets on touch                                 |                                                                                                               |
| Radius               | 6px controls, 8px panels                                                 |                                                                                                               |

Primary buttons stay Atlaskit brand blue to match Jira's own primary actions.

## Rules

- Every colour and font goes through a token in `static/app/src/styles/tokens.css`.
- No card inside a card; regions are separated by hairlines.
- Tables use horizontal rules only and restack into labelled blocks under 40rem.
- Sidebar navigation collapses to a menu under 60rem.
- Every data region has loading (skeleton), empty (with one action), error (with retry) and full states.
- Motion is state only (120 to 220 ms, colour and opacity); `prefers-reduced-motion` removes it.
- Labels are sentence case and never tracked capitals; no decorative status dots.
- Nothing interactive is a mock: unavailable screens say "Planned for Mx" and offer a working alternative.

## Checking

```bash
node ~/.claude/skills/hallmark/scripts/sloplint.mjs static/app/src static/app/index.html --scope app --genre modern-minimal
```

Latest result: 0 FAIL, 0 REFLEX, 0 WARN.
