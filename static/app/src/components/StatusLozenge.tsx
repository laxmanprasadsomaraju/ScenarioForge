import type { JiraIssueSummary } from '@shared/api';

/** Jira's own status, styled as the ADS lozenge (native, so it costs no Atlaskit runtime). */
export function StatusLozenge({ issue }: { issue: JiraIssueSummary }) {
  return <span className={`lozenge lozenge-${issue.statusCategory}`}>{issue.status}</span>;
}
