import type { RehearsalOutcomeOutput, RehearsalRetestSummary } from '../../shared/agents/contracts';
import type { EvidenceReference, ObjectiveResult } from '../../shared/domain/types';

/**
 * The read side of durable rehearsal history that `explain-outcome` needs
 * (docs/M6_PLAN.md §6). Minimal on purpose: storage, the audit replay and the
 * fingerprint check belong to the history lane; this action only reads the
 * result. No write method exists here.
 */

/** One stored run as the reader returns it, after its own integrity checks. */
export interface StoredRunOutcome {
  sessionId: string;
  /** Who ran it. The action answers NOT_FOUND for anyone else. */
  ownerAccountId: string;
  scenarioId: string;
  /**
   * True only when `verifyAuditRecord` replayed the stored decisions and the
   * scenario fingerprint matched. Anything else is reported as not assessed.
   */
  auditVerified: boolean;
  status: 'completed' | 'in-progress';
  objectives: ObjectiveResult[] | null;
  metCount: number | null;
  totalCount: number | null;
  elapsedMinutes: number;
  /** From `decisionTrail`; narratives are authored scenario text. */
  trail: RehearsalOutcomeOutput['trail'];
  retest: RehearsalRetestSummary | null;
  evidence: EvidenceReference[];
  /** Changes whenever the stored record changes; part of the cache key. */
  version: string | number;
}

export type HistoryLookup =
  { status: 'found'; run: StoredRunOutcome } | { status: 'not-found' } | { status: 'unavailable' };

export interface HistoryReader {
  /**
   * Reads one run for `accountId`. Implementations should already scope by
   * owner; the action checks `ownerAccountId` again regardless.
   */
  getRun(accountId: string, sessionId: string): Promise<HistoryLookup>;
}
