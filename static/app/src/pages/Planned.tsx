import { Button } from '../components/Button';
import type { RouteId } from '../lib/routes';
import { useRouter } from '../lib/router';
import { StatusBadge } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';

interface PlannedScreen {
  title: string;
  lead: string;
  milestone: string;
  will: string[];
  meanwhile: { label: string; route: RouteId };
}

export type PlannedId = 'crisis-room';

export const PLANNED: Record<PlannedId, PlannedScreen> = {
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
        aside={<StatusBadge tone="unknown">{`Planned for ${screen.milestone}`}</StatusBadge>}
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
        <Button variant="secondary" onClick={() => navigate(screen.meanwhile.route)}>
          {screen.meanwhile.label}
        </Button>
      </section>
    </>
  );
}
