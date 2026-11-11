import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForwarders, findLogViolations } from './helpers/logCheck';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

/** Server logs may carry error names, status codes and counts, never messages or identifiers. */
describe('server log hygiene', () => {
  const root = join(__dirname, '..');
  // src/probes are rovo-test diagnostics (own redacting `log` dependency), not shipped paths.
  const sources = [...files(join(root, 'src')), ...files(join(root, 'shared'))].filter(
    (f) => !f.includes('/probes/'),
  );

  // The browser console is user-visible and ends up in screenshots and bug reports.
  const browser = files(join(root, 'static/app/src'));
  const all = [...sources, ...browser];
  const forwarders = new Set(all.flatMap((f) => [...findForwarders(readFileSync(f, 'utf8'), f)]));

  it('every console/log call in src and shared passes only safe arguments', () => {
    const found = sources.flatMap((f) => findLogViolations(readFileSync(f, 'utf8'), f, forwarders));
    expect(found).toEqual([]);
  });

  it('every console call in the browser code (static/app/src) passes only safe arguments', () => {
    expect(browser.length).toBeGreaterThan(10);
    const found = browser.flatMap((f) => findLogViolations(readFileSync(f, 'utf8'), f, forwarders));
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
    bad(`console.log(user.name)`);
    bad(`console.log(account.displayName ?? profile.name)`);
    bad(`console.log({ [accountId]: 1 })`);
    bad(`logError(e.message)`);
    bad(`deps.report(error)`);
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
  it('flags calls to functions that merely forward their arguments to console', () => {
    bad(`function emit(x: unknown) { console.log(x) }`);
    bad(`const emit = (...a: unknown[]) => console.log(...a)`);
    bad(`const o = { emit(x: string) { console.warn(\`got \${x}\`) } }`);
    // Name does not look like a logger: the call site must still be checked.
    const defs = `const emit = (x: string) => console.log(x)\n`;
    expect(findLogViolations(`${defs}emit(user.email)`).length).toBeGreaterThan(1);
    // Cross-file: the forwarder is defined elsewhere, the caller passes an object.
    expect(findLogViolations(`emit(issue)`, 'b.ts', findForwarders(defs))).not.toEqual([]);
    expect(findLogViolations(`emit('fixed text')`, 'b.ts', findForwarders(defs))).toEqual([]);
    expect(findLogViolations(`emit(issue)`, 'b.ts')).toEqual([]); // unknown to this file alone
    expect([...findForwarders(`function f(x) { return x + 1 }`)]).toEqual([]);
    expect([...findForwarders(`const g = (n: number) => console.log('n', Number(n))`)]).toEqual([]);
  });
  it('flags .code and .status on objects that are not an error or response', () => {
    bad(`console.log(user.code)`);
    bad(`console.log(issue.status)`);
    bad(`console.log({ s: account.status })`);
    bad(`console.log(row.upstreamStatus)`);
    bad(`console.log(getThing().code)`);
    bad('console.log(`state ${page.status}`)');
    good(`console.log(error.code, response.status, res.status, result.error.code)`);
    good(`console.log(search.error?.upstreamStatus)`);
  });
  it('applies to TSX browser code too', () => {
    expect(
      findLogViolations(`const A = () => { console.log(user); return <b/> }`, 'a.tsx'),
    ).not.toEqual([]);
    expect(
      findLogViolations(`const A = () => { console.error('x', e.name); return <b/> }`, 'a.tsx'),
    ).toEqual([]);
  });
  it('allows the safe shapes', () => {
    good(`console.error('Resolver failed', error instanceof Error ? error.name : 'unknown')`);
    good(
      `console.warn(JSON.stringify({ event: 'x', code: s.error.code, upstreamStatus: response.status ?? null }))`,
    );
    good("console.error('x', `${problems.length} problem(s)`)");
    good(`console.warn('x', { problems: Number(n) })`);
    good(`console.error('x', err.name)`);
  });
});
