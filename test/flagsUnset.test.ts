import { describe, expect, it, vi } from 'vitest';
import { HISTORY_NOT_ENABLED } from '../shared/api';
import { CRISIS_NOT_ENABLED } from '../shared/crisis';
import { authBackupRetiredScenario } from '../shared/simulation/scenarios/authBackupRetired';
import { createCrisisResolvers } from '../src/crisis/resolvers';
import { createHistoryResolvers } from '../src/history/resolvers';
import {
  crisisStorage,
  governanceStorage,
  historyStorage,
  historyStore,
  usageGovernor,
} from '../src/platform/storageFactory';
import {
  productionRemediationStorage,
  productionRemediationWriter,
} from '../src/remediation/gateways';
import { resolveTwgEnrichment } from '../src/twg/gateway';

/**
 * Feature-disabled behaviour with SF_STORAGE, SF_AI, SF_CRISIS and SF_TWG all
 * unset (an empty environment), the state of a fresh install of the judged
 * build. Every disabled feature answers with a plain "not enabled" result; no
 * storage client, Jira, Confluence or Teamwork Graph call is made.
 */
const clientFor = vi.fn(() => {
  throw new Error('storage must not be touched when the flags are unset');
});
const options = { env: {}, clientFor };
const ctx = { accountId: '5b10ac8d82e05b22cc7d4ef5', installContext: 'ari:cloud:jira::site/abc' };
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('no Jira or Confluence call is allowed while the feature is off');
    },
  },
) as never;

describe('all feature flags unset', () => {
  it('every storage-backed factory is null and no client is created', () => {
    expect(governanceStorage(options)).toBeNull();
    expect(historyStorage(options)).toBeNull();
    expect(crisisStorage(options)).toBeNull();
    expect(historyStore(options)).toBeNull();
    expect(usageGovernor(options)).toBeNull();
    expect(clientFor).not.toHaveBeenCalled();
  });

  it('SF_CRISIS alone does not enable rooms without SF_STORAGE', () => {
    expect(crisisStorage({ env: { SF_CRISIS: 'enabled' }, clientFor })).toBeNull();
    expect(clientFor).not.toHaveBeenCalled();
  });

  it('History answers "not enabled" without reading Jira or Confluence', async () => {
    const history = createHistoryResolvers({
      historyStorage: () => historyStorage(options),
      jira: untouchable,
      confluence: untouchable,
      engine: untouchable,
    });
    const listed = await history.listRehearsalHistory({ context: ctx });
    expect(listed).toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE', detail: HISTORY_NOT_ENABLED },
    });
    const run = await history.getRehearsalRun({
      context: ctx,
      payload: { runId: 'session-run00001' },
    });
    expect(run).toMatchObject({ ok: true, data: { status: 'UNAVAILABLE' } });
  });

  it('Crisis room answers "not enabled" and creates no room', async () => {
    const crisis = createCrisisResolvers({
      crisisStorage: () => crisisStorage(options),
      historyStorage: () => historyStorage(options),
      trustedScenario: async () => {
        throw new Error('no scenario may be built while rooms are off');
      },
      random: () => {
        throw new Error('no token may be generated while rooms are off');
      },
    });
    const source = { kind: 'demo', scenarioId: authBackupRetiredScenario.id };
    const opened = await crisis.crisisOpenRoom({ payload: { source }, context: ctx });
    expect(opened).toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE', detail: CRISIS_NOT_ENABLED },
    });
    const status = await crisis.crisisStatus({ context: ctx });
    expect(status).toMatchObject({ ok: true, data: { status: 'UNAVAILABLE' } });
  });

  it('Teamwork Graph is not-connected and makes no call', async () => {
    const request = vi.fn();
    const result = await resolveTwgEnrichment(
      { twg: { request }, jira: untouchable },
      { flag: undefined, impactsKey: undefined, ownersKey: undefined, cloudId: undefined },
      'MC-62',
    );
    expect(result.kind).toBe('not-connected');
    expect(request).not.toHaveBeenCalled();
  });

  it('Create-in-Jira has no writer and no approval store', () => {
    expect(productionRemediationWriter()).toBeNull();
    expect(productionRemediationStorage()).toBeNull();
  });
});
