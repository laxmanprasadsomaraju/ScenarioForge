import { StatusBadge, type StatusTone } from '../Badge';
import { CHECKED_TEXT, type CheckedStatus } from './records';

/** Integrity states of a saved record, plus history being unreadable or not yet opened. */
export type IntegrityState = CheckedStatus | 'unavailable' | 'unchecked';

const TONE: Record<IntegrityState, StatusTone> = {
  verified: 'success',
  tampered: 'danger',
  unverifiable: 'warning',
  'not-found': 'unknown',
  unavailable: 'unknown',
  unchecked: 'info',
};

export const INTEGRITY_TEXT: Record<IntegrityState, string> = {
  ...CHECKED_TEXT,
  unavailable: 'Unavailable',
  unchecked: 'Saved, checked when opened',
};

/** The word carries the state; the icon and colour only repeat it. */
export function IntegrityStatus({ state }: { state: IntegrityState }) {
  return <StatusBadge tone={TONE[state]}>{INTEGRITY_TEXT[state]}</StatusBadge>;
}
