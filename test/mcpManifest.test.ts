import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Manifest {
  modules: {
    'rovo:mcp'?: Array<{ key: string; name: string; tools: string[] }>;
    action: Array<{ key: string; actionVerb: string; function: string }>;
    function: Array<{ key: string }>;
  };
  permissions: { scopes: string[]; external?: unknown };
}

const manifest = parse(readFileSync(join(__dirname, '..', 'manifest.yml'), 'utf8')) as Manifest;

/** Scopes on rovo-test/phase2 before M9; the MCP module must not add any. */
const PHASE2_SCOPES = [
  'read:jira-work',
  'read:jira-user',
  'search:confluence',
  'read:page:confluence',
  'storage:app',
];
const TOOLS = [
  'find-recovery-risks',
  'get-service-readiness',
  'prepare-rehearsal',
  'explain-outcome',
];

describe('rovo:mcp module (M9)', () => {
  const mcp = manifest.modules['rovo:mcp'] ?? [];

  it('declares exactly one MCP module with a valid key and a name of at most 30 characters', () => {
    expect(mcp).toHaveLength(1);
    expect(mcp[0]?.key).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(mcp[0]?.name.length).toBeLessThanOrEqual(30);
  });

  it('exposes only the four existing GET actions', () => {
    expect([...(mcp[0]?.tools ?? [])].sort()).toEqual([...TOOLS].sort());
    for (const tool of mcp[0]?.tools ?? []) {
      const action = manifest.modules.action.find((a) => a.key === tool);
      expect(action, tool).toBeDefined();
      expect(action?.actionVerb).toBe('GET');
      expect(tool.length).toBeLessThan(64);
    }
  });

  it('adds no actions, functions, scopes or egress', () => {
    expect(manifest.modules.action.map((a) => a.key).sort()).toEqual([...TOOLS].sort());
    expect(manifest.modules.function).toHaveLength(5);
    expect([...manifest.permissions.scopes].sort()).toEqual([...PHASE2_SCOPES].sort());
    expect(manifest.permissions.external).toBeUndefined();
  });
});
