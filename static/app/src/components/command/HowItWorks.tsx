import { useState } from 'react';
import { Button } from '../Button';

export const HOW_IT_WORKS_KEY = 'sf.howItWorks';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(HOW_IT_WORKS_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(HOW_IT_WORKS_KEY, 'dismissed');
  } catch {
    // Storage blocked: the panel stays hidden for this visit only.
  }
}

const STEPS: { name: string; detail: string }[] = [
  { name: 'Detect', detail: 'Pick a recent Jira change.' },
  {
    name: 'Understand',
    detail: 'A readiness check finds the runbook steps that change may break.',
  },
  {
    name: 'Rehearse',
    detail: 'Run the recovery on a simulated clock against its deadlines.',
  },
  { name: 'Fix', detail: 'Approve the fixes the report suggests.' },
  { name: 'Verify', detail: 'Retest with the fixes and compare both runs.' },
];

/**
 * A short, dismissible explanation on the Command center. No tour, no modal:
 * the page works the same with it hidden, and dismissal is remembered per
 * browser when storage allows.
 */
export function HowItWorks({ checked }: { checked: boolean }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  return (
    <section className="how-it-works first-run" aria-labelledby="how-title">
      <div className="how-head">
        <h2 id="how-title" className="section-title">
          How ScenarioForge works
        </h2>
        <Button
          variant="subtle"
          spacing="compact"
          onClick={() => {
            writeDismissed();
            setDismissed(true);
          }}
        >
          Hide this
        </Button>
      </div>
      <p className="how-lead">
        It rehearses recovery from the changes your team ships, read only and as you.
        {checked
          ? ' You have started: the journey below shows where you are.'
          : ' Start with a recent change, or try the synthetic demo first; it is labelled wherever it appears.'}
      </p>
      <ol className="how-steps">
        {STEPS.map((s) => (
          <li key={s.name}>
            <span className="how-step-name">{s.name}</span>
            <span className="how-step-detail">{s.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
