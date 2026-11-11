import type { ReactNode } from 'react';
import { StatusBadge } from '../Badge';

/**
 * One figure on the Command center. `value: null` never renders as 0: it
 * shows the `missing` word ("Not assessed" or "Not available") instead.
 */
export function StatTile({
  label,
  value,
  missing = 'Not assessed',
  scope,
  note,
}: {
  label: string;
  value: number | null;
  missing?: 'Not assessed' | 'Not available' | 'Loading';
  /** Where the figure comes from: "This session", "Live from Jira", "Saved history". */
  scope: string;
  note?: ReactNode;
}) {
  return (
    <div className="stat-tile">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">
        {value === null ? (
          <StatusBadge tone="unknown">{missing}</StatusBadge>
        ) : (
          <span className="num">{value}</span>
        )}
      </dd>
      <dd className="stat-scope">{scope}</dd>
      {note ? <dd className="stat-note">{note}</dd> : null}
    </div>
  );
}

export interface JourneyStep {
  name: string;
  /** What exists now for this step, in words. */
  status: string;
  /** True when this session (or saved history) has something for this step. */
  active: boolean;
  onOpen: () => void;
  openLabel: string;
}

/** Detect, Understand, Rehearse, Fix, Verify: each step says what exists now. */
export function JourneyStrip({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="journey" aria-label="Recovery journey">
      {steps.map((s, i) => (
        <li key={s.name} className="journey-step" data-active={s.active}>
          <span className="journey-index num" aria-hidden="true">
            {i + 1}
          </span>
          <button
            type="button"
            className="journey-link"
            onClick={s.onOpen}
            aria-label={s.openLabel}
          >
            {s.name}
          </button>
          <span className="journey-status">{s.status}</span>
        </li>
      ))}
    </ol>
  );
}
