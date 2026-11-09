import { describe, expect, it, vi } from 'vitest';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import {
  MAX_EXCERPT_CHARS,
  getRecoveryProcedure,
  searchRecoveryPages,
} from '../src/confluence/client';
import {
  extractOrderedSteps,
  htmlToText,
  mapPage,
  mapPageSearchResponse,
  mapSearchResult,
  safeRelativePath,
} from '../src/confluence/mapping';
import {
  buildRecoveryPagesCql,
  cqlString,
  parseGetRecoveryProcedureRequest,
  parseListRecoveryPagesRequest,
} from '../src/validation';

const NOW = () => new Date('2026-11-09T12:00:00.000Z');

function response(status: number, body: unknown = {}): ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function gateway(
  search: ConfluenceResponse = response(200, { results: [] }),
  page: ConfluenceResponse = response(200),
): ConfluenceGateway {
  return { searchContent: vi.fn(async () => search), getPage: vi.fn(async () => page) };
}

const SEARCH_RESULT = {
  content: {
    id: '98305',
    type: 'page',
    title: 'Auth service failover runbook',
    space: { key: 'OPS' },
    _links: { webui: '/spaces/OPS/pages/98305/Auth+service+failover+runbook' },
  },
  title: 'Auth service @@@hl@@@failover@@@endhl@@@ runbook',
  url: '/spaces/OPS/pages/98305/Auth+service+failover+runbook',
  lastModified: '2026-10-01T08:00:00.000Z',
  resultGlobalContainer: { title: 'Operations', displayUrl: '/spaces/OPS' },
};

const RUNBOOK_STORAGE = [
  '<h2>Fail over the auth service</h2>',
  '<p>Use when the primary IdP is down &amp; logins fail.</p>',
  '<ol>',
  '<li><p>Confirm the outage on the <strong>status</strong> page.</p></li>',
  '<li>Switch DNS to the backup IdP:<ol><li>Open Route 53</li><li>Edit the CNAME</li></ol></li>',
  '<li>Notify #incident &lt;on-call&gt;.</li>',
  '</ol>',
  '<ol><li>Unrelated later list</li></ol>',
].join('');

const PAGE = {
  id: '98305',
  status: 'current',
  title: 'Auth service failover runbook',
  spaceId: '65538',
  version: { number: 7, createdAt: '2026-10-01T08:00:00.000Z' },
  body: { storage: { representation: 'storage', value: RUNBOOK_STORAGE } },
  _links: {
    webui: '/spaces/OPS/pages/98305/Auth+service+failover+runbook',
    base: 'https://example.atlassian.net/wiki',
  },
};

describe('parseListRecoveryPagesRequest', () => {
  it('applies defaults for an empty payload', () => {
    expect(parseListRecoveryPagesRequest(undefined)).toEqual({
      ok: true,
      value: {
        terms: ['runbook', 'recovery', 'failover', 'disaster recovery'],
        spaceKey: null,
        maxResults: 10,
      },
    });
  });

  it('accepts enumerated terms, a space key and a limit', () => {
    expect(
      parseListRecoveryPagesRequest({
        terms: ['failover', 'failover', 'runbook'],
        spaceKey: 'OPS2',
        maxResults: 25,
      }),
    ).toEqual({
      ok: true,
      value: { terms: ['failover', 'runbook'], spaceKey: 'OPS2', maxResults: 25 },
    });
    expect(parseListRecoveryPagesRequest({ spaceKey: '~abc123' }).ok).toBe(true);
  });

  it.each([
    ['array payload', []],
    ['string payload', 'type = page'],
    ['raw CQL field is ignored but CQL term rejected', { terms: ['runbook" OR space = "HR'] }],
    ['free text term', { terms: ['kubernetes'] }],
    ['empty terms', { terms: [] }],
    ['terms not a list', { terms: 'runbook' }],
    ['space key with quote', { spaceKey: 'OPS" OR type = "blogpost' }],
    ['space key with space', { spaceKey: 'OPS DEV' }],
    ['space key with underscore', { spaceKey: 'OPS_DEV' }],
    ['empty space key', { spaceKey: '' }],
    ['overlong space key', { spaceKey: 'A'.repeat(256) }],
    ['numeric space key type', { spaceKey: 42 }],
    ['zero results', { maxResults: 0 }],
    ['too many results', { maxResults: 26 }],
    ['fractional results', { maxResults: 1.5 }],
  ])('rejects %s', (_label, payload) => {
    expect(parseListRecoveryPagesRequest(payload).ok).toBe(false);
  });

  it('never passes client-supplied CQL through', () => {
    const parsed = parseListRecoveryPagesRequest({ cql: 'space = HR' });
    expect(parsed.ok && buildRecoveryPagesCql(parsed.value)).not.toContain('HR');
  });
});

describe('parseGetRecoveryProcedureRequest', () => {
  it('accepts a numeric page id', () => {
    expect(parseGetRecoveryProcedureRequest({ pageId: '98305' })).toEqual({
      ok: true,
      value: { pageId: '98305' },
    });
  });

  it.each([
    undefined,
    {},
    { pageId: 98305 },
    { pageId: '' },
    { pageId: '../../admin' },
    { pageId: '123?expand=body' },
    { pageId: '1'.repeat(20) },
    [],
  ])('rejects %j', (payload) => {
    expect(parseGetRecoveryProcedureRequest(payload).ok).toBe(false);
  });
});

describe('buildRecoveryPagesCql', () => {
  it('builds a page-only query from enum terms and an optional space', () => {
    expect(
      buildRecoveryPagesCql({
        terms: ['runbook', 'disaster recovery'],
        spaceKey: null,
        maxResults: 5,
      }),
    ).toBe('type = page AND (text ~ "runbook" OR text ~ "disaster recovery")');
    expect(buildRecoveryPagesCql({ terms: ['failover'], spaceKey: 'OPS', maxResults: 5 })).toBe(
      'type = page AND (text ~ "failover") AND space = "OPS"',
    );
  });

  it('escapes quotes and backslashes defensively', () => {
    expect(cqlString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe('mapSearchResult', () => {
  it('maps a complete page result using the unhighlighted title', () => {
    expect(mapSearchResult(SEARCH_RESULT)).toEqual({
      id: '98305',
      title: 'Auth service failover runbook',
      spaceKey: 'OPS',
      lastUpdated: '2026-10-01T08:00:00.000Z',
      webuiPath: '/spaces/OPS/pages/98305/Auth+service+failover+runbook',
    });
  });

  it('falls back for missing fields instead of guessing', () => {
    expect(mapSearchResult({ content: { id: '7' } })).toEqual({
      id: '7',
      title: '(untitled page)',
      spaceKey: null,
      lastUpdated: null,
      webuiPath: null,
    });
    expect(
      mapSearchResult({ content: { id: '7' }, resultGlobalContainer: { displayUrl: '/spaces/DR' } })
        ?.spaceKey,
    ).toBe('DR');
  });

  it.each([
    null,
    'page',
    {},
    { content: { id: 'abc' } },
    { content: { id: 7 } },
    { content: { id: '7', type: 'blogpost' } },
  ])('drops unusable result %j', (raw) => {
    expect(mapSearchResult(raw)).toBeNull();
  });

  it.each(['javascript:alert(1)', '//evil.example/x', 'https://evil.example', '/a b', ''])(
    'rejects unsafe link %j',
    (link) => {
      expect(safeRelativePath(link)).toBeNull();
    },
  );
});

describe('mapPageSearchResponse', () => {
  it('flags truncated results', () => {
    expect(
      mapPageSearchResponse({ results: [], _links: { next: '/rest/api/search?c=1' } })?.truncated,
    ).toBe(true);
    expect(
      mapPageSearchResponse({ results: [SEARCH_RESULT], size: 1, totalSize: 4 })?.truncated,
    ).toBe(true);
    expect(
      mapPageSearchResponse({ results: [SEARCH_RESULT], size: 1, totalSize: 1 })?.truncated,
    ).toBe(false);
  });

  it('rejects malformed bodies', () => {
    expect(mapPageSearchResponse(null)).toBeNull();
    expect(mapPageSearchResponse('<html>')).toBeNull();
    expect(mapPageSearchResponse({ results: 'nope' })).toBeNull();
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities into plain text', () => {
    expect(htmlToText('<p>Restore &amp; verify <em>backups</em></p><p>Then&nbsp;report</p>')).toBe(
      'Restore & verify backups\nThen report',
    );
  });

  it('drops script, style and comment content entirely', () => {
    const text = htmlToText(
      '<p>Safe</p><script type="text/javascript">alert("x")</script><style>p{color:red}</style>' +
        '<!-- hidden --><SCRIPT>steal()</SCRIPT ><p>After</p>',
    );
    expect(text).toBe('Safe\nAfter');
  });

  it('drops an unterminated script tag and everything after it', () => {
    expect(htmlToText('<p>Keep</p><script>alert(1)')).toBe('Keep');
  });

  it('keeps escaped markup as inert text and code macro bodies as text', () => {
    expect(htmlToText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '<script>alert(1)</script>',
    );
    expect(
      htmlToText(
        '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[kubectl get <pods>]]></ac:plain-text-body></ac:structured-macro>',
      ),
    ).toBe('kubectl get <pods>');
  });

  it('removes invalid numeric entities and keeps unknown named ones verbatim', () => {
    expect(htmlToText('a&#0;b&#x41;c&copy;')).toBe('abAc&copy;');
  });
});

describe('extractOrderedSteps', () => {
  it('returns the first top-level ordered list with nested text kept on its parent', () => {
    expect(extractOrderedSteps(RUNBOOK_STORAGE)).toEqual([
      { order: 1, instruction: 'Confirm the outage on the status page.', dependsOn: [] },
      {
        order: 2,
        instruction: 'Switch DNS to the backup IdP: Open Route 53 Edit the CNAME',
        dependsOn: [],
      },
      { order: 3, instruction: 'Notify #incident <on-call>.', dependsOn: [] },
    ]);
  });

  it('does not invent steps from prose or unordered lists', () => {
    expect(extractOrderedSteps('<p>Step 1: do it</p><ul><li>bullet</li></ul>')).toEqual([]);
    expect(extractOrderedSteps('')).toEqual([]);
  });

  it('ignores ordered lists inside script blocks and skips empty items', () => {
    expect(
      extractOrderedSteps(
        '<script><ol><li>fake</li></ol></script><ol><li> </li><li>Real</li></ol>',
      ),
    ).toEqual([{ order: 1, instruction: 'Real', dependsOn: [] }]);
  });

  it('handles an unclosed list and items without closing tags', () => {
    expect(extractOrderedSteps('<ol start="3"><li>One<li>Two')).toEqual([
      { order: 1, instruction: 'One', dependsOn: [] },
    ]);
    expect(extractOrderedSteps('<ol><li>One<li>Two</ol>').map((s) => s.instruction)).toEqual([
      'One',
      'Two',
    ]);
  });
});

describe('mapPage', () => {
  it('maps a page and keeps only an https base', () => {
    expect(mapPage(PAGE)).toMatchObject({
      id: '98305',
      spaceId: '65538',
      lastUpdated: '2026-10-01T08:00:00.000Z',
      base: 'https://example.atlassian.net/wiki',
    });
    expect(mapPage({ ...PAGE, _links: { base: 'javascript:alert(1)' } })?.base).toBeNull();
  });

  it('returns an empty body when storage is missing', () => {
    expect(mapPage({ id: '5' })).toEqual({
      id: '5',
      title: '(untitled page)',
      spaceId: null,
      lastUpdated: null,
      webuiPath: null,
      base: null,
      storage: '',
    });
  });

  it.each([null, [], {}, { id: 'x' }, { id: 5 }])('rejects malformed page %j', (raw) => {
    expect(mapPage(raw)).toBeNull();
  });
});

describe('searchRecoveryPages', () => {
  const REQUEST = { terms: ['failover' as const], spaceKey: 'OPS', maxResults: 5 };

  it('returns live pages with the query used', async () => {
    const gw = gateway(response(200, { results: [SEARCH_RESULT], size: 1, totalSize: 1 }));
    const result = await searchRecoveryPages(gw, REQUEST, NOW);
    expect(result).toEqual({
      ok: true,
      data: {
        pages: [mapSearchResult(SEARCH_RESULT)],
        truncated: false,
        fetchedAt: '2026-11-09T12:00:00.000Z',
        cql: 'type = page AND (text ~ "failover") AND space = "OPS"',
      },
    });
    const params = vi.mocked(gw.searchContent).mock.calls[0]![0];
    expect(params.get('limit')).toBe('5');
    expect(params.get('cql')).toBe('type = page AND (text ~ "failover") AND space = "OPS"');
  });

  it('returns an empty list, not an error, when nothing matches', async () => {
    const result = await searchRecoveryPages(gateway(response(200, { results: [] })), REQUEST, NOW);
    expect(result.ok && result.data.pages).toEqual([]);
  });

  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'UPSTREAM_ERROR'],
    [503, 'UPSTREAM_ERROR'],
  ])('maps HTTP %i to %s and returns no data', async (status, code) => {
    const result = await searchRecoveryPages(gateway(response(status)), REQUEST, NOW);
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code, upstreamStatus: status }),
    });
  });

  it('explains a 404 as Confluence possibly being unavailable', async () => {
    const result = await searchRecoveryPages(gateway(response(404)), REQUEST, NOW);
    expect(result.ok === false && result.error.message).toMatch(/not available on this site/);
  });

  it('reports unreadable success bodies as errors', async () => {
    const broken: ConfluenceResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    };
    for (const res of [response(200, '<html>'), broken]) {
      const result = await searchRecoveryPages(gateway(res), REQUEST, NOW);
      expect(result.ok === false && result.error.code).toBe('UNEXPECTED_RESPONSE');
    }
  });
});

describe('getRecoveryProcedure', () => {
  it('returns steps, a plain-text excerpt and live evidence', async () => {
    const gw = gateway(undefined, response(200, PAGE));
    const result = await getRecoveryProcedure(gw, '98305', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stepSource).toBe('ordered-list');
    expect(result.data.steps).toHaveLength(3);
    expect(result.data.excerpt.startsWith('Fail over the auth service\nUse when')).toBe(true);
    expect(result.data.excerpt).not.toMatch(/<(p|ol|li|h2)/);
    expect(result.data.evidence).toEqual({
      id: 'confluence-page:98305',
      origin: 'live',
      kind: 'confluence-page',
      title: 'Auth service failover runbook',
      excerpt: result.data.excerpt,
      url: 'https://example.atlassian.net/wiki/spaces/OPS/pages/98305/Auth+service+failover+runbook',
      retrievedAt: '2026-11-09T12:00:00.000Z',
    });
    const [pageId, params] = vi.mocked(gw.getPage).mock.calls[0]!;
    expect(pageId).toBe('98305');
    expect(params.get('body-format')).toBe('storage');
  });

  it('reports no steps for a page without an ordered list and omits unknown links', async () => {
    const page = { id: '42', title: 'DR notes', body: { storage: { value: '<p>Call Sam.</p>' } } };
    const result = await getRecoveryProcedure(gateway(undefined, response(200, page)), '42', NOW);
    expect(result.ok && result.data).toMatchObject({
      steps: [],
      stepSource: 'none',
      excerpt: 'Call Sam.',
      webuiPath: null,
    });
    expect(result.ok && 'url' in result.data.evidence).toBe(false);
  });

  it('truncates long excerpts and says so', async () => {
    const page = { ...PAGE, body: { storage: { value: `<p>${'x'.repeat(5000)}</p>` } } };
    const result = await getRecoveryProcedure(
      gateway(undefined, response(200, page)),
      '98305',
      NOW,
    );
    expect(result.ok && result.data.excerpt.length).toBe(MAX_EXCERPT_CHARS);
    expect(result.ok && result.data.excerptTruncated).toBe(true);
  });

  it('never returns script content from a hostile body', async () => {
    const page = {
      ...PAGE,
      body: { storage: { value: '<ol><li>Go<script>alert(1)</script></li></ol><style>x</style>' } },
    };
    const result = await getRecoveryProcedure(
      gateway(undefined, response(200, page)),
      '98305',
      NOW,
    );
    expect(JSON.stringify(result)).not.toMatch(/alert|<script|<style/);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'UPSTREAM_ERROR'],
    [502, 'UPSTREAM_ERROR'],
  ])('maps HTTP %i to %s and returns no data', async (status, code) => {
    const result = await getRecoveryProcedure(gateway(undefined, response(status)), '98305', NOW);
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code, upstreamStatus: status }),
    });
  });

  it.each([null, '<html>', { id: 'abc' }, { ...PAGE, id: '1' }])(
    'reports malformed or mismatched page %j as unreadable',
    async (body) => {
      const result = await getRecoveryProcedure(
        gateway(undefined, response(200, body)),
        '98305',
        NOW,
      );
      expect(result.ok === false && result.error.code).toBe('UNEXPECTED_RESPONSE');
    },
  );
});
