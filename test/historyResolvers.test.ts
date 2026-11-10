import { describe, expect, it, vi } from 'vitest';
import type {
  ApiResult,
  RehearsalSourceRef,
  RehearsalSubmission,
  SaveRehearsalResponse,
} from '../shared/api';
import { HISTORY_NOT_ENABLED, rehearsalContentFingerprint } from '../shared/api';
import { InMemoryStorage } from '../shared/agents/storage';
import type { StorageAdapter } from '../shared/agents/storage';
import type { ExerciseSession, SimulationScenario } from '../shared/domain/types';
import { generateRehearsal } from '../shared/rehearsal/generate';
import type { GeneratedRehearsal } from '../shared/rehearsal/types';
import { applyDecision, evaluateSession, startSession } from '../shared/simulation/engine';
import { buildRetest } from '../shared/simulation/retest';
import { authBackupRetiredScenario } from '../shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '../shared/simulation/scenarios/authBackupRetiredRemediation';
import { analyzeChange } from '../src/analysis/analyzeChange';
import { ruleEngine } from '../src/analysis/ruleEngine';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import type { JiraIssueGateway, JiraResponse } from '../src/jira/client';
import type { ResolverRequest } from '../src/history/resolvers';
import { createHistoryResolvers, HISTORY_MESSAGES, MAX_DECISIONS } from '../src/history/resolvers';

const SITE = 'ari:cloud:jira::site/0b6f3f3c-1111-2222-3333-444455556666';
const OTHER_SITE = 'ari:cloud:jira::site/9e9e9e9e-1111-2222-3333-444455556666';
const ALICE = '5b10ac8d82e05b22cc7d4ef5';
const BOB = '712020:0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6';
const ctx = (accountId = ALICE, installContext = SITE) => ({ accountId, installContext });
const START = '2026-11-10T10:00:00.000Z';

const DESCRIPTION =
  'We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const STEP3 =
  'If the primary IdP is unavailable for more than 5 minutes, run authctl failover --target legacyauth.';

function response(status: number, body: unknown = {}): JiraResponse & ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function issueBody() {
  return {
    key: 'MC-62',
    fields: {
      summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: DESCRIPTION }] }],
      },
      status: { name: 'To Do' },
      issuetype: { name: 'Change' },
      updated: '2026-11-10T09:00:00.000+0000',
    },
  };
}

interface FakeOptions {
  /** Status of every Jira issue read. */
  issueStatus?: number;
  step3?: string;
}

function fakeGateways(options: FakeOptions = {}) {
  const jira = {
    getIssue: vi.fn(async () => response(options.issueStatus ?? 200, issueBody())),
    getRemoteLinks: vi.fn(async () => response(200, [])),
  } satisfies JiraIssueGateway;
  const confluence = {
    searchContent: vi.fn(async () =>
      response(200, {
        results: [{ content: { id: '98305', type: 'page', title: '[DEMO] RB-AUTH-01' } }],
        size: 1,
      }),
    ),
    getPage: vi.fn(async () =>
      response(200, {
        id: '98305',
        title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
        _links: { webui: '/spaces/SFDEMO/pages/98305/RB-AUTH-01' },
        body: {
          storage: {
            value: `<ol><li>Confirm elevated sign-in failures.</li><li>Check the primary IdP status page.</li><li>${options.step3 ?? STEP3}</li></ol>`,
          },
        },
      }),
    ),
  } satisfies ConfluenceGateway;
  return { jira, confluence };
}

function setup(options: { storage?: StorageAdapter | null; gateways?: FakeOptions } = {}) {
  const storage = options.storage === undefined ? new InMemoryStorage() : options.storage;
  const gateways = fakeGateways(options.gateways);
  const historyStorage = vi.fn(() => storage);
  const resolvers = createHistoryResolvers({
    historyStorage,
    ...gateways,
    engine: ruleEngine,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });
  return { resolvers, storage, gateways, historyStorage };
}

/** What the browser did: the analysis it received, an hour before the save. */
async function browserRehearsal(): Promise<GeneratedRehearsal> {
  const { jira, confluence } = fakeGateways();
  const analysis = await analyzeChange(
    { jira, confluence, engine: ruleEngine, now: () => new Date('2026-11-10T11:00:00.000Z') },
    { issueKey: 'MC-62' },
  );
  if (!analysis.ok) throw new Error(analysis.error.message);
  const generated = generateRehearsal({
    analysis: analysis.data,
    findingId: analysis.data.findings[0]!.id,
    restoreTargetMinutes: 30,
  });
  if (!generated.ok) throw new Error(generated.message);
  return generated.rehearsal;
}

function generatedSource(rehearsal: GeneratedRehearsal): RehearsalSourceRef {
  return {
    kind: 'generated',
    changeKey: rehearsal.provenance.changeKey,
    findingId: rehearsal.provenance.findingId,
    restoreTargetMinutes: 30,
    notifyTargetMinutes: 15,
  };
}

const DEMO: RehearsalSourceRef = { kind: 'demo', scenarioId: authBackupRetiredScenario.id };

/** Plays `ids` in order, or the first offered decision when `ids` runs out. */
function play(
  scenario: SimulationScenario,
  sessionId: string,
  ids: string[] = [],
): { session: ExerciseSession; submission: RehearsalSubmission } {
  let session = startSession(scenario, sessionId, START);
  const queue = [...ids];
  while (session.status !== 'completed') {
    const step = scenario.steps[session.currentStepId!]!;
    session = applyDecision(scenario, session, queue.shift() ?? step.decisions[0]!.id);
  }
  return {
    session,
    submission: {
      sessionId,
      startedAt: START,
      decisionIds: session.decisions.map((d) => d.decisionId),
      contentFingerprint: rehearsalContentFingerprint(scenario),
      evaluation: evaluateSession(scenario, session),
      flags: session.flags,
    },
  };
}

const DEMO_FIRST_RUN = ['follow-runbook', 'inspect-change', 'notify-now', 'activate-nimbus'];

function okData<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

function expectSaved(result: ApiResult<SaveRehearsalResponse>) {
  const saved = okData(result);
  expect(saved).toMatchObject({ status: 'SAVED' });
}

const RUN_ID = 'session-run00001';
const RETEST_ID = 'session-retest01';

describe('history resolvers: identity', () => {
  it('answers IDENTITY_UNAVAILABLE without a user and never touches storage', async () => {
    const { resolvers, historyStorage, storage } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    const contexts: unknown[] = [
      undefined,
      {},
      { installContext: SITE },
      { accountId: ALICE },
      { accountId: '', installContext: SITE },
      { accountId: 'not an id!', installContext: SITE },
      { accountId: ALICE, installContext: '   ' },
    ];
    for (const context of contexts) {
      const calls: ApiResult<{ status: string }>[] = await Promise.all([
        resolvers.listRehearsalHistory({ context }),
        resolvers.getRehearsalRun({ context, payload: { runId: RUN_ID } }),
        resolvers.getRetestComparison({ context, payload: { retestId: RETEST_ID } }),
        resolvers.saveRehearsalRun({ context, payload: { source: DEMO, submission } }),
        resolvers.saveRetest({
          context,
          payload: {
            originalRunId: RUN_ID,
            remediationIds: ['rem-runbook'],
            submission: { ...submission, sessionId: RETEST_ID },
          },
        }),
      ]);
      for (const call of calls) {
        expect(okData(call)).toEqual({
          status: 'IDENTITY_UNAVAILABLE',
          detail: HISTORY_MESSAGES.noIdentity,
        });
      }
    }
    expect(historyStorage).not.toHaveBeenCalled();
    expect((storage as InMemoryStorage).keys()).toEqual([]);
  });

  it('ignores an accountId sent in the payload', async () => {
    const { resolvers } = setup();
    const result = await resolvers.listRehearsalHistory({
      payload: { accountId: ALICE, installContext: SITE },
    } as ResolverRequest);
    expect(okData(result)).toMatchObject({ status: 'IDENTITY_UNAVAILABLE' });
  });
});

describe('history resolvers: storage not enabled', () => {
  it('answers UNAVAILABLE with the not-enabled detail from every resolver', async () => {
    const { resolvers, gateways } = setup({ storage: null });
    const rehearsal = await browserRehearsal();
    gateways.jira.getIssue.mockClear();
    const { submission } = play(rehearsal.scenario, RUN_ID);
    const results: ApiResult<{ status: string }>[] = [
      await resolvers.listRehearsalHistory({ context: ctx() }),
      await resolvers.getRehearsalRun({ context: ctx(), payload: { runId: RUN_ID } }),
      await resolvers.getRetestComparison({ context: ctx(), payload: { retestId: RETEST_ID } }),
      await resolvers.saveRehearsalRun({
        context: ctx(),
        payload: { source: generatedSource(rehearsal), submission },
      }),
      await resolvers.saveRetest({
        context: ctx(),
        payload: {
          originalRunId: RUN_ID,
          remediationIds: ['rem-step'],
          submission: { ...submission, sessionId: RETEST_ID },
        },
      }),
    ];
    for (const result of results) {
      expect(okData(result)).toEqual({ status: 'UNAVAILABLE', detail: HISTORY_NOT_ENABLED });
    }
    // No Jira or Confluence call is spent when nothing can be saved.
    expect(gateways.jira.getIssue).not.toHaveBeenCalled();
    expect(gateways.confluence.searchContent).not.toHaveBeenCalled();
  });

  it('reports a storage outage as UNAVAILABLE, never as an empty list', async () => {
    const broken: StorageAdapter = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      delete: async () => {},
    };
    const { resolvers } = setup({ storage: broken });
    expect(okData(await resolvers.listRehearsalHistory({ context: ctx() }))).toEqual({
      status: 'UNAVAILABLE',
      detail: HISTORY_MESSAGES.storageUnreachable,
    });
  });
});

describe('history resolvers: demo round trip', () => {
  it('saves, lists, opens and compares a run and its retest', async () => {
    const { resolvers } = setup();
    const first = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    expectSaved(
      await resolvers.saveRehearsalRun({
        context: ctx(),
        payload: { source: DEMO, submission: first.submission },
      }),
    );

    const retestScenario = buildRetest(
      authBackupRetiredScenario,
      first.session,
      ['rem-runbook'],
      authBackupRetiredRemediation,
    );
    const retest = play(retestScenario, RETEST_ID);
    expectSaved(
      await resolvers.saveRetest({
        context: ctx(),
        payload: {
          originalRunId: RUN_ID,
          remediationIds: ['rem-runbook'],
          submission: retest.submission,
        },
      }),
    );

    const list = okData(await resolvers.listRehearsalHistory({ context: ctx() }));
    if (list.status !== 'OK') throw new Error(list.status);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.run).toMatchObject({ id: RUN_ID, metCount: 3, totalCount: 4 });
    expect(list.items[0]!.retests).toEqual([
      expect.objectContaining({ id: RETEST_ID, retestOf: RUN_ID, outcome: 'resolved' }),
    ]);

    const run = okData(
      await resolvers.getRehearsalRun({ context: ctx(), payload: { runId: RUN_ID } }),
    );
    if (run.status !== 'OK') throw new Error(run.status);
    expect(run.run.scenario.id).toBe(authBackupRetiredScenario.id);
    expect(run.run.provenance).toBeNull();
    expect(run.run.retestIds).toEqual([RETEST_ID]);

    const comparison = okData(
      await resolvers.getRetestComparison({ context: ctx(), payload: { retestId: RETEST_ID } }),
    );
    if (comparison.status !== 'OK') throw new Error(comparison.status);
    expect(comparison.comparison.outcome).toBe('resolved');
    expect(comparison.retest.fixSet).toMatchObject({
      remediationIds: ['rem-runbook'],
      approvedBy: ALICE,
    });
  });

  it('rejects a duplicate save of the same run', async () => {
    const { resolvers } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    const payload = { source: DEMO, submission };
    expectSaved(await resolvers.saveRehearsalRun({ context: ctx(), payload }));
    expect(okData(await resolvers.saveRehearsalRun({ context: ctx(), payload }))).toMatchObject({
      status: 'REJECTED',
      reason: 'DUPLICATE',
    });
  });
});

describe('history resolvers: the server owns the scenario', () => {
  it('regenerates a generated rehearsal as the user and saves it', async () => {
    const { resolvers, gateways } = setup();
    const rehearsal = await browserRehearsal();
    const { submission } = play(rehearsal.scenario, RUN_ID);
    expectSaved(
      await resolvers.saveRehearsalRun({
        context: ctx(),
        payload: { source: generatedSource(rehearsal), submission },
      }),
    );
    expect(gateways.jira.getIssue).toHaveBeenCalledWith('MC-62', expect.any(URLSearchParams));
    const run = okData(
      await resolvers.getRehearsalRun({ context: ctx(), payload: { runId: RUN_ID } }),
    );
    if (run.status !== 'OK') throw new Error(run.status);
    expect(run.run.provenance).toMatchObject({ changeKey: 'MC-62' });
    // The stored evidence carries the server's retrieval time, not the browser's.
    expect(run.run.scenario.evidence[0]!.retrievedAt).toBe('2026-11-10T12:00:00.000Z');
  });

  it('refuses a scenario object from the browser', async () => {
    const { resolvers } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    const result = await resolvers.saveRehearsalRun({
      context: ctx(),
      payload: { source: DEMO, submission, scenario: authBackupRetiredScenario },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('ignores the browser copy: an edited scenario does not match the server one', async () => {
    const { resolvers } = setup();
    const edited: SimulationScenario = {
      ...authBackupRetiredScenario,
      objectives: authBackupRetiredScenario.objectives.map((o) =>
        o.rule.kind === 'flagSetWithin' ? { ...o, rule: { ...o.rule, minutes: 999 } } : o,
      ),
    };
    const { submission } = play(edited, RUN_ID, DEMO_FIRST_RUN);
    expect(
      okData(
        await resolvers.saveRehearsalRun({ context: ctx(), payload: { source: DEMO, submission } }),
      ),
    ).toEqual({
      status: 'REJECTED',
      reason: 'SCENARIO_MISMATCH',
      message: HISTORY_MESSAGES.changed,
    });
  });

  it('rejects the save when the runbook changed since the rehearsal started', async () => {
    const { resolvers } = setup({
      gateways: { step3: STEP3.replace('5 minutes', '10 minutes') },
    });
    const rehearsal = await browserRehearsal();
    const { submission } = play(rehearsal.scenario, RUN_ID);
    expect(
      okData(
        await resolvers.saveRehearsalRun({
          context: ctx(),
          payload: { source: generatedSource(rehearsal), submission },
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', reason: 'SCENARIO_MISMATCH' });
  });

  it('rejects the save when the change is no longer visible', async () => {
    const { resolvers } = setup({ gateways: { issueStatus: 404 } });
    const rehearsal = await browserRehearsal();
    const { submission } = play(rehearsal.scenario, RUN_ID);
    expect(
      okData(
        await resolvers.saveRehearsalRun({
          context: ctx(),
          payload: { source: generatedSource(rehearsal), submission },
        }),
      ),
    ).toEqual({
      status: 'REJECTED',
      reason: 'SCENARIO_MISMATCH',
      message: HISTORY_MESSAGES.noLongerVisible('MC-62'),
    });
  });

  it('accepts only a known demo id', async () => {
    const { resolvers } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    const result = await resolvers.saveRehearsalRun({
      context: ctx(),
      payload: { source: { kind: 'demo', scenarioId: 'demo-something-else' }, submission },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('rejects a forged evaluation', async () => {
    const { resolvers, storage } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    const forged: RehearsalSubmission = {
      ...submission,
      evaluation: {
        ...submission.evaluation,
        metCount: submission.evaluation.totalCount,
        objectives: submission.evaluation.objectives.map((o) => ({ ...o, status: 'met' })),
      },
    };
    expect(
      okData(
        await resolvers.saveRehearsalRun({
          context: ctx(),
          payload: { source: DEMO, submission: forged },
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', reason: 'EVALUATION_MISMATCH' });
    expect((storage as InMemoryStorage).keys()).toEqual([]);
  });

  it('rejects a retest whose fixes differ from the scenario played', async () => {
    const { resolvers } = setup();
    const first = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    expectSaved(
      await resolvers.saveRehearsalRun({
        context: ctx(),
        payload: { source: DEMO, submission: first.submission },
      }),
    );
    const played = buildRetest(
      authBackupRetiredScenario,
      first.session,
      ['rem-runbook'],
      authBackupRetiredRemediation,
    );
    const retest = play(played, RETEST_ID);
    expect(
      okData(
        await resolvers.saveRetest({
          context: ctx(),
          payload: {
            originalRunId: RUN_ID,
            remediationIds: ['rem-change-checklist'],
            submission: retest.submission,
          },
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', reason: 'SCENARIO_MISMATCH' });
  });
});

describe('history resolvers: input validation', () => {
  it('validates ids, list sizes and source fields before any work', async () => {
    const { resolvers, historyStorage } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    const bad: [string, () => Promise<ApiResult<unknown>>][] = [
      ['run id', () => resolvers.getRehearsalRun({ context: ctx(), payload: { runId: '../x' } })],
      [
        'retest id',
        () => resolvers.getRetestComparison({ context: ctx(), payload: { retestId: 'a' } }),
      ],
      [
        'session id',
        () =>
          resolvers.saveRehearsalRun({
            context: ctx(),
            payload: { source: DEMO, submission: { ...submission, sessionId: 'a:b' } },
          }),
      ],
      [
        'decision count',
        () =>
          resolvers.saveRehearsalRun({
            context: ctx(),
            payload: {
              source: DEMO,
              submission: {
                ...submission,
                decisionIds: Array.from({ length: MAX_DECISIONS + 1 }, (_, i) => `d${i}`),
              },
            },
          }),
      ],
      [
        'change key',
        () =>
          resolvers.saveRehearsalRun({
            context: ctx(),
            payload: {
              source: {
                kind: 'generated',
                changeKey: 'mc 62',
                findingId: 'MC-62:1:3:x',
                restoreTargetMinutes: 30,
                notifyTargetMinutes: 15,
              },
              submission,
            },
          }),
      ],
      [
        'finding of another change',
        () =>
          resolvers.saveRehearsalRun({
            context: ctx(),
            payload: {
              source: {
                kind: 'generated',
                changeKey: 'MC-62',
                findingId: 'MC-63:98305:3:legacyauth',
                restoreTargetMinutes: 30,
                notifyTargetMinutes: 15,
              },
              submission,
            },
          }),
      ],
      [
        'restore target',
        () =>
          resolvers.saveRehearsalRun({
            context: ctx(),
            payload: {
              source: {
                kind: 'generated',
                changeKey: 'MC-62',
                findingId: 'MC-62:98305:3:legacyauth',
                restoreTargetMinutes: 2,
                notifyTargetMinutes: 15,
              },
              submission,
            },
          }),
      ],
      [
        'empty fixes',
        () =>
          resolvers.saveRetest({
            context: ctx(),
            payload: { originalRunId: RUN_ID, remediationIds: [], submission },
          }),
      ],
      [
        'too many fixes',
        () =>
          resolvers.saveRetest({
            context: ctx(),
            payload: {
              originalRunId: RUN_ID,
              remediationIds: Array.from({ length: 11 }, (_, i) => `rem-${i}`),
              submission,
            },
          }),
      ],
    ];
    for (const [name, call] of bad) {
      const result = await call();
      expect(result, name).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(historyStorage).not.toHaveBeenCalled();
  });
});

describe('history resolvers: isolation and integrity', () => {
  it('never shows one user the runs of another user or installation', async () => {
    const { resolvers } = setup();
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    expectSaved(
      await resolvers.saveRehearsalRun({
        context: ctx(ALICE),
        payload: { source: DEMO, submission },
      }),
    );

    for (const other of [ctx(BOB), ctx(ALICE, OTHER_SITE)]) {
      expect(okData(await resolvers.listRehearsalHistory({ context: other }))).toMatchObject({
        status: 'OK',
        items: [],
      });
      expect(
        okData(await resolvers.getRehearsalRun({ context: other, payload: { runId: RUN_ID } })),
      ).toEqual({ status: 'NOT_FOUND' });
    }
    // Bob can save a run with the same id without touching Alice's.
    expectSaved(
      await resolvers.saveRehearsalRun({
        context: ctx(BOB),
        payload: { source: DEMO, submission },
      }),
    );
    const alice = okData(await resolvers.listRehearsalHistory({ context: ctx(ALICE) }));
    expect(alice).toMatchObject({ status: 'OK', items: [expect.anything()] });
  });

  it('reports a tampered record by status only', async () => {
    const storage = new InMemoryStorage();
    const { resolvers } = setup({ storage });
    const { submission } = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    expectSaved(
      await resolvers.saveRehearsalRun({ context: ctx(), payload: { source: DEMO, submission } }),
    );
    const key = storage.keys().find((k) => k.includes(':run:'))!;
    const stored = await storage.get<{ audit: { evaluation: { metCount: number } } }>(key);
    stored!.value.audit.evaluation.metCount = 4;
    await storage.set(key, stored!.value, stored!.version);

    const result = okData(
      await resolvers.getRehearsalRun({ context: ctx(), payload: { runId: RUN_ID } }),
    );
    expect(result).toEqual({ status: 'TAMPERED' });
  });

  it('hides a stored run once the user can no longer view its change', async () => {
    const storage = new InMemoryStorage();
    const rehearsal = await browserRehearsal();
    const { submission } = play(rehearsal.scenario, RUN_ID);
    const saving = setup({ storage });
    expectSaved(
      await saving.resolvers.saveRehearsalRun({
        context: ctx(),
        payload: { source: generatedSource(rehearsal), submission },
      }),
    );
    const reading = setup({ storage, gateways: { issueStatus: 403 } });
    expect(
      okData(
        await reading.resolvers.getRehearsalRun({ context: ctx(), payload: { runId: RUN_ID } }),
      ),
    ).toEqual({ status: 'NOT_FOUND' });
  });

  it('refuses a retest of a run that is not in the caller history', async () => {
    const { resolvers } = setup();
    const first = play(authBackupRetiredScenario, RUN_ID, DEMO_FIRST_RUN);
    expectSaved(
      await resolvers.saveRehearsalRun({
        context: ctx(ALICE),
        payload: { source: DEMO, submission: first.submission },
      }),
    );
    const retestScenario = buildRetest(
      authBackupRetiredScenario,
      first.session,
      ['rem-runbook'],
      authBackupRetiredRemediation,
    );
    const retest = play(retestScenario, RETEST_ID);
    expect(
      okData(
        await resolvers.saveRetest({
          context: ctx(BOB),
          payload: {
            originalRunId: RUN_ID,
            remediationIds: ['rem-runbook'],
            submission: retest.submission,
          },
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', reason: 'ORIGINAL_NOT_FOUND' });
  });
});
