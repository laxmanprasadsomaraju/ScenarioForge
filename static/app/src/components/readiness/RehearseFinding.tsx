import { useState } from 'react';
import Button from '@atlaskit/button/new';
import type { ChangeAnalysis } from '@shared/analysis/types';
import { generateRehearsal } from '@shared/rehearsal/generate';
import { useRehearsalSource } from '../../lib/rehearsalSource';
import { useRouter } from '../../lib/router';

const CONFIDENCE: Record<'confirmed' | 'suspected', string> = {
  confirmed: 'Confirmed',
  suspected: 'Suspected',
};

/**
 * Builds a deterministic rehearsal from one finding. The restore target is
 * asked for, never assumed, because no service tier is known yet (M4 sources
 * are not connected).
 */
export function RehearseFinding({ analysis }: { analysis: ChangeAnalysis }) {
  const { selectGenerated } = useRehearsalSource();
  const { navigate } = useRouter();
  const [findingId, setFindingId] = useState(analysis.findings[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (analysis.status !== 'findings' || analysis.findings.length === 0) return null;

  const minutes = Number(target);
  const targetValid = /^\d+$/.test(target) && minutes >= 5 && minutes <= 1440;

  const rehearse = () => {
    const result = generateRehearsal({ analysis, findingId, restoreTargetMinutes: minutes });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    selectGenerated(result.rehearsal);
    navigate('simulations');
  };

  return (
    <section className="region rehearse-finding" aria-labelledby="rehearse-title">
      <h2 id="rehearse-title" className="section-title">
        Rehearse a finding
      </h2>
      <p className="region-body">
        Builds a short outage from the finding: the real change text and the real runbook step.
        Outcomes are modelled by fixed rules, not observed.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (targetValid) rehearse();
        }}
      >
        {analysis.findings.length > 1 ? (
          <label className="field field-grow">
            <span className="field-label">Finding</span>
            <select value={findingId} onChange={(e) => setFindingId(e.target.value)}>
              {analysis.findings.map((f) => (
                <option key={f.id} value={f.id}>
                  {CONFIDENCE[f.confidence]}: step {f.stepOrder} of {f.pageTitle}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">Restore target (minutes)</span>
          <input
            type="text"
            inputMode="numeric"
            name="restore-target"
            autoComplete="off"
            placeholder="For example 30"
            value={target}
            aria-invalid={target !== '' && !targetValid}
            aria-describedby="restore-help"
            onChange={(e) => setTarget(e.target.value.trim())}
          />
          <span id="restore-help" className="field-help">
            {target !== '' && !targetValid ? 'Enter whole minutes from 5 to 1440.' : ' '}
          </span>
        </label>
        <div className="toolbar-action">
          <Button type="submit" appearance="primary" isDisabled={!targetValid}>
            Rehearse this finding
          </Button>
        </div>
      </form>
      <p className="region-body">
        No service tier is connected yet, so ScenarioForge does not assume a restore target.
      </p>
      {error ? (
        <p className="field-help" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
