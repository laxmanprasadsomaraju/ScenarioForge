# Accessibility statement (DRAFT, for owner review)

ScenarioForge for Jira aims to meet **WCAG 2.2 level AA**. This target is **not yet audited**. Do not claim conformance until an audit is recorded.

What the current UI does, per `static/app/src`:

- It is built on Atlassian Design System components and tokens (`--sf-*` over ADS), including light and dark themes (an Appearance control).
- Keyboard navigation works across the side navigation. After navigation, focus moves to the new screen (`Shell.tsx`). A collapsed rail keeps accessible names through labels and titles.
- Status is never shown by colour alone: lozenges carry the text Confirmed, Suspected or Not assessed.
- ARIA roles and labels are used across the components (about 150 `aria-*` / `role=` usages).
- The simulated clock is text, with no time-limited interaction that cannot be paused. [VERIFY against Rehearsals.]

Known gaps / to verify before claiming AA:

- A screen-reader pass (VoiceOver and NVDA) over the five journey screens.
- Contrast checks of custom tokens in both themes.
- Reflow at 320 px and 200% zoom.

Feedback: [ACCESSIBILITY CONTACT EMAIL].
