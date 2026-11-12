// Regression, M6 Test 12 on rovo-test (2026-11-12): the Exercise Facilitator did not
// explain a saved rehearsal whose session id is a UUID. This runs the real handler
// over a real HistoryStore (in-memory storage) so the id format, owner scoping and
// the "never substitute Jira findings" rule are covered end to end.
import { describe, expect, it, vi } from 'vitest';
import { UsageGovernor } from '../shared/agents/budget';
import { InMemoryStorage } from '../shared/agents/storage';
import { analyzeChange } from '../shared/analysis';
import type { ChangeAnalysis, RunbookEvidence } from '../shared/analysis/types';
import type { SimulationScenario } from '../shared/domain/types';
import { HistoryStore } from '../shared/history';
import type { HistoryUser, RunSubmission, TrustedScenario } from '../shared/history';
import { generateRehearsal } from '../shared/rehearsal/generate';
import { evaluateSession } from '../shared/simulation/engine';
import { replaySession, scenarioFingerprint } from '../shared/simulation/replay';
import type { ActionCache } from '../src/agents/actions';
import { createForgeActionHandlers } from '../src/agents/forge';
import { ruleEngine } from '../src/analysis/ruleEngine';
import { change, RB_AUTH_STEPS, runbook } from './fixtures/analysis/cases';

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => {
      throw new Error('asUser must not be reached: explain-outcome reads history only');
    },
  },
  route: () => '',
}));

const NOW = () => new Date('2026-11-12T12:00:00.000Z');
const START = '2026-11-12T10:00:00.000Z';
const INSTALL = 'ari:cloud:jira::site/4f7c1b2e-9d3a-4c61-8f00-1a2b3c4d5e6f';
const OWNER: HistoryUser = {
  installation: INSTALL,
  accountId: '557058:f58131cb-b67d-43c7-b30d-6b58d40bd077',
};
const OTHER_ACCOUNT = '5b10ac8d82e05b22cc7d4ef5';
const MC62_DESCRIPTION =
  'Synthetic change for ScenarioForge testing.\n\nWe will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const SESSION = '1459b9cf-a8b0-464a-88c1-c2737e36098e';

function rehearsal(): TrustedScenario {
  const live: RunbookEvidence = {
    ...runbook('98305', '[DEMO] RB-AUTH-01 Customer sign-in recovery', RB_AUTH_STEPS),
    origin: 'live',
  };
  const analysis: ChangeAnalysis = analyzeChange(
    change('MC-62', '[DEMO] Retire LegacyAuth backup SSO tenant', MC62_DESCRIPTION, {
      origin: 'live',
    }),
    [live],
    '2026-11-12T09:30:00.000Z',
  );
  const result = generateRehearsal({
    analysis,
    findingId: analysis.findings[0]!.id,
    restoreTargetMinutes: 30,
  });
  if (!result.ok) throw new Error(result.message);
  return result.rehearsal;
}

function submit(
  scenario: SimulationScenario,
  decisions: string[],
  sessionId: string,
): RunSubmission {
  const session = replaySession(scenario, decisions, sessionId, START);
  return {
    sessionId,
    startedAt: START,
    decisionIds: decisions,
    scenarioFingerprint: scenarioFingerprint(scenario),
    evaluation: evaluateSession(scenario, session),
    flags: session.flags,
  };
}

const cache = {
  get: vi.fn(async () => ({ hit: false as const, reason: 'MISS' as const })),
  put: vi.fn(async () => {}),
};

async function governorOn() {
  const storage = new InMemoryStorage();
  await storage.set('ai-governance:settings', { aiEnabled: true }, null);
  return new UsageGovernor({ storage, now: NOW });
}

async function setup() {
  const storage = new InMemoryStorage();
  const governor = await governorOn();
  const store = new HistoryStore({ storage, now: NOW });
  const trusted = rehearsal();
  const saved = await store.saveRun(
    OWNER,
    trusted,
    submit(
      trusted.scenario,
      ['follow-step', 'retry-step', 'notify-now', 'investigate-step', 'use-replacement'],
      SESSION,
    ),
  );
  expect(saved).toMatchObject({ status: 'SAVED', id: SESSION });
  const handlers = createForgeActionHandlers({
    userGateways: vi.fn(() => {
      throw new Error('no Jira or Confluence gateway may be built for explain-outcome');
    }) as never,
    engine: ruleEngine,
    governor: () => governor,
    cache: () => cache as unknown as ActionCache,
    historyStore: () => store,
    now: NOW,
    aiEnabled: () => true,
    linkBase: async () => null,
  });
  return handlers;
}

describe('explain-outcome over a saved run with a UUID session id', () => {
  it('explains the stored outcome for its owner and calls no Jira or Confluence', async () => {
    const handlers = await setup();
    const out = (await handlers['explain-outcome'](
      { sessionId: SESSION },
      { accountId: OWNER.accountId, installContext: INSTALL },
    )) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, sessionId: SESSION });
    expect(out.objectives).toBeTruthy();
    expect(out.consequencesModelled).toBe(true);
    expect(JSON.stringify(out)).not.toContain(OWNER.accountId);
  });

  it('answers NOT_FOUND for another user, never Jira findings', async () => {
    const handlers = await setup();
    const out = (await handlers['explain-outcome'](
      { sessionId: SESSION },
      { accountId: OTHER_ACCOUNT, installContext: INSTALL },
    )) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(out).not.toHaveProperty('findings');
  });

  it('answers NOT_FOUND for an unknown id and history unavailable without storage', async () => {
    const handlers = await setup();
    const unknown = await handlers['explain-outcome'](
      { sessionId: '00000000-0000-4000-8000-000000000000' },
      { accountId: OWNER.accountId, installContext: INSTALL },
    );
    expect(unknown).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const governor2 = await governorOn();
    const noStore = createForgeActionHandlers({
      userGateways: vi.fn() as never,
      engine: ruleEngine,
      governor: () => governor2,
      cache: () => cache as unknown as ActionCache,
      historyStore: () => null,
      now: NOW,
      aiEnabled: () => true,
      linkBase: async () => null,
    });
    expect(
      await noStore['explain-outcome'](
        { sessionId: SESSION },
        { accountId: OWNER.accountId, installContext: INSTALL },
      ),
    ).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR' });
  });
});
