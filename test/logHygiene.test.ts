import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLogViolations } from './helpers/logCheck';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Server logs may carry error names, status codes and counts, never messages or identifiers. */
describe('server log hygiene', () => {
  const root = join(__dirname, '..');
  // src/probes are rovo-test diagnostics (own redacting `log` dependency), not shipped paths.
  const sources = [...files(join(root, 'src')), ...files(join(root, 'shared'))].filter(
    (f) => !f.includes('/probes/'),
  );

  it('every console/log call in src and shared passes only safe arguments', () => {
    const found = sources.flatMap((f) => findLogViolations(readFileSync(f, 'utf8'), f));
    expect(found).toEqual([]);
  });

  it('no secrets or env files are tracked in source', () => {
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    }
  });
});

describe('log checker negative cases', () => {
  const bad = (code: string) => expect(findLogViolations(code)).not.toEqual([]);
  const good = (code: string) => expect(findLogViolations(code)).toEqual([]);

  it('flags whole errors, messages, stacks, objects, identifiers', () => {
    bad(`console.error(error)`);
    bad(`console.error('x', error.message)`);
    bad(`console.error('x', e.stack)`);
    bad(`console.warn('x', issue)`);
    bad(`console.log(accountId)`);
    bad(`console.log(user.email)`);
    bad('console.log(`user ${accountId}`)');
    bad(`console.log({ ...req })`);
    bad(`console.log({ accountId })`);
    bad(`console.log(JSON.stringify({ a: error.message }))`);
    bad(`console.log(JSON.stringify(response))`);
    bad(`console.log(String(error))`);
    bad(`console.log(err ?? error)`);
  });
  it('flags multi-line calls and calls without semicolons', () => {
    bad(`console.error(\n  'Failed',\n  error\n)\nconst a = 1`);
    bad(`function f() {\n  console.info(\n    'x',\n    { detail: e.message },\n  )\n}`);
  });
  it('flags aliases and indirection of console', () => {
    bad(`const log = console.error\nlog('x')`);
    bad(`const { error } = console`);
    bad(`const c = console; c.error(e)`);
    bad(`[1].forEach(console.log)`);
    bad(`const logger = console`);
  });
  it('flags log wrappers with unsafe arguments', () => {
    bad(`log(line)`);
    bad(`deps.log(error.message)`);
    bad(`logger.error(err)`);
  });
  it('allows the safe shapes', () => {
    good(`console.error('Resolver failed', error instanceof Error ? error.name : 'unknown')`);
    good(
      `console.warn(JSON.stringify({ event: 'x', code: s.error.code, upstreamStatus: s.status ?? null }))`,
    );
    good('console.error(\'x\', `${problems.length} problem(s)`)');
    good(`console.warn('x', { problems: Number(n) })`);
  });
});
