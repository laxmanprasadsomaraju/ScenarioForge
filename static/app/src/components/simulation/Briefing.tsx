import Button from '@atlaskit/button/new';
import type { SimulationScenario } from '@shared/domain/types';
import { EvidenceItem } from './Evidence';

export function Briefing({
  scenario,
  onStart,
}: {
  scenario: SimulationScenario;
  onStart: () => void;
}) {
  const change = scenario.evidence.find((e) => e.id === 'ev-change');
  const service = scenario.evidence.find((e) => e.id === 'ev-service');
  return (
    <div className="briefing">
      <section className="region briefing-main" aria-labelledby="briefing-title">
        <h2 id="briefing-title" className="briefing-title">
          {scenario.title}
        </h2>
        <p className="briefing-summary">{scenario.summary}</p>
        <dl className="facts">
          <dt>Your role</dt>
          <dd>Incident commander for Customer Sign-in</dd>
          <dt>Clock</dt>
          <dd>Simulated minutes; each action costs the time it would take in reality</dd>
          <dt>Outcome</dt>
          <dd>Decided by fixed scenario rules, the same every time you make the same choices</dd>
        </dl>
        <div className="briefing-action">
          <Button appearance="primary" onClick={onStart}>
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
        <section className="region">
          <h3 className="section-title">Context</h3>
          {service ? <EvidenceItem evidence={service} /> : null}
          {change ? (
            <p className="region-body">
              Recent change on file: {scenario.changeContext.key}, {scenario.changeContext.summary}.
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
