import { describe, expect, it } from 'vitest';
import {
  buildDeepLink,
  isFindingIdFor,
  isLinkIssueKey,
  MAX_QUERY_LENGTH,
  parseDeepLink,
  readinessLinkPath,
  rehearsalLinkPath,
  type DeepLink,
} from '../shared/links/deepLink';
import { readinessAppPath, rehearsalAppPath } from '../src/agents/output';
import { isIssueKey } from '../src/validation';

const FINDING = 'MC-62:98305:3:legacyauth';
const ENC = encodeURIComponent(FINDING);

function parse(path: string) {
  const [pathname, search = ''] = path.split('?');
  return parseDeepLink(pathname!, search ? `?${search}` : '');
}

function rejected(path: string) {
  const result = parse(path);
  expect(result.kind).toBe('rejected');
  return result.kind === 'rejected' ? result.reason : '';
}

describe('deep link builder', () => {
  it.each<[DeepLink, string]>([
    [{ route: 'readiness', change: 'MC-62' }, '/readiness-checks?change=MC-62'],
    [
      { route: 'readiness', change: 'MC-62', finding: FINDING },
      `/readiness-checks?change=MC-62&finding=${ENC}`,
    ],
    [
      { route: 'simulations', change: 'MC-62', finding: FINDING, restore: 30 },
      `/simulations?change=MC-62&finding=${ENC}&restore=30`,
    ],
    [
      { route: 'simulations', change: 'MC-62', finding: FINDING, restore: 1440, notify: 240 },
      `/simulations?change=MC-62&finding=${ENC}&restore=1440&notify=240`,
    ],
  ])('builds the canonical path and parses it back to the same link', (link, path) => {
    expect(buildDeepLink(link)).toBe(path);
    expect(parse(path)).toEqual({ kind: 'link', link });
  });

  it('is what the M6 actions emit', () => {
    expect(readinessAppPath('MC-62')).toBe(readinessLinkPath('MC-62'));
    expect(
      rehearsalAppPath({
        changeKey: 'MC-62',
        findingId: FINDING,
        restoreTargetMinutes: 30,
        notifyTargetMinutes: 10,
      }),
    ).toBe(rehearsalLinkPath({ change: 'MC-62', finding: FINDING, restore: 30, notify: 10 }));
  });

  it.each<[string, DeepLink]>([
    ['bad change', { route: 'readiness', change: 'mc-62' }],
    ['finding of another change', { route: 'readiness', change: 'MC-63', finding: FINDING }],
    ['restore too small', { route: 'simulations', change: 'MC-62', finding: FINDING, restore: 4 }],
    [
      'fractional restore',
      { route: 'simulations', change: 'MC-62', finding: FINDING, restore: 30.5 },
    ],
    [
      'notify too large',
      { route: 'simulations', change: 'MC-62', finding: FINDING, restore: 30, notify: 241 },
    ],
  ])('refuses to build a link the parser would reject: %s', (_, link) => {
    expect(() => buildDeepLink(link)).toThrow(TypeError);
  });
});

describe('deep link parser', () => {
  it('returns none for routes without links and for bare routes', () => {
    expect(parse('/readiness-checks')).toEqual({ kind: 'none' });
    expect(parse('/simulations')).toEqual({ kind: 'none' });
    expect(parseDeepLink('/simulations', '?')).toEqual({ kind: 'none' });
    expect(parse('/changes?change=MC-62')).toEqual({ kind: 'none' });
    expect(parse('/')).toEqual({ kind: 'none' });
  });

  it('accepts a trailing slash and any parameter order', () => {
    expect(parse(`/simulations/?restore=30&finding=${ENC}&change=MC-62`)).toEqual({
      kind: 'link',
      link: { route: 'simulations', change: 'MC-62', finding: FINDING, restore: 30 },
    });
  });

  it('accepts an unencoded finding id (colons are legal in a query)', () => {
    expect(parse(`/readiness-checks?change=MC-62&finding=${FINDING}`)).toEqual({
      kind: 'link',
      link: { route: 'readiness', change: 'MC-62', finding: FINDING },
    });
  });

  it.each([
    ['missing change', '/readiness-checks?finding=x'.replace('x', ENC)],
    ['lower-case key', '/readiness-checks?change=mc-62'],
    ['key with spaces', '/readiness-checks?change=MC%2062'],
    ['empty change', '/readiness-checks?change='],
    ['oversized key', `/readiness-checks?change=A${'B'.repeat(70)}-1`],
    ['malformed finding', '/readiness-checks?change=MC-62&finding=MC-62%3Aabc'],
    ['finding of another change', `/readiness-checks?change=MC-63&finding=${ENC}`],
    ['finding with upper-case term', '/readiness-checks?change=MC-62&finding=MC-62:1:3:Legacy'],
    ['unknown parameter', '/readiness-checks?change=MC-62&jql=project%3DMC'],
    ['simulations parameter on readiness', '/readiness-checks?change=MC-62&restore=30'],
    ['duplicate change', '/readiness-checks?change=MC-62&change=MC-63'],
    ['duplicate finding', `/readiness-checks?change=MC-62&finding=${ENC}&finding=${ENC}`],
    ['empty segment', '/readiness-checks?change=MC-62&'],
    ['segment without value', '/readiness-checks?change'],
    ['segment without name', '/readiness-checks?=MC-62'],
    ['bad percent encoding', '/readiness-checks?change=MC-62%E0%A4%A'],
    ['encoded NUL', '/readiness-checks?change=MC-62%00'],
    ['encoded newline', '/readiness-checks?change=MC-62%0A'],
    ['encoded C1 control', '/readiness-checks?change=MC-62%C2%85'],
    ['encoded control in name', '/readiness-checks?chan%0Age=MC-62'],
    ['oversized value', `/readiness-checks?change=MC-62&finding=${'a'.repeat(161)}`],
    ['oversized query', `/readiness-checks?change=MC-62&x=${'a'.repeat(MAX_QUERY_LENGTH)}`],
    ['missing finding', '/simulations?change=MC-62&restore=30'],
    ['missing restore', `/simulations?change=MC-62&finding=${ENC}`],
    ['restore below range', `/simulations?change=MC-62&finding=${ENC}&restore=4`],
    ['restore above range', `/simulations?change=MC-62&finding=${ENC}&restore=1441`],
    ['restore fractional', `/simulations?change=MC-62&finding=${ENC}&restore=30.5`],
    ['restore leading zero', `/simulations?change=MC-62&finding=${ENC}&restore=030`],
    ['restore negative', `/simulations?change=MC-62&finding=${ENC}&restore=-30`],
    ['restore exponent', `/simulations?change=MC-62&finding=${ENC}&restore=3e1`],
    ['restore with space', `/simulations?change=MC-62&finding=${ENC}&restore=+30`],
    ['notify zero', `/simulations?change=MC-62&finding=${ENC}&restore=30&notify=0`],
    ['notify above range', `/simulations?change=MC-62&finding=${ENC}&restore=30&notify=241`],
    ['notify empty', `/simulations?change=MC-62&finding=${ENC}&restore=30&notify=`],
    ['duplicate restore', `/simulations?change=MC-62&finding=${ENC}&restore=30&restore=60`],
    ['unknown parameter', `/simulations?change=MC-62&finding=${ENC}&restore=30&autostart=1`],
    ['finding of another change', `/simulations?change=MC-63&finding=${ENC}&restore=30`],
  ])('rejects %s as a whole', (_, path) => {
    const reason = rejected(path);
    expect(reason.length).toBeGreaterThan(0);
  });

  it('never echoes rejected input in the reason', () => {
    const reason = rejected('/readiness-checks?change=%3Cscript%3E');
    expect(reason).not.toContain('<');
    expect(reason).not.toContain('script');
    expect(rejected('/readiness-checks?change=MC-62&evil%3Cb%3E=1')).not.toContain('evil');
  });

  it('keeps the route of a rejected link so the screen can show its notice', () => {
    expect(parse('/simulations?change=bad')).toMatchObject({
      kind: 'rejected',
      route: 'simulations',
    });
  });
});

describe('identifier rules', () => {
  it.each(['MC-62', 'A-1', 'AB_9-12345', 'mc-62', 'MC62', '-1', 'MC-', '1A-2', 'MC-6 2', ''])(
    'issue keys follow isIssueKey: %s',
    (key) => {
      expect(isLinkIssueKey(key)).toBe(isIssueKey(key));
    },
  );

  it('matches isIssueKey on length', () => {
    const long = `A${'B'.repeat(70)}-1`;
    expect(isLinkIssueKey(long)).toBe(isIssueKey(long));
  });

  it('ties a finding id to its change', () => {
    expect(isFindingIdFor(FINDING, 'MC-62')).toBe(true);
    expect(isFindingIdFor(FINDING, 'MC-6')).toBe(false);
    expect(isFindingIdFor('MC-62:98305:3', 'MC-62')).toBe(false);
    expect(isFindingIdFor('MC-62:98305:3:legacyauth:extra', 'MC-62')).toBe(false);
    expect(isFindingIdFor(42, 'MC-62')).toBe(false);
  });
});
