import { useEffect, useRef } from 'react';
import { Button } from '../Button';
import type { SimulationScenario } from '@shared/domain/types';
import type { GeneratedRehearsal } from '@shared/rehearsal/types';
import { useRouter } from '../../lib/router';
import { EvidenceItem } from './Evidence';
import { restoreTarget } from './Objectives';

type Provenance = GeneratedRehearsal['provenance'];

const CONFIDENCE: Record<Provenance['confidence'], string> = {
  confirmed: 'Confirmed finding',
  suspected: 'Suspected finding, not yet confirmed',
};

/**
 * The mission briefing: everything a commander reads before the clock
 * starts. Quotes are shown verbatim; nothing about consequences appears here.
 */
export function Briefing({
  scenario,
  provenance,
  onStart,
  focusOnMount = false,
}: {
  scenario: SimulationScenario;
  provenance?: Provenance;
  onStart: () => void;
  /** Set when returning from a discarded rehearsal, whose controls no longer exist. */
  focusOnMount?: boolean;
}) {
  const { navigate } = useRouter();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus();
  }, [focusOnMount]);
  const change = scenario.evidence.find((e) => e.kind === 'jira-issue');
  const step = scenario.evidence.find((e) => e.kind === 'runbook-step' && e.excerpt);
  const service = scenario.evidence.find((e) => e.kind === 'jsm-service');
  const serviceName = scenario.services[0]?.name;
  const target = restoreTarget(scenario);
  return (
    <div className="briefing">
      <section className="region briefing-main" aria-labelledby="briefing-title">
        <h2 id="briefing-title" className="briefing-title" ref={titleRef} tabIndex={-1}>
          {scenario.title}
        </h2>
        <p className="briefing-summary">{scenario.summary}</p>

        <dl className="facts briefing-facts">
          <dt>Source change</dt>
          <dd>
            <span className="briefing-key">{scenario.changeContext.key}</span>{' '}
            {scenario.changeContext.summary}
          </dd>
          <dt>Confidence</dt>
          <dd>{provenance ? CONFIDENCE[provenance.confidence] : 'Synthetic scenario'}</dd>
          <dt>Your role</dt>
          <dd>
            Incident commander
            {serviceName ? ` for ${serviceName}` : ' for the capability this runbook recovers'}
          </dd>
          {target ? (
            <>
              <dt>Restore target</dt>
              <dd>
                {target.label} <span className="num">(by T+{target.minutes} min)</span>
              </dd>
            </>
          ) : null}
        </dl>

        {change?.excerpt || step?.excerpt ? (
          <div className="briefing-quotes">
            {change?.excerpt ? (
              <figure className="briefing-quote">
                <figcaption>What changed, quoted from {change.title}</figcaption>
                <blockquote>{change.excerpt}</blockquote>
              </figure>
            ) : null}
            {step?.excerpt ? (
              <figure className="briefing-quote">
                <figcaption>Affected runbook step, quoted from {step.title}</figcaption>
                <blockquote>{step.excerpt}</blockquote>
              </figure>
            ) : null}
          </div>
        ) : null}

        <h3 className="section-title">Rules of the exercise</h3>
        <ul className="briefing-rules">
          <li>The clock is simulated; each action costs the minutes it would take in reality.</li>
          <li>
            Outcomes are modelled by fixed scenario rules, not observed. The same choices give the
            same result every time.
          </li>
          <li>You see what an action did only after you choose it.</li>
        </ul>

        <div className="briefing-action">
          <Button variant="primary" onClick={onStart}>
            Start rehearsal
          </Button>
        </div>
      </section>

      <aside className="briefing-side" aria-label="Briefing material">
        <section className="region">
          <h3 className="section-title">Objectives</h3>
          <ol className="objective-brief">
            {scenario.objectives.map((o) => (
              <li key={o.id}>{o.label}</li>
            ))}
          </ol>
        </section>
        <section className="region">
          <h3 className="section-title">Runbook on file</h3>
          <p className="runbook-name">{scenario.procedure.title}</p>
          <ol className="runbook-steps">
            {scenario.procedure.steps.map((s) => (
              <li key={s.order}>{s.instruction}</li>
            ))}
          </ol>
        </section>
        {service ? (
          <section className="region">
            <h3 className="section-title">Service</h3>
            <EvidenceItem evidence={service} />
          </section>
        ) : null}
        <p className="briefing-later">
          Rehearsing as a team with several roles is planned for the{' '}
          <a
            href="/crisis-room"
            onClick={(event) => {
              event.preventDefault();
              navigate('crisis-room');
            }}
          >
            Crisis room
          </a>{' '}
          (coming later).
        </p>
      </aside>
    </div>
  );
}
