import Button from '@atlaskit/button/new';
import type { RouteId } from '../lib/routes';
import { useRouter } from '../lib/router';
import { PageHeader } from '../components/Shell';

interface PlannedScreen {
  title: string;
  lead: string;
  milestone: string;
  will: string[];
  meanwhile: { label: string; route: RouteId };
}

export type PlannedId = 'readiness' | 'crisis-room';

export const PLANNED: Record<PlannedId, PlannedScreen> = {
  readiness: {
    title: 'Readiness checks',
    lead: 'Evidence-backed checks that a recovery plan still works after a change.',
    milestone: 'M3',
    will: [
      'Flag runbook steps that depend on something a change removed.',
      'Cite the Jira issue and runbook text behind every finding.',
      'Keep unverified AI suggestions separate from confirmed facts.',
    ],
    meanwhile: { label: 'Review recent Jira changes', route: 'changes' },
  },
  'crisis-room': {
    title: 'Crisis room',
    lead: 'A shared rehearsal where each participant holds a role.',
    milestone: 'M7',
    will: [
      'Run one exercise with an incident commander, responders and observers.',
      'Sync decisions live with Forge Realtime.',
      'Record who decided what, at which simulated minute.',
    ],
    meanwhile: { label: 'Rehearse solo with the demo scenario', route: 'simulations' },
  },
};

export function PlannedPage({ id }: { id: PlannedId }) {
  const { navigate } = useRouter();
  const screen = PLANNED[id];
  return (
    <>
      <PageHeader
        title={screen.title}
        lead={screen.lead}
        aside={<span className="planned-tag">Planned for {screen.milestone}</span>}
      />
      <section className="region planned" aria-labelledby="planned-title">
        <h2 id="planned-title" className="section-title">
          Not available yet
        </h2>
        <p className="region-body">
          This screen has no working features in this build. When it ships it will:
        </p>
        <ul className="planned-list">
          {screen.will.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <Button appearance="default" onClick={() => navigate(screen.meanwhile.route)}>
          {screen.meanwhile.label}
        </Button>
      </section>
    </>
  );
}
