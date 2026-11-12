import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  crisisStorage,
  governanceStorage,
  historyStorage,
  remediationStorage,
} from '../src/platform/storageFactory';

/** manifests/unified-test.yml: the isolated `unified-test` environment (UNIFIED_TEST_PLAN.md). */

interface Action {
  key: string;
  function: string;
  description: string;
  actionVerb: string;
}
interface Agent {
  key: string;
  description: string;
  prompt: string;
  actions: string[];
}
interface Manifest {
  modules: Record<string, Array<Record<string, unknown> & { key: string }>>;
  resources: Array<{ key: string }>;
  permissions: { scopes: string[] };
  app: { id: string; storage: { entities: Array<{ name: string }> } };
}

const root = join(__dirname, '..');
const text = (p: string) => readFileSync(join(root, p), 'utf8');
const load = (p: string) => parse(text(p)) as Manifest;
const u = load('manifests/unified-test.yml');
const r = load('manifest.yml');
const clone = (m: Manifest) => JSON.parse(JSON.stringify(m)) as Manifest;

function reachable(env: Record<string, string>): string[] {
  const seen = new Set<string>();
  const options = {
    env,
    clientFor: vi.fn((n: string) => {
      seen.add(n);
      return {} as never;
    }),
  };
  historyStorage(options);
  crisisStorage(options);
  remediationStorage(options);
  governanceStorage(options);
  return [...seen].sort();
}

describe('manifests/unified-test.yml', () => {
  it('keeps the app id and exactly the five read-only scopes', () => {
    expect(u.app.id).toBe(r.app.id);
    expect([...u.permissions.scopes].sort()).toEqual(
      [
        'read:jira-work',
        'read:jira-user',
        'search:confluence',
        'read:page:confluence',
        'storage:app',
      ].sort(),
    );
    expect(u.permissions.scopes.some((s) => s.startsWith('write:'))).toBe(false);
    expect(text('manifests/unified-test.yml')).not.toMatch(/^\s*(external|indexes):/m);
  });

  it('declares exactly the entities reachable with SF_STORAGE, SF_CRISIS and SF_AI set', () => {
    const declared = u.app.storage.entities.map((e) => e.name).sort();
    expect(declared).toEqual(['ai-governance', 'crisis-room', 'rehearsal-history']);
    expect(reachable({ SF_STORAGE: 'enabled', SF_CRISIS: 'enabled', SF_AI: 'enabled' })).toEqual(
      declared,
    );
    expect(reachable({ SF_STORAGE: 'enabled', SF_CRISIS: 'enabled' })).toEqual(declared);
  });

  it('has no rovo:mcp module, function or resource', () => {
    expect(Object.keys(u.modules)).not.toContain('rovo:mcp');
    expect(JSON.stringify(u.modules.function) + JSON.stringify(u.resources)).not.toMatch(/mcp/i);
    expect(Object.keys(u.modules).sort()).toEqual(
      ['action', 'function', 'global:fullPage', 'rovo:agent'].sort(),
    );
  });

  it('has both agents, each action declared with a declared function, GET only', () => {
    const agents = u.modules['rovo:agent'] as unknown as Agent[];
    expect(agents.map((a) => a.key).sort()).toEqual([
      'exercise-facilitator',
      'recovery-investigator',
    ]);
    const actions = u.modules.action as unknown as Action[];
    const fnKeys = new Set(u.modules.function!.map((f) => f.key));
    expect(actions.map((a) => a.key).sort()).toEqual([
      'explain-outcome',
      'find-recovery-risks',
      'get-service-readiness',
      'prepare-rehearsal',
    ]);
    for (const a of actions) {
      expect(a.actionVerb).toBe('GET');
      expect(fnKeys.has(a.function), a.key).toBe(true);
    }
    expect(u.resources.some((x) => x.key === 'agent-prompts')).toBe(true);
    for (const g of agents) {
      expect(g.actions.length).toBeGreaterThan(0);
      for (const k of g.actions)
        expect(
          actions.some((a) => a.key === k),
          k,
        ).toBe(true);
      expect(readdirSync(join(root, 'agents/prompts'))).toContain(g.prompt.split(';')[1]!);
    }
  });

  it('keeps descriptions within 255 characters', () => {
    for (const a of u.modules.action as unknown as Action[])
      expect(a.description.length, a.key).toBeLessThanOrEqual(255);
    for (const g of u.modules['rovo:agent'] as unknown as Agent[])
      expect(g.description.length, g.key).toBeLessThanOrEqual(255);
  });

  it('differs from the root manifest only by remediation-item and rovo:mcp (exact set)', () => {
    const expected = clone(r);
    delete expected.modules['rovo:mcp'];
    expected.app.storage.entities = expected.app.storage.entities.filter(
      (e) => e.name !== 'remediation-item',
    );
    expect(clone(u)).toEqual(expected);
    const names = u.app.storage.entities.map((e) => e.name);
    expect(r.app.storage.entities.map((e) => e.name).filter((n) => !names.includes(n))).toEqual([
      'remediation-item',
    ]);
    expect(Object.keys(r.modules).filter((k) => !(k in u.modules))).toEqual(['rovo:mcp']);
  });

  it('nothing in package.json scripts or tracked scripts copies a variant over manifest.yml', () => {
    const pkg = JSON.parse(text('package.json')) as { scripts: Record<string, string> };
    for (const [k, v] of Object.entries(pkg.scripts)) expect(v, k).not.toMatch(/manifests\//);
    const tracked = execSync("git ls-files -- '*.sh' '*.mjs' '*.js' '.github'", { cwd: root })
      .toString()
      .split('\n')
      .filter((f) => f && !f.startsWith('static/'));
    for (const f of tracked)
      expect(text(f), f).not.toMatch(/manifests\/[\w.-]+\.yml[^\n]*manifest\.yml/);
  });
});
