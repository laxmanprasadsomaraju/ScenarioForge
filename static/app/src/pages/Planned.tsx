import { Button } from '../components/Button';
import type { RouteId } from '../lib/routes';
import { useRouter } from '../lib/router';
import { StatusBadge } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';

interface PlannedCapability {
  title: string;
  detail: string;
}

interface PlannedScreen {
  title: string;
  lead: string;
  why: string;
  will: PlannedCapability[];
  meanwhile: { label: string; route: RouteId; detail: string };
}

export type PlannedId = 'crisis-room';

export const PLANNED: Record<PlannedId, PlannedScreen> = {
  'crisis-room': {
    title: 'Crisis room',
    lead: 'A shared rehearsal where each participant holds a role.',
    why: 'Real incidents are run by several people at once. A solo rehearsal shows whether the runbook works; a team rehearsal shows whether the hand-offs do.',
    will: [
      {
        title: 'Roles',
        detail: 'One exercise with an incident commander, responders and observers.',
      },
      {
        title: 'Live decisions',
        detail: 'Everyone sees the same clock and each decision as it is made.',
      },
      {
        title: 'Who decided what',
        detail: 'The report records each decision with its author and simulated minute.',
      },
    ],
    meanwhile: {
      label: 'Rehearse solo with the demo scenario',
      route: 'simulations',
      detail: 'Solo rehearsals use the same scenarios, clock and report.',
    },
  },
};

/** An honest placeholder: what is planned, nothing that looks operable. */
export function PlannedPage({ id }: { id: PlannedId }) {
  const { navigate } = useRouter();
  const screen = PLANNED[id];
  return (
    <>
      <PageHeader
        title={screen.title}
        lead={screen.lead}
        aside={<StatusBadge tone="unknown">Coming later</StatusBadge>}
      />
      <section className="region planned" aria-labelledby="planned-title">
        <h2 id="planned-title" className="section-title">
          Not available yet
        </h2>
        <p className="region-body">
          This screen has no working features in this build. {screen.why}
        </p>
        <h3 className="planned-subtitle">Planned capabilities</h3>
        <dl className="planned-list">
          {screen.will.map((item) => (
            <div key={item.title} className="planned-item">
              <dt>{item.title}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
        <h3 className="planned-subtitle">Meanwhile</h3>
        <p className="region-body">{screen.meanwhile.detail}</p>
        <div>
          <Button variant="secondary" onClick={() => navigate(screen.meanwhile.route)}>
            {screen.meanwhile.label}
          </Button>
        </div>
      </section>
    </>
  );
}
