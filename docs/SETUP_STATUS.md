# Setup status

Verified on 2026-11-09 unless noted. "Verified" means checked by a command in this session; "Reported" means stated by the owner and not independently checked.

## Machine

| Item                  | Value                                                                           | How                                           |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| OS                    | macOS 26.6.2, arm64                                                             | Verified (`sw_vers`, `uname -m`)              |
| Node.js               | 24.22.2 LTS via nvm (22.23.3 kept as nvm default)                               | Verified, installed this session              |
| npm                   | 11.19.1                                                                         | Verified                                      |
| Git                   | 2.54.0 (Apple Git)                                                              | Verified after the Xcode licence was accepted |
| GitHub CLI            | Authenticated as `laxmanprasadsomaraju` (active)                                | Verified (`gh auth status`)                   |
| Python                | 3.12.7                                                                          | Verified                                      |
| Forge CLI             | 15.1.0                                                                          | Verified, installed this session              |
| Forge AI plugin       | `forge-skills@atlassian-forge-skills` (Forge MCP and ADS MCP servers, 7 skills) | Verified install                              |
| Hallmark design skill | `~/.claude/skills/hallmark` (via `npx skills add nutlope/hallmark`)             | Verified install                              |

## Accounts and sites

| Item                                             | Value                                                                | How                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| Forge login                                      | somarajulaxmanprasad101@gmail.com                                    | Verified (`forge whoami`)                                      |
| Developer space                                  | ScenarioForge Dev                                                    | Reported                                                       |
| App ID                                           | `ari:cloud:ecosystem::app/113a7a88-0d52-4161-b72e-791a83bd9355`      | Verified (manifest, deploy)                                    |
| Development site                                 | https://one-atlas-cegq.atlassian.net (Forge demo site)               | Verified (install)                                             |
| Site expiry                                      | 2027-02-07                                                           | Reported. Judging ends 2027-02-03, leaving four days of margin |
| Installation                                     | `3edeba6c-fe02-4ad8-a48a-4468dc416a08`, development, Jira, version 2 | Verified (`forge install list`)                                |
| Confluence, JSM, Rovo on demo site               | Not yet checked                                                      | Open for M2                                                    |
| Separate Standard subscriptions (Jira, JSM, CSM) | Owner to confirm trial vs billable at admin.atlassian.com → Billing  | Not checked                                                    |

## Git

- Repository: https://github.com/laxmanprasadsomaraju/ScenarioForge
- Local identity (repo only): `laxmanprasadsomaraju <108981216+laxmanprasadsomaraju@users.noreply.github.com>`
- Global Git identity on this machine is an employer account and is **not** used here.

## Open items

1. Open **Apps → ScenarioForge** in Jira, grant access, and confirm live issues load (needs a signed-in browser; not possible from the CLI).
2. Confirm which products the demo site includes (Confluence and JSM are needed for M2).
3. An API token was pasted into a chat transcript on 2026-11-09. It must be revoked and replaced.
