import { Button } from '../Button';
import type { JiraIssueSummary } from '@shared/api';
import { useChangeSelection } from '../../lib/changeSelection';

/** Row action that opens the readiness check for one change. Nothing runs until it is pressed. */
export function CheckImpactButton({ issue }: { issue: JiraIssueSummary }) {
  const { checkChange } = useChangeSelection();
  return (
    <Button
      spacing="compact"
      variant="primary"
      onClick={() => checkChange(issue)}
      aria-label={`Check recovery impact of ${issue.key}`}
    >
      Check recovery impact
    </Button>
  );
}
