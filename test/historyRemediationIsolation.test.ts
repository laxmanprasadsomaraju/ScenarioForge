import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../shared/agents/storage';
import { analyzeChange } from '../shared/analysis';
import type { RunbookEvidence } from '../shared/analysis/types';
import { HistoryStore, KEY_PREFIX, MAX_RUNS_PER_USER, runKey } from '../shared/history';
import type { HistoryUser, TrustedScenario } from '../shared/history';
import { encodeSegment } from '../shared/history/keys';
import { generateRehearsal } from '../shared/rehearsal/generate';
import { evaluateSession } from '../shared/simulation/engine';
import { replaySession, scenarioFingerprint } from '../shared/simulation/replay';
import { remediationRecordKey } from '../src/remediation/create';
import { change, RB_AUTH_STEPS, runbook } from './fixtures/analysis/cases';

/**
 * Cross-lane check: remediation records live in the same `rehearsal-history`
 * entity as history, under `remediation-item:<label>`. History must never
 * read, list, prune, overwrite or delete them, and key spaces must not meet.
 */

const T0 = Date.parse('2026-11-10T12:00:00.000Z');
const START = '2026-11-10T10:00:00.000Z';
const USER: HistoryUser = {
  installation: 'ari:cloud:jira::site/abc',
  accountId: '5b10ac8d82e05b22',
};
const LABEL = 'sf-rem-0123456789abcdef';
const COSTLY = ['follow-step', 'retry-step', 'notify-now', 'investigate-step', 'use-replacement'];

function rehearsal(): TrustedScenario {
  const live: RunbookEvidence = { ...runbook('98305', 'RB', RB_AUTH_STEPS), origin: 'live' };
  const analysis = analyzeChange(
    change(
      'MC-62',
      '[DEMO] Retire LegacyAuth backup SSO tenant',
      'We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.',
      { origin: 'live' },
    ),
    [live],
    '2026-11-10T09:30:00.000Z',
  );
  const result = generateRehearsal({
    analysis,
    findingId: analysis.findings[0]!.id,
    restoreTargetMinutes: 30,
  });
  if (!result.ok) throw new Error(result.message);
  return result.rehearsal;
}

function submission(r: TrustedScenario, id: string) {
  const session = replaySession(r.scenario, COSTLY, id, START);
  return {
    sessionId: id,
    startedAt: START,
    decisionIds: COSTLY,
    scenarioFingerprint: scenarioFingerprint(r.scenario),
    evaluation: evaluateSession(r.scenario, session),
    flags: session.flags,
  };
}

describe('history and remediation records share an entity safely', () => {
  it('key spaces are disjoint, even for adversarial ids', () => {
    const rem = remediationRecordKey(LABEL);
    expect(rem.startsWith(`${KEY_PREFIX}:`)).toBe(false);
    for (const id of [rem, 'remediation-item:' + LABEL, 'remediation-item', ':', 'sfh1']) {
      expect(runKey(USER, id).startsWith(`${KEY_PREFIX}:`)).toBe(true);
      expect(runKey(USER, id)).not.toBe(rem);
      expect(encodeSegment(id)).not.toContain(':');
    }
  });

  it('history save, list, get and prune never touch remediation records', async () => {
    const storage = new InMemoryStorage();
    const key = remediationRecordKey(LABEL);
    const record = { schemaVersion: 1, state: 'APPROVED', audit: [] };
    expect((await storage.set(key, record, null)).ok).toBe(true);
    const clock = { now: T0 };
    const store = new HistoryStore({ storage, now: () => new Date(clock.now) });
    const r = rehearsal();
    for (let i = 0; i < MAX_RUNS_PER_USER + 3; i++) {
      clock.now = T0 + i * 60_000;
      await store.saveRun(USER, r, submission(r, `run-${i}`));
    }
    const list = await store.listRuns(USER);
    expect(list.status === 'OK' && list.items.length).toBe(MAX_RUNS_PER_USER);
    expect(JSON.stringify(list)).not.toContain('remediation-item');
    for (const id of [key, LABEL, 'remediation-item:' + LABEL]) {
      expect(await store.getRun(USER, id)).toEqual({ status: 'NOT_FOUND' });
      expect(await store.getComparison(USER, id)).toEqual({ status: 'NOT_FOUND' });
    }
    // Age everything out: retention prunes history but not the remediation record.
    clock.now = T0 + 400 * 24 * 3600 * 1000;
    await store.listRuns(USER);
    const stored = await storage.get(key);
    expect(stored?.value).toEqual(record);
    expect(stored?.version).toBe(1);
    expect(storage.keys().filter((k) => !k.startsWith(`${KEY_PREFIX}:`))).toEqual([key]);
  });
});
