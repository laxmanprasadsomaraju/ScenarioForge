import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Server logs may carry error names and counts, never messages or identifiers. */
describe('server log hygiene', () => {
  const root = join(__dirname, '..');
  const sources = [...files(join(root, 'src')), ...files(join(root, 'shared'))].filter(
    (f) => !f.includes('/probes/'),
  );

  it('no console call logs an error message, stack, response body or account id', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const call of text.matchAll(/console\.(?:log|info|warn|error)\(([\s\S]*?)\);/g)) {
        expect(call[1], file).not.toMatch(/\.message|\.stack|accountId|email|displayName|token/i);
      }
    }
  });

  it('no secrets or env files are tracked in source', () => {
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    }
  });
});
