# Sidebar fix: live acceptance

Environment: `confluence-test`, app 2.6.0, built from `integration/lanes-1` @ 1a517f9 (sidebar fix 980b2db). Run by the owner in real Jira, 2026-11-11.

## Live-verified (owner)

| #   | Check                                                      | Result |
| --- | ---------------------------------------------------------- | ------ |
| 1   | Footer stays visible (Settings, Appearance reachable)      | Passed |
| 2   | Long-page scrolling keeps the sidebar correctly positioned | Passed |
| 3   | No sidebar jump while skeletons load                       | Passed |
| 4   | Collapse remembered after reload                           | Passed |
| 5   | Browser Back/Forward                                       | Passed |
| 6   | Narrow-window drawer opens and closes                      | Passed |

**Status: Accepted** for the sidebar's primary functionality.

## Pending (not live-verified; do not mark passed without evidence)

- 600px-tall viewport (local harness: passes in a fixed-height frame; fails only if Jira sizes the frame to content).
- 200% browser zoom (local emulation only).
- Keyboard focus trap and restoration in the mobile drawer (component tests only).
- Light / Dark / Match Jira persistence after reload (component tests only).
