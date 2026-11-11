import { describe, expect, it, vi } from 'vitest';
import { buildAppUrl } from '../shared/links/absoluteLink';
import {
  createLinkBaseResolver,
  forgeLinkBase,
  LINK_BASE_FAILURE_TTL_MS,
  LINK_BASE_MAX_ENTRIES,
  LINK_BASE_TTL_MS,
  withAppUrl,
} from '../src/agents/forge';
import { readinessAppPath, rehearsalAppPath } from '../src/agents/output';

vi.mock('@forge/api', () => ({
  default: { asUser: () => ({ requestJira: async () => ({ ok: false, status: 500 }) }) },
  route: () => '',
  getAppContext: () => {
    throw new Error('no runtime');
  },
}));

const SITE = 'https://example.atlassian.net';
const INSTALL = '0b0cf3f0-1111-4222-8333-944455556666';
const FINDING = 'MC-62:123:2:redis';
const base = async () => ({ siteUrl: SITE, installationId: INSTALL });

describe('buildAppUrl', () => {
  it('builds the full-page URL with route prefix', () => {
    expect(
      buildAppUrl({ siteUrl: SITE, installationId: INSTALL, appPath: readinessAppPath('MC-62') }),
    ).toBe(`${SITE}/apps/full-page/${INSTALL}/scenarioforge/readiness-checks?change=MC-62`);
  });

  it('keeps an encoded rehearsal query', () => {
    const appPath = rehearsalAppPath({
      changeKey: 'MC-62',
      findingId: FINDING,
      restoreTargetMinutes: 30,
      notifyTargetMinutes: 10,
    });
    const url = buildAppUrl({ siteUrl: SITE, installationId: INSTALL, appPath })!;
    expect(url).toContain(
      '/scenarioforge/simulations?change=MC-62&finding=MC-62%3A123%3A2%3Aredis',
    );
    expect(url.endsWith('&restore=30&notify=10')).toBe(true);
  });

  it.each([
    ['http site', 'http://example.atlassian.net'],
    ['other host', 'https://evil.com'],
    ['suffix trick', 'https://example.atlassian.net.evil.com'],
    ['userinfo', 'https://a@example.atlassian.net'],
    ['path', 'https://example.atlassian.net/x'],
    ['port', 'https://example.atlassian.net:8443'],
    ['bare atlassian.net', 'https://atlassian.net'],
    ['non-string', 42],
    ['missing', undefined],
  ])('hostile site (%s) gives no link', (_n, siteUrl) => {
    expect(
      buildAppUrl({ siteUrl, installationId: INSTALL, appPath: readinessAppPath('MC-62') }),
    ).toBeNull();
  });

  it.each(['', 'not-a-uuid', `${INSTALL}/../x`, undefined, 7])(
    'bad installation id (%s) gives no link',
    (installationId) => {
      expect(
        buildAppUrl({ siteUrl: SITE, installationId, appPath: readinessAppPath('MC-62') }),
      ).toBeNull();
    },
  );

  it.each([
    '//evil.com/readiness-checks?change=MC-62',
    'https://evil.com/readiness-checks?change=MC-62',
    '/admin?change=MC-62',
    '/readiness-checks',
    '/readiness-checks?change=MC-62&x=1',
    '/readiness-checks?change=../../x',
    '/simulations?change=MC-62',
    'readiness-checks?change=MC-62',
    undefined,
  ])('hostile path (%s) gives no link', (appPath) => {
    expect(buildAppUrl({ siteUrl: SITE, installationId: INSTALL, appPath })).toBeNull();
  });
});

describe('withAppUrl', () => {
  const ok = { ok: true, appPath: readinessAppPath('MC-62'), appUrl: null };

  it('adds the link when the base is complete', async () => {
    const out = (await withAppUrl(ok, base)) as { appUrl: string; appPath: string };
    expect(out.appUrl).toMatch(/^https:\/\/example\.atlassian\.net\/apps\/full-page\//);
    expect(out.appPath).toBe(ok.appPath);
  });

  it('prepare-rehearsal uses rehearsalPath', async () => {
    const rehearsalPath = rehearsalAppPath({
      changeKey: 'MC-62',
      findingId: FINDING,
      restoreTargetMinutes: 30,
    });
    const out = (await withAppUrl({ ok: true, rehearsalPath, appUrl: null }, base)) as {
      appUrl: string;
    };
    expect(out.appUrl).toContain('/scenarioforge/simulations?');
  });

  it.each([
    ['no base', async () => null],
    [
      'throws',
      async () => {
        throw new Error('x');
      },
    ],
    ['bad site', async () => ({ siteUrl: 'https://evil.com', installationId: INSTALL })],
    ['bad install', async () => ({ siteUrl: SITE, installationId: 'x' })],
  ])('incomplete context (%s): appUrl null, appPath kept', async (_n, incomplete) => {
    const out = (await withAppUrl(ok, incomplete)) as { appUrl: unknown; appPath: string };
    expect(out.appUrl).toBeNull();
    expect(out.appPath).toBe(ok.appPath);
    expect(JSON.stringify(out)).not.toContain('apps/full-page');
  });

  it('leaves failures and outputs without a path untouched', async () => {
    const failure = { ok: false, code: 'NOT_FOUND' };
    expect(await withAppUrl(failure, base)).toBe(failure);
    const outcome = { ok: true, sessionId: 's' };
    expect(await withAppUrl(outcome, base)).toBe(outcome);
  });
});

describe('buildAppUrl canonical form', () => {
  const base = {
    siteUrl: 'https://a.atlassian.net',
    installationId: '0123abcd-0123-0123-0123-0123456789ab',
  };
  it('refuses parseable but non-canonical paths (trailing slash, percent-encoded letters)', () => {
    expect(buildAppUrl({ ...base, appPath: '/readiness-checks/?change=MC-62' })).toBeNull();
    expect(buildAppUrl({ ...base, appPath: '/readiness-checks?change=%4DC-62' })).toBeNull();
    expect(buildAppUrl({ ...base, appPath: '/readiness-checks?change=MC-62' })).not.toBeNull();
  });
});

describe('forgeLinkBase', () => {
  it('returns null when the runtime context is unavailable', async () => {
    expect(await forgeLinkBase()).toBeNull();
  });
});

describe('createLinkBaseResolver cache', () => {
  function make(sites: Array<{ ok: true; data: string } | { ok: false } | 'throw'>, id = INSTALL) {
    let t = 1_000;
    let calls = 0;
    let installation = id;
    const resolve = createLinkBaseResolver({
      installationId: () => installation,
      readSite: async () => {
        const next = sites[Math.min(calls++, sites.length - 1)]!;
        if (next === 'throw') throw new Error('boom');
        return next;
      },
      now: () => t,
    });
    return {
      resolve,
      calls: () => calls,
      advance: (ms: number) => (t += ms),
      as: (next: string) => (installation = next),
    };
  }

  it('hits the cache within the TTL and refetches after expiry', async () => {
    const m = make([{ ok: true, data: SITE }]);
    expect(await m.resolve()).toEqual({ siteUrl: SITE, installationId: INSTALL });
    await m.resolve();
    expect(m.calls()).toBe(1);
    m.advance(LINK_BASE_TTL_MS - 1);
    await m.resolve();
    expect(m.calls()).toBe(1);
    m.advance(2);
    await m.resolve();
    expect(m.calls()).toBe(2);
  });

  it('caches failures only for a few seconds and returns null', async () => {
    const m = make([{ ok: false }, 'throw', { ok: true, data: SITE }]);
    expect(await m.resolve()).toBeNull();
    expect(await m.resolve()).toBeNull();
    expect(m.calls()).toBe(1);
    m.advance(LINK_BASE_FAILURE_TTL_MS + 1);
    expect(await m.resolve()).toBeNull(); // throw
    m.advance(LINK_BASE_FAILURE_TTL_MS + 1);
    expect(await m.resolve()).toEqual({ siteUrl: SITE, installationId: INSTALL });
  });

  it('never caches or returns hostile site values', async () => {
    for (const bad of [
      'http://example.atlassian.net',
      'https://evil.example.com',
      'https://example.atlassian.net.evil.com',
      'https://user@example.atlassian.net',
      'https://example.atlassian.net/path',
      'https://example.atlassian.net/',
      'https://EXAMPLE.atlassian.net',
      '',
    ]) {
      const m = make([{ ok: true, data: bad }]);
      expect(await m.resolve(), bad).toBeNull();
    }
  });

  it('refuses malformed installation ids and keys the cache per installation', async () => {
    const m = make([{ ok: true, data: SITE }], 'bad id!');
    expect(await m.resolve()).toBeNull();
    expect(m.calls()).toBe(0);
    m.as(INSTALL);
    await m.resolve();
    m.as('1111aaaa-1111-4222-8333-944455556666');
    expect((await m.resolve())?.installationId).toBe('1111aaaa-1111-4222-8333-944455556666');
    expect(m.calls()).toBe(2);
  });

  it('is bounded and shares concurrent misses', async () => {
    const m = make([{ ok: true, data: SITE }]);
    await Promise.all([m.resolve(), m.resolve(), m.resolve()]);
    expect(m.calls()).toBe(1);
    for (let i = 0; i < LINK_BASE_MAX_ENTRIES + 3; i++) {
      m.as(`aaaaaaaa-${String(i).padStart(4, '0')}`);
      await m.resolve();
    }
    m.as(INSTALL); // oldest, evicted
    await m.resolve();
    expect(m.calls()).toBe(1 + LINK_BASE_MAX_ENTRIES + 3 + 1);
  });
});
