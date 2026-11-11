import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  crisisStorage,
  governanceStorage,
  historyStorage,
  remediationStorage,
} from '../src/platform/storageFactory';

/**
 * Isolated, undeployed manifest variants (manifests/*.yml, reference in
 * docs/proposals/MANIFEST_VARIANTS.md). Nothing here changes the root
 * manifest.yml. Each variant must declare exactly the storage entities the code
 * can reach under that variant's flags and module set, and only the m8 variant
 * may carry the Jira write scope.
 */

interface Manifest {
  modules: Record<string, Array<{ key: string }>>;
  permissions: { scopes: string[] };
  app: { id: string; storage: { entities: Array<{ name: string; attributes: object }> } };
}

const root = join(__dirname, '..');
const load = (p: string) => parse(readFileSync(join(root, p), 'utf8')) as Manifest;
const rootManifest = load('manifest.yml');

const FIVE_SCOPES = [
  'read:jira-work',
  'read:jira-user',
  'search:confluence',
  'read:page:confluence',
  'storage:app',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const sources = [...files(join(root, 'src')), ...files(join(root, 'shared'))];

/** Entities the code can reach for a flag set, observed through the real factories. */
function reachableEntities(env: Record<string, string>, withAgents: boolean): string[] {
  const seen = new Set<string>();
  const clientFor = vi.fn((entityName: string) => {
    seen.add(entityName);
    return {} as never;
  });
  const options = { env, clientFor };
  historyStorage(options);
  crisisStorage(options);
  remediationStorage(options);
  // The AI governor and response cache are built only in src/agents/forge.ts,
  // i.e. by the Rovo action functions. Without those modules nothing builds them.
  if (withAgents) governanceStorage(options);
  return [...seen].sort();
}

const VARIANTS = {
  'manifests/m7-test.yml': {
    env: { SF_STORAGE: 'enabled', SF_CRISIS: 'enabled' },
    agents: false,
    scopes: FIVE_SCOPES,
    entities: ['crisis-room', 'rehearsal-history'],
    modules: ['global:fullPage', 'function'],
  },
  'manifests/m8-write-test.yml': {
    env: { SF_STORAGE: 'enabled', SF_REMEDIATION_WRITE: 'enabled' },
    agents: false,
    scopes: [...FIVE_SCOPES, 'write:jira-work'],
    entities: ['rehearsal-history'],
    modules: ['global:fullPage', 'function'],
  },
  'manifests/judged-release.yml': {
    env: { SF_STORAGE: 'enabled', SF_AI: 'enabled' },
    agents: true,
    scopes: FIVE_SCOPES,
    entities: ['ai-governance', 'rehearsal-history'],
    modules: ['global:fullPage', 'rovo:agent', 'rovo:mcp', 'action', 'function'],
  },
} as const;

describe.each(Object.entries(VARIANTS))('%s', (path, spec) => {
  const m = load(path);
  const declared = m.app.storage.entities.map((e) => e.name).sort();

  it('declares exactly the entities reachable under its flags (none missing, none unused)', () => {
    expect(declared).toEqual([...spec.entities]);
    expect(reachableEntities(spec.env, spec.agents)).toEqual([...spec.entities]);
  });

  it('has the expected scopes and modules', () => {
    expect([...m.permissions.scopes].sort()).toEqual([...spec.scopes].sort());
    expect(Object.keys(m.modules).sort()).toEqual([...spec.modules].sort());
  });

  it('keeps the app id and the reviewed entity shape of the root manifest', () => {
    expect(m.app.id).toBe(rootManifest.app.id);
    for (const e of m.app.storage.entities) {
      const reviewed = rootManifest.app.storage.entities.find((r) => r.name === e.name);
      expect(e).toEqual(reviewed);
    }
  });

  it('has no custom indexes, no egress, no external permissions', () => {
    const text = readFileSync(join(root, path), 'utf8');
    expect(text).not.toMatch(/^\s*indexes:/m);
    expect(text).not.toMatch(/^\s*external:/m);
  });
});

describe('write scope isolation', () => {
  it('write:jira-work is only in the m8 write-test variant', () => {
    expect(rootManifest.permissions.scopes).not.toContain('write:jira-work');
    for (const [path, spec] of Object.entries(VARIANTS)) {
      expect(load(path).permissions.scopes.includes('write:jira-work'), path).toBe(
        spec.scopes.includes('write:jira-work' as never),
      );
    }
  });

  it('the m7 and judged variants cannot reach crisis/remediation entities by flag', () => {
    // Judged omits crisis-room: SF_CRISIS must stay unset there (it would fail at runtime).
    expect(reachableEntities({ SF_STORAGE: 'enabled' }, true)).toEqual([
      'ai-governance',
      'rehearsal-history',
    ]);
    expect(reachableEntities({ SF_STORAGE: 'enabled', SF_CRISIS: 'enabled' }, false)).toContain(
      'crisis-room',
    );
  });

  it('the judged variant has no remediation write route to a declared function', () => {
    const j = load('manifests/judged-release.yml');
    expect(j.modules.function?.map((f) => f.key).sort()).toEqual([
      'fn-explain-outcome',
      'fn-find-recovery-risks',
      'fn-prepare-rehearsal',
      'fn-service-readiness',
      'resolver',
    ]);
  });
});

describe('storage entity names in code', () => {
  const all = new Set(rootManifest.app.storage.entities.map((e) => e.name));
  const constants = sources.flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/_ENTITY\s*=\s*'([^']+)'/g)].map((m) => m[1]!),
  );

  it('every *_ENTITY constant in code is an entity the root manifest declares', () => {
    expect(constants.length).toBeGreaterThan(0);
    for (const c of constants) expect(all.has(c), c).toBe(true);
  });

  it('no entity name is used as a literal outside the *_ENTITY constants and key prefixes', () => {
    const names = ['ai-governance', 'rehearsal-history', 'crisis-room'];
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      for (const name of names) {
        for (const m of text.matchAll(new RegExp(`['"\`]${name}['"\`]`, 'g'))) {
          const line = text.slice(0, m.index).split('\n').length;
          const lineText = text.split('\n')[line - 1]!;
          if (/^\s*(\*|\/\/|\/\*)/.test(lineText)) continue; // comments
          expect(lineText, `${f}:${line}`).toMatch(/_ENTITY\s*=/);
        }
      }
    }
  });

  it('remediation-item is a key prefix on rehearsal-history, not an entity', () => {
    expect(constants).not.toContain('remediation-item');
    const text = readFileSync(join(root, 'src/platform/storageFactory.ts'), 'utf8');
    expect(text).toMatch(/entityStorage\(HISTORY_ENTITY/);
  });

  it('the AI governor and response cache are built only by the agent functions', () => {
    const users = sources
      .filter((f) => !f.includes('/probes/') && !f.endsWith('storageFactory.ts'))
      .filter((f) =>
        /(?:usageGovernor|UsageGovernor|responseCache|ResponseCache|governanceStorage)\(/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(root.length + 1));
    expect(users).toEqual(['src/agents/forge.ts']);
  });
});

describe('feature flags read by the code', () => {
  it('only the documented SF_ variables appear', () => {
    const found = new Set(
      sources.flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/\bSF_[A-Z_]+\b/g)].map((m) => m[0]),
      ),
    );
    for (const known of [
      'SF_STORAGE',
      'SF_AI',
      'SF_CRISIS',
      'SF_TWG',
      'SF_REMEDIATION_WRITE',
      'SF_USER_DAILY_CAP',
    ])
      expect(found.has(known), known).toBe(true);
    // rovo-test names from the old branch have no effect with this code.
    expect([...found].filter((n) => n.startsWith('SF_ROVO_TEST'))).toEqual([]);
  });
});
