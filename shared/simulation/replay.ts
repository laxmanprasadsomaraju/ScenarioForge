import type { ExerciseSession, SimulationScenario } from '../domain/types';
import { applyDecision, evaluateSession, SimulationError, startSession } from './engine';
import type { AuditVerification, SessionAuditRecord } from './types';

/**
 * Session replay and audit records.
 *
 * A session is fully determined by (scenario content, session id, start time,
 * decision ids). Persisting that plus the derived results lets a stored session
 * be re-verified later against the scenario it claims to have run on.
 */

/** Reproduces a session by applying `decisionIds` in order from a fresh start. */
export function replaySession(
  scenario: SimulationScenario,
  decisionIds: readonly string[],
  sessionId: string,
  startedAt: string,
): ExerciseSession {
  let session = startSession(scenario, sessionId, startedAt);
  for (const id of decisionIds) {
    session = applyDecision(scenario, session, id);
  }
  return session;
}

/**
 * JSON with object keys sorted, so equal data always gives the same string.
 * Arrays keep their order; `undefined` object fields are dropped, as in JSON.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/**
 * Content fingerprint of a scenario: two 32-bit FNV-1a hashes (different
 * offsets) over its canonical JSON, as 16 hex characters.
 *
 * This detects drift between a stored session and the scenario content it is
 * replayed against (for example two remediation variants that share a version
 * number). It is not a cryptographic signature; tamper resistance for stored
 * records comes from server-side storage (M5).
 */
export function scenarioFingerprint(scenario: SimulationScenario): string {
  const text = canonicalJson(scenario);
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193 ^ 0x5bd1e995);
}

function fnv1a(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Builds an audit record for a session. The session is replayed first, so a
 * session that the engine could not have produced is rejected here rather than
 * persisted.
 */
export function createAuditRecord(
  scenario: SimulationScenario,
  session: ExerciseSession,
): SessionAuditRecord {
  if (session.scenarioId !== scenario.id || session.scenarioVersion !== scenario.version) {
    throw new SimulationError('Session does not belong to this scenario version.');
  }
  const replayed = replaySession(
    scenario,
    session.decisions.map((d) => d.decisionId),
    session.id,
    session.startedAt,
  );
  if (canonicalJson(replayed) !== canonicalJson(session)) {
    throw new SimulationError(`Session ${session.id} does not match its own replay.`);
  }
  return {
    schemaVersion: 1,
    sessionId: replayed.id,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    scenarioFingerprint: scenarioFingerprint(scenario),
    origin: replayed.origin,
    startedAt: replayed.startedAt,
    status: replayed.status,
    elapsedMinutes: replayed.elapsedMinutes,
    decisions: structuredClone(replayed.decisions),
    flags: { ...replayed.flags },
    evaluation: replayed.status === 'completed' ? evaluateSession(scenario, replayed) : null,
  };
}

/**
 * Replays an audit record against `scenario` and checks every derived field.
 *
 * Rejected (never thrown, so callers can show the reasons):
 * - unsupported schema version;
 * - scenario id, version or fingerprint mismatch (replay is not attempted, since
 *   different content can legitimately produce different results);
 * - decisions the engine refuses (unknown, out of order, after completion);
 * - any difference in step ids, minutes, flags, elapsed time, status, origin
 *   or evaluation between the record and the replay.
 */
export function verifyAuditRecord(
  record: SessionAuditRecord,
  scenario: SimulationScenario,
): AuditVerification {
  const problems: string[] = [];
  if (record.schemaVersion !== 1) {
    return { ok: false, problems: [`unsupported schema version ${String(record.schemaVersion)}`] };
  }
  if (record.scenarioId !== scenario.id) {
    problems.push(`scenario id ${record.scenarioId} does not match ${scenario.id}`);
  }
  if (record.scenarioVersion !== scenario.version) {
    problems.push(`scenario version ${record.scenarioVersion} does not match ${scenario.version}`);
  }
  if (problems.length === 0 && record.scenarioFingerprint !== scenarioFingerprint(scenario)) {
    problems.push('scenario content does not match the recorded fingerprint');
  }
  if (problems.length > 0) return { ok: false, problems };

  let expected: SessionAuditRecord;
  try {
    const replayed = replaySession(
      scenario,
      record.decisions.map((d) => d.decisionId),
      record.sessionId,
      record.startedAt,
    );
    expected = createAuditRecord(scenario, replayed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [`replay failed: ${message}`] };
  }

  const fields: (keyof SessionAuditRecord)[] = [
    'origin',
    'status',
    'elapsedMinutes',
    'decisions',
    'flags',
    'evaluation',
  ];
  for (const field of fields) {
    if (canonicalJson(record[field]) !== canonicalJson(expected[field])) {
      problems.push(`${field} does not match the replay`);
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
