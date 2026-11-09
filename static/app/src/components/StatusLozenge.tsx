import Lozenge from '@atlaskit/lozenge';
import type { JiraIssueSummary } from '@shared/api';

const APPEARANCE = {
  new: 'default',
  indeterminate: 'inprogress',
  done: 'success',
  unknown: 'default',
} as const;

export function StatusLozenge({ issue }: { issue: JiraIssueSummary }) {
  return <Lozenge appearance={APPEARANCE[issue.statusCategory]}>{issue.status}</Lozenge>;
}
