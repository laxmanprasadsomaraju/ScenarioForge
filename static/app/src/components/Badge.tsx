import type { ReactNode } from 'react';
import StatusSuccessIcon from '@atlaskit/icon/core/status-success';
import StatusErrorIcon from '@atlaskit/icon/core/status-error';
import StatusWarningIcon from '@atlaskit/icon/core/status-warning';
import StatusInformationIcon from '@atlaskit/icon/core/status-information';
import QuestionCircleIcon from '@atlaskit/icon/core/question-circle';

/**
 * Status tones (docs/UI_REDESIGN_PHASE_A.md § 5.2). The word always carries
 * the meaning; the icon repeats it, colour comes last.
 *
 * - success: gap resolved, objective met
 * - danger: gap still failing, objective missed, error
 * - warning: confirmed finding, inconclusive retest, deadline approaching
 * - suspected: a weaker warning, warning text with a dashed outline
 * - unknown: not assessed, no findings, not measured, not connected.
 *   Grey, dashed, question icon: it never looks like success.
 * - info: neutral information
 */
export type StatusTone = 'success' | 'danger' | 'warning' | 'suspected' | 'info' | 'unknown';

const ICONS = {
  success: StatusSuccessIcon,
  danger: StatusErrorIcon,
  warning: StatusWarningIcon,
  suspected: StatusWarningIcon,
  info: StatusInformationIcon,
  unknown: QuestionCircleIcon,
} as const;

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <span className={`badge badge-${tone}`}>
      <Icon label="" size="small" />
      <span>{children}</span>
    </span>
  );
}

/**
 * Where a region's content comes from. Live is information blue (never the
 * success green), modelled teal, synthetic purple, session grey.
 */
export type Origin = 'live' | 'modelled' | 'synthetic' | 'session';

export function OriginBadge({ origin, children }: { origin: Origin; children: ReactNode }) {
  return <span className={`badge badge-origin badge-origin-${origin}`}>{children}</span>;
}
