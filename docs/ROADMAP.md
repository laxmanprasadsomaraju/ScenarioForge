# Roadmap

Milestones M0–M10 and bonus targets, ordered by dependency. Acceptance checklists live in [MILESTONES.md](MILESTONES.md); current state in [CURRENT_STATUS.md](CURRENT_STATUS.md). Deadline: 22 Dec 2026 12:00 PT (internal target 18 Dec).

## Milestones

| ID  | Milestone                        | Depends on                     | Needs owner approval for                                  |
| --- | -------------------------------- | ------------------------------ | --------------------------------------------------------- |
| M0  | Environment and foundation       | none                           | none                                                      |
| M1  | First working Forge app          | M0                             | none                                                      |
| M2  | Jira, Confluence, JSM context    | M1                             | Confluence scopes on `development` (major version)        |
| M3  | Change-to-recovery intelligence  | M2                             | none                                                      |
| M4  | Recovery readiness graph         | M3; JSM / Teamwork Graph       | JSM Assets scopes; `read:graph:*` scopes; org admin       |
| M5  | Interactive recovery simulation  | M3 (M4 for service tiers)      | `storage:app` for persisted sessions                      |
| M6  | Rovo agent and actions           | M3, M5; `storage:app`; Rovo    | Each rovo-test phase; AI opt-in; any non-test deploy      |
| M7  | Multiplayer crisis room          | M5, M6 storage; Forge Realtime | Any new module/scope                                      |
| M8  | Corrective actions, verification | M5, M6 storage                 | `write:jira-work` (and optional Confluence comment scope) |
| M9  | Bonus integrations               | M6 (MCP), M4 (TWG)             | `rovo:mcp`, graph scopes, Marketplace submission          |
| M10 | Competition release              | M1–M8; chosen M9 targets       | Production deploy, distribution link, submission          |

## Critical path

M3 → M5 → (M6 storage on rovo-test) → M8 approval/write → M10. M6 Phase 2 live test is the gate for the Rovo bonus. M7 is optional for the main track; cut first if time is short.

## Bonus targets (at most one bonus prize per submission)

| Bonus                     | Built on                     | Order               |
| ------------------------- | ---------------------------- | ------------------- |
| Best Rovo Agent           | M6 Phase 2 agents            | 1                   |
| Best MCP App (`rovo:mcp`) | M6 actions re-exposed        | 2                   |
| Best Teamwork Graph       | M4 owning-team edges         | 3                   |
| Best Marketplace app      | Whole app; blocks link share | Owner decision only |

Feasibility and risks: [BONUS_FEASIBILITY.md](BONUS_FEASIBILITY.md); readiness matrix: [CODEGEIST_REQUIREMENTS.md](CODEGEIST_REQUIREMENTS.md).
