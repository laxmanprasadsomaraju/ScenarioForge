import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST_SCOPES, NOT_REQUESTED_SCOPES } from '../shared/environment';

/** The `permissions.scopes` list of manifest.yml, comments ignored. */
function manifestScopes(): string[] {
  const text = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  const block = /^permissions:\n\s+scopes:\n((?:\s+(?:#.*|- .*)\n)+)/m.exec(text);
  if (!block) throw new Error('No permissions.scopes block in manifest.yml');
  return block[1]
    .split('\n')
    .map((line) => /^\s+- (\S+)/.exec(line)?.[1])
    .filter((s): s is string => Boolean(s));
}

describe('Settings permission truth', () => {
  it('lists exactly the scopes manifest.yml requests', () => {
    expect(MANIFEST_SCOPES.map((s) => s.scope).sort()).toEqual(manifestScopes().sort());
  });

  it('never lists a requested scope as not requested', () => {
    const granted = new Set(manifestScopes());
    for (const s of NOT_REQUESTED_SCOPES) expect(granted.has(s.scope)).toBe(false);
  });
});
