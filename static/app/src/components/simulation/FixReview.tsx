import type { ChangeRecoveryFinding } from '@shared/analysis/types';
import { StatusBadge, type StatusTone } from '../Badge';

/**
 * The four states a fix can be in, kept apart so a simulated approval never
 * reads as a real change. Only the first two can be true today.
 */
export type FixStateId = 'proposed' | 'approved' | 'work-item' | 'runbook';

export interface FixState {
  id: FixStateId;
  label: string;
  value: string;
  tone: StatusTone;
}

export function fixStates(approval: 'approved' | 'applied' | 'not-approved'): FixState[] {
  return [
    { id: 'proposed', label: 'Proposed', value: 'Yes, by this report', tone: 'info' },
    {
      id: 'approved',
      label: 'Approved (simulated, this tab)',
      value:
        approval === 'applied'
          ? 'Applied in this retest (demo approval).'
          : approval === 'approved'
            ? 'Approved for the retest'
            : 'Not approved',
      tone: approval === 'not-approved' ? 'unknown' : 'success',
    },
    {
      id: 'work-item',
      label: 'Jira work item created',
      value: 'Not available: write permission not granted',
      tone: 'unknown',
    },
    { id: 'runbook', label: 'Runbook updated', value: 'Not tracked', tone: 'unknown' },
  ];
}

export function FixStateList({ title, states }: { title: string; states: FixState[] }) {
  return (
    <dl className="fix-states" aria-label={`States of ${title}`}>
      {states.map((s) => (
        <div key={s.id} className={`fix-state fix-state-${s.id}`}>
          <dt>{s.label}</dt>
          <dd>
            <StatusBadge tone={s.tone}>{s.value}</StatusBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The exact correction: the dependency the step uses now, and what replaces it. */
export function Correction({ finding }: { finding: ChangeRecoveryFinding }) {
  const { subject } = finding;
  return (
    <div className="correction" role="group" aria-label="Exact correction">
      <p className="correction-where">
        {finding.pageTitle}, step {finding.stepOrder}
      </p>
      <p className="correction-swap">
        <span className="correction-old">
          <span className="correction-label">Now uses</span>
          <del>{subject.display}</del>
        </span>
        <span className="correction-arrow" aria-hidden="true">
          →
        </span>
        <span className="correction-new">
          <span className="correction-label">Proposed replacement</span>
          {subject.replacement ? (
            <ins>{subject.replacement}</ins>
          ) : (
            <span className="correction-unknown">Not stated in {finding.changeKey}</span>
          )}
        </span>
      </p>
      <blockquote className="correction-quote">
        {finding.changeKey}: “{subject.excerpt}”
      </blockquote>
    </div>
  );
}
