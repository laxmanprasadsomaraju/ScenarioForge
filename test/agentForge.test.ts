import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UsageGovernor } from '../shared/agents/budget';
import { InMemoryStorage } from '../shared/agents/storage';
import type { ActionCache } from '../src/agents/actions';
import type { ForgeActionDeps } from '../src/agents/forge';
import {
  createForgeActionHandlers,
  historyReaderFor,
  invocationContext,
} from '../src/agents/forge';
import { ruleEngine } from '../src/analysis/ruleEngine';
import {
  ROVO_TEST_AI_FLAG,
  ROVO_TEST_STORAGE_FLAG,
  rovoTestAiEnabled,
  usageGovernor,
} from '../src/platform/storageFactory';

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => {
      throw new Error('asUser must not be reached in these tests');
    },
  },
  route: () => '',
}));

const ACCOUNT = '712020:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const NOW = () => new Date('2026-11-10T12:00:00.000Z');
const manifest = readFileSync(join(__dirname, '..', 'manifest.yml'), 'utf8');

function deps(overrides: Partial<ForgeActionDeps> = {}) {
  // Building the user-scoped clients is allowed; calling any of them is not.
  const http = vi.fn(async () => {
    throw new Error('no Jira or Confluence call may happen');
  });
  const userGateways = vi.fn(() => ({
    jira: { getIssue: http, getRemoteLinks: http, listFields: http },
    confluence: { searchContent: http, getPage: http },
  }));
  const base: ForgeActionDeps = {
    userGateways,
    engine: ruleEngine,
    governor: () => null,
    cache: () => null,
    historyStore: () => null,
    now: NOW,
    aiEnabled: () => true,
    ...overrides,
  };
  return { base, userGateways, http };
}

const cache = {
  get: vi.fn(async () => ({ hit: false as const, reason: 'MISS' as const })),
  put: vi.fn(async () => {}),
};

describe('Phase 2 manifest (rovo-test only)', () => {
  const block = (name: string, next: string) =>
    manifest
      .split(new RegExp(`^ {2}${name}:$`, 'm'))[1]
      ?.split(new RegExp(`^ {2}${next}:$`, 'm'))[0] ?? '';
  const keys = (text: string) => [...text.matchAll(/^ {4}- key: (\S+)$/gm)].map((m) => m[1]);

  it('has exactly two agents with the approved actions', () => {
    const agents = block('rovo:agent', 'action');
    expect(keys(agents)).toEqual(['recovery-investigator', 'exercise-facilitator']);
    const [investigator, facilitator] = agents.split(/^ {4}- key: exercise-facilitator$/m);
    const actionsOf = (t: string) =>
      [...t.split(/actions:\n/)[1]!.matchAll(/^ {8}- (\S+)$/gm)].map((m) => m[1]);
    expect(actionsOf(investigator!)).toEqual(['find-recovery-risks', 'get-service-readiness']);
    expect(actionsOf(facilitator!)).toEqual([
      'find-recovery-risks',
      'prepare-rehearsal',
      'explain-outcome',
    ]);
    for (const m of agents.matchAll(/^ {6}name: (.+)$/gm))
      expect(m[1]!.length).toBeLessThanOrEqual(30);
  });

  it('has exactly four actions, all GET, and no probe modules', () => {
    const actions = block('action', 'function');
    expect(keys(actions)).toEqual([
      'find-recovery-risks',
      'get-service-readiness',
      'prepare-rehearsal',
      'explain-outcome',
    ]);
    const verbs = [...actions.matchAll(/actionVerb: (\S+)/g)].map((m) => m[1]);
    expect(verbs).toEqual(['GET', 'GET', 'GET', 'GET']);
    expect(manifest).not.toMatch(/whoami|storage-probe|identity-probe/);
    for (const m of actions.matchAll(/^ {6}name: (.+)$/gm))
      expect(m[1]!.length).toBeLessThanOrEqual(30);
  });

  it('declares input schemas that match actions.ts validation', () => {
    const actions = block('action', 'function');
    const inputs = (key: string) => {
      const part = actions.split(`- key: ${key}\n`)[1]!.split(/^ {4}- key:/m)[0]!;
      return [
        ...part.matchAll(/^ {8}(\w+):\n {10}title: .+\n {10}type: (\w+)\n {10}required: (\w+)$/gm),
      ].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
    };
    expect(inputs('find-recovery-risks')).toEqual(['changeKey:string:false']);
    expect(inputs('get-service-readiness')).toEqual(['changeKey:string:false']);
    expect(inputs('prepare-rehearsal')).toEqual([
      'changeKey:string:true',
      'findingId:string:true',
      'restoreTargetMinutes:integer:true',
      'notifyTargetMinutes:integer:false',
    ]);
    expect(inputs('explain-outcome')).toEqual(['sessionId:string:true']);
  });

  it('maps every function to an exported handler, with keys of at most 23 characters', async () => {
    const fns = [
      ...block('function', 'resources').matchAll(/- key: (\S+)\n\s+handler: index\.(\w+)/g),
    ];
    expect(fns.map((m) => m[1])).toEqual([
      'resolver',
      'fn-find-recovery-risks',
      'fn-service-readiness',
      'fn-prepare-rehearsal',
      'fn-explain-outcome',
    ]);
    for (const m of fns) expect(m[1]!.length).toBeLessThanOrEqual(23);
    const index = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');
    for (const m of fns.slice(1)) expect(index).toContain(m[2]);
    expect(index).not.toMatch(/whoamiProbe|storageProbe/);
  });
});

describe('Forge action adapters', () => {
  it('reads accountId from the context argument or payload.context, never from inputs', () => {
    expect(invocationContext({ accountId: 'x' }, undefined).accountId).toBeUndefined();
    expect(invocationContext({ context: { accountId: 'a' } }, undefined).accountId).toBe('a');
    expect(invocationContext({ context: { accountId: 'a' } }, { accountId: 'b' }).accountId).toBe(
      'b',
    );
  });

  it('no accountId: IDENTITY_UNAVAILABLE, no gateway or storage', async () => {
    const governor = vi.fn(() => null);
    const { base, http } = deps({ governor });
    const handlers = createForgeActionHandlers(base);
    for (const handler of Object.values(handlers)) {
      const out = await handler({ changeKey: 'MC-62', accountId: ACCOUNT }, {});
      expect(out).toMatchObject({ ok: false, code: 'IDENTITY_UNAVAILABLE' });
    }
    expect(http).not.toHaveBeenCalled();
    expect(governor).not.toHaveBeenCalled();
  });

  it('storage null: GOVERNANCE_UNAVAILABLE (fail closed), no gateway calls', async () => {
    const { base, http } = deps();
    const handlers = createForgeActionHandlers(base);
    for (const handler of Object.values(handlers)) {
      const out = await handler({ changeKey: 'MC-62' }, { accountId: ACCOUNT });
      expect(out).toMatchObject({ ok: false, code: 'GOVERNANCE_UNAVAILABLE' });
    }
    expect(http).not.toHaveBeenCalled();
  });

  it('governor factory throws: GOVERNANCE_UNAVAILABLE', async () => {
    const { base } = deps({
      governor: () => {
        throw new Error('boom');
      },
    });
    const out = await createForgeActionHandlers(base)['find-recovery-risks'](
      { changeKey: 'MC-62' },
      { accountId: ACCOUNT },
    );
    expect(out).toMatchObject({ ok: false, code: 'GOVERNANCE_UNAVAILABLE' });
  });

  it('AI off (no SF_ROVO_TEST_AI): USAGE_LIMITED, nothing spent, no gateway calls', async () => {
    const env = { [ROVO_TEST_STORAGE_FLAG]: 'enabled' };
    const storage = new InMemoryStorage();
    const governor = new UsageGovernor({
      storage,
      now: NOW,
      policy: { ...(await import('../src/platform/storageFactory')).governancePolicy(env) },
    });
    const { base, http } = deps({
      governor: () => governor,
      cache: () => cache as unknown as ActionCache,
      aiEnabled: () => rovoTestAiEnabled(env),
    });
    const handlers = createForgeActionHandlers(base);
    const calls: [keyof typeof handlers, Record<string, unknown>][] = [
      ['find-recovery-risks', { changeKey: 'MC-62' }],
      ['get-service-readiness', { changeKey: 'MC-62' }],
      [
        'prepare-rehearsal',
        { changeKey: 'MC-62', findingId: 'MC-62:98305:3:legacyauth', restoreTargetMinutes: 30 },
      ],
      ['explain-outcome', { sessionId: 'session-12345678' }],
    ];
    for (const [key, input] of calls) {
      const out = await handlers[key](input, { accountId: ACCOUNT, installContext: 'ari:x' });
      expect(out, key).toMatchObject({ ok: false, code: 'USAGE_LIMITED' });
      expect((out as { message: string }).message).toContain('switched off');
    }
    expect(http).not.toHaveBeenCalled();
    expect(storage.keys()).toEqual([]);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('AI on without a history store: explain-outcome reports history unreachable, spends nothing', async () => {
    const storage = new InMemoryStorage();
    await storage.set('ai-governance:settings', { aiEnabled: false }, null);
    const governor = new UsageGovernor({ storage, now: NOW });
    const { base } = deps({
      governor: () => governor,
      cache: () => cache as unknown as ActionCache,
    });
    const out = await createForgeActionHandlers(base)['explain-outcome'](
      { sessionId: 'session-12345678' },
      { accountId: ACCOUNT, installContext: 'ari:x' },
    );
    // No history store: history is unavailable before any spend.
    expect(out).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR' });
  });

  it('the platform governor is null without storage and DISABLED without the AI flag', async () => {
    expect(usageGovernor({ env: { [ROVO_TEST_AI_FLAG]: 'enabled' } })).toBeNull();
  });
});

describe('historyReaderFor', () => {
  it('is unavailable without storage or installContext', async () => {
    expect(await historyReaderFor(null, 'ari:x').getRun(ACCOUNT, 'session-1')).toEqual({
      status: 'unavailable',
    });
    const store = { getRun: vi.fn() };
    expect(await historyReaderFor(store, undefined).getRun(ACCOUNT, 'session-1')).toEqual({
      status: 'unavailable',
    });
    expect(store.getRun).not.toHaveBeenCalled();
  });

  it('maps NOT_FOUND, UNAVAILABLE and failed verification', async () => {
    const reader = (status: string) =>
      historyReaderFor({ getRun: async () => ({ status }) as never }, 'ari:x');
    expect(await reader('NOT_FOUND').getRun(ACCOUNT, 's')).toEqual({ status: 'not-found' });
    expect(await reader('UNAVAILABLE').getRun(ACCOUNT, 's')).toEqual({ status: 'unavailable' });
    const tampered = await reader('TAMPERED').getRun(ACCOUNT, 's');
    expect(tampered).toMatchObject({ status: 'found', run: { auditVerified: false } });
  });

  it('scopes the lookup to the caller', async () => {
    const getRun = vi.fn(async () => ({ status: 'NOT_FOUND' as const }));
    await historyReaderFor({ getRun }, 'ari:site').getRun(ACCOUNT, 'session-1');
    expect(getRun).toHaveBeenCalledWith(
      { installation: 'ari:site', accountId: ACCOUNT },
      'session-1',
    );
  });
});
