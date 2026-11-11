import { useState } from 'react';
import { Button } from '../Button';
import type { ChangeAnalysis } from '@shared/analysis/types';
import { DEFAULT_NOTIFY_TARGET_MINUTES, generateRehearsal } from '@shared/rehearsal/generate';
import { useRehearsalSource } from '../../lib/rehearsalSource';
import { useRouter } from '../../lib/router';

const CONFIDENCE: Record<'confirmed' | 'suspected', string> = {
  confirmed: 'Confirmed',
  suspected: 'Suspected',
};

/** Values a link fills in. They are only a starting point the user can change. */
export interface RehearsePrefill {
  findingId: string;
  restore?: number;
  notify?: number;
}

const WHOLE = /^\d+$/;

/**
 * Builds a deterministic rehearsal from one finding. The restore target is
 * asked for, never assumed, because no service tier is known yet (M4 sources
 * are not connected). A link may fill in the form, but only for a finding the
 * user's own result contains, and nothing runs until the button is pressed.
 */
export function RehearseFinding({
  analysis,
  prefill,
}: {
  analysis: ChangeAnalysis;
  prefill?: RehearsePrefill;
}) {
  const { selectGenerated } = useRehearsalSource();
  const { navigate } = useRouter();
  const usable = prefill !== undefined && analysis.findings.some((f) => f.id === prefill.findingId);
  const [findingId, setFindingId] = useState(
    usable ? prefill.findingId : (analysis.findings[0]?.id ?? ''),
  );
  const [target, setTarget] = useState(usable && prefill.restore ? String(prefill.restore) : '');
  const [notify, setNotify] = useState(usable && prefill.notify ? String(prefill.notify) : '');
  const [error, setError] = useState<string | null>(null);

  if (analysis.status !== 'findings' || analysis.findings.length === 0) return null;

  const minutes = Number(target);
  const targetValid = WHOLE.test(target) && minutes >= 5 && minutes <= 1440;
  const notifyMinutes = Number(notify);
  const notifyValid =
    notify === '' || (WHOLE.test(notify) && notifyMinutes >= 1 && notifyMinutes <= 240);

  const rehearse = () => {
    const result = generateRehearsal({
      analysis,
      findingId,
      restoreTargetMinutes: minutes,
      ...(notify !== '' ? { notifyTargetMinutes: notifyMinutes } : {}),
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    selectGenerated(result.rehearsal, analysis);
    navigate('simulations');
  };

  return (
    <section className="region rehearse-finding next-action" aria-labelledby="rehearse-title">
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
          if (targetValid && notifyValid) rehearse();
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
        <label className="field">
          <span className="field-label">Notify target (minutes, optional)</span>
          <input
            type="text"
            inputMode="numeric"
            name="notify-target"
            autoComplete="off"
            placeholder={`Default ${DEFAULT_NOTIFY_TARGET_MINUTES}`}
            value={notify}
            aria-invalid={!notifyValid}
            aria-describedby="notify-help"
            onChange={(e) => setNotify(e.target.value.trim())}
          />
          <span id="notify-help" className="field-help">
            {notifyValid ? ' ' : 'Enter whole minutes from 1 to 240, or leave it empty.'}
          </span>
        </label>
        <div className="toolbar-action">
          <Button type="submit" variant="primary" isDisabled={!targetValid || !notifyValid}>
            Rehearse this finding
          </Button>
        </div>
      </form>
      {usable ? (
        <p className="region-body">
          Filled in from a link. Nothing runs until you press Rehearse this finding.
        </p>
      ) : null}
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
