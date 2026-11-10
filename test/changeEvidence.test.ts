import { describe, expect, it, vi } from 'vitest';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import { readRunbookEvidence, searchRunbooksForSubjects } from '../src/confluence/client';
import type { JiraIssueGateway, JiraResponse } from '../src/jira/client';
import { getChangeEvidence } from '../src/jira/client';
import { MAX_REMOTE_LINKS, mapIssueDetail, mapRemoteLinks } from '../src/jira/mapping';
import {
  buildRunbookSubjectCql,
  parseAnalyzeChangeRequest,
  parseSubjectTerms,
} from '../src/validation';

const NOW = () => new Date('2026-11-10T12:00:00.000Z');

function response(status: number, body: unknown = {}): JiraResponse & ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ISSUE = {
  key: 'MC-10',
  fields: {
    summary: 'Retire LegacyAuth and migrate to NimbusID',
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'We will retire LegacyAuth on 1 December.' }],
        },
      ],
    },
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    issuetype: { name: 'Change' },
    updated: '2026-11-08T09:30:00.000+0000',
  },
};

const REMOTE_LINKS = [
  {
    id: 10000,
    globalId: 'appId=1&pageId=98305',
    application: { type: 'com.atlassian.confluence', name: 'Confluence' },
    relationship: 'Wiki Page',
    object: {
      url: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=98305',
      title: 'Auth service failover runbook',
    },
  },
];

function jira(issue: JiraResponse, links: JiraResponse = response(200, [])): JiraIssueGateway {
  return { getIssue: vi.fn(async () => issue), getRemoteLinks: vi.fn(async () => links) };
}

describe('parseAnalyzeChangeRequest', () => {
  it('accepts an issue key and ignores other fields', () => {
    expect(parseAnalyzeChangeRequest({ issueKey: 'MC-10', jql: 'project = HR' })).toEqual({
      ok: true,
      value: { issueKey: 'MC-10' },
    });
  });

  it.each([
    undefined,
    null,
    [],
    'MC-10',
    {},
    { issueKey: 10 },
    { issueKey: '' },
    { issueKey: 'mc-10' },
    { issueKey: 'MC-10 OR project = HR' },
    { issueKey: '../MC-10' },
    { issueKey: 'MC-10/remotelink' },
    { issueKey: 'MC-' },
    { issueKey: `${'A'.repeat(70)}-1` },
  ])('rejects %j', (payload) => {
    expect(parseAnalyzeChangeRequest(payload).ok).toBe(false);
  });
});

describe('mapIssueDetail', () => {
  it('maps fields and flattens the ADF description', () => {
    expect(mapIssueDetail(ISSUE)).toEqual({
      origin: 'live',
      key: 'MC-10',
      summary: 'Retire LegacyAuth and migrate to NimbusID',
      descriptionText: 'We will retire LegacyAuth on 1 December.',
      status: 'In Progress',
      issueType: 'Change',
      updated: '2026-11-08T09:30:00.000+0000',
      browsePath: '/browse/MC-10',
    });
  });

  it('reports a missing description as null and missing fields as unknown', () => {
    expect(mapIssueDetail({ key: 'MC-11', fields: { description: null } })).toEqual({
      origin: 'live',
      key: 'MC-11',
      summary: '(no summary)',
      descriptionText: null,
      status: 'Unknown',
      issueType: 'Unknown',
      updated: null,
      browsePath: '/browse/MC-11',
    });
  });

  it.each([null, [], {}, { key: 'bad key' }])('rejects %j', (raw) => {
    expect(mapIssueDetail(raw)).toBeNull();
  });
});

describe('mapRemoteLinks', () => {
  it('keeps title and URL', () => {
    expect(mapRemoteLinks(REMOTE_LINKS)).toEqual([
      {
        title: 'Auth service failover runbook',
        url: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=98305',
      },
    ]);
  });

  it('drops unsafe URLs and falls back to the URL as title', () => {
    expect(
      mapRemoteLinks([
        { object: { url: 'javascript:alert(1)', title: 'x' } },
        { object: { url: 'https://user:pw@evil.example/', title: 'creds' } },
        { object: { url: 'https://ok.example/a b', title: 'space' } },
        { object: { title: 'no url' } },
        null,
        { object: { url: 'http://ok.example/path' } },
      ]),
    ).toEqual([{ title: 'http://ok.example/path', url: 'http://ok.example/path' }]);
  });

  it('caps the number of links', () => {
    const many = Array.from({ length: MAX_REMOTE_LINKS + 5 }, (_, i) => ({
      object: { url: `https://ok.example/${i}`, title: `L${i}` },
    }));
    expect(mapRemoteLinks(many)).toHaveLength(MAX_REMOTE_LINKS);
  });

  it('rejects a non-array body', () => {
    expect(mapRemoteLinks({ object: {} })).toBeNull();
  });
});

describe('getChangeEvidence', () => {
  it('reads the issue with the analysis fields, then its remote links', async () => {
    const gw = jira(response(200, ISSUE), response(200, REMOTE_LINKS));
    const result = await getChangeEvidence(gw, 'MC-10', NOW);
    expect(result).toEqual({
      ok: true,
      data: {
        ...mapIssueDetail(ISSUE),
        remoteLinks: mapRemoteLinks(REMOTE_LINKS),
        retrievedAt: '2026-11-10T12:00:00.000Z',
      },
    });
    const [key, params] = vi.mocked(gw.getIssue).mock.calls[0]!;
    expect(key).toBe('MC-10');
    expect(params.get('fields')).toBe('summary,description,status,issuetype,updated');
    expect(vi.mocked(gw.getRemoteLinks)).toHaveBeenCalledWith('MC-10');
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [500, 'UPSTREAM_ERROR'],
  ])('maps issue HTTP %i to %s without reading links', async (status, code) => {
    const gw = jira(response(status));
    const result = await getChangeEvidence(gw, 'MC-10', NOW);
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code, upstreamStatus: status }),
    });
    expect(gw.getRemoteLinks).not.toHaveBeenCalled();
  });

  it('treats remote links 404 (issue linking off) as no links', async () => {
    const result = await getChangeEvidence(jira(response(200, ISSUE), response(404)), 'MC-10');
    expect(result.ok && result.data.remoteLinks).toEqual([]);
  });

  it('reports other remote link failures', async () => {
    const result = await getChangeEvidence(jira(response(200, ISSUE), response(403)), 'MC-10');
    expect(result.ok === false && result.error.code).toBe('FORBIDDEN');
  });

  it('reports unreadable bodies', async () => {
    expect((await getChangeEvidence(jira(response(200, '<html>')), 'MC-10')).ok).toBe(false);
    expect(
      (await getChangeEvidence(jira(response(200, ISSUE), response(200, {})), 'MC-10')).ok,
    ).toBe(false);
  });
});

describe('subject terms and runbook CQL', () => {
  it('builds recovery AND subject clauses with quoted terms', () => {
    expect(buildRunbookSubjectCql(['legacyauth', 'nimbus-id'])).toBe(
      'type = page AND (text ~ "runbook" OR text ~ "recovery" OR text ~ "failover" OR ' +
        'text ~ "disaster recovery") AND (text ~ "legacyauth" OR text ~ "nimbus-id")',
    );
  });

  it('accepts plain words and removes duplicates', () => {
    expect(parseSubjectTerms(['legacyauth', 'v2.1', 'svc_a', 'legacyauth'])).toEqual({
      ok: true,
      value: ['legacyauth', 'v2.1', 'svc_a'],
    });
  });

  it.each([
    ['empty list', []],
    ['quote injection', ['auth" OR space = "HR']],
    ['space', ['legacy auth']],
    ['single char', ['a']],
    ['leading dot', ['.auth']],
    ['too long', ['a'.repeat(41)]],
    ['non-string', [42]],
    ['wildcard', ['auth*']],
    ['too many', ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']],
  ])('rejects %s', (_label, terms) => {
    expect(parseSubjectTerms(terms).ok).toBe(false);
  });
});

const SEARCH_RESULT = {
  content: {
    id: '98305',
    type: 'page',
    title: 'Auth service failover runbook',
    space: { key: 'OPS' },
    _links: { webui: '/spaces/OPS/pages/98305/Auth' },
  },
  lastModified: '2026-10-01T08:00:00.000Z',
};

const PAGE = {
  id: '98305',
  title: 'Auth service failover runbook',
  spaceId: '65538',
  version: { createdAt: '2026-10-01T08:00:00.000Z' },
  body: {
    storage: {
      value:
        '<p>Use when  the IdP is down.</p><ol><li>Restart <strong>LegacyAuth</strong></li><li>Notify on-call</li></ol>',
    },
  },
  _links: { webui: '/spaces/OPS/pages/98305/Auth', base: 'https://example.atlassian.net/wiki' },
};

function confluence(
  search: ConfluenceResponse = response(200, { results: [] }),
  page: ConfluenceResponse = response(200, PAGE),
): ConfluenceGateway {
  return { searchContent: vi.fn(async () => search), getPage: vi.fn(async () => page) };
}

describe('searchRunbooksForSubjects', () => {
  it('sends the CQL with a bounded limit and maps pages', async () => {
    const gw = confluence(response(200, { results: [SEARCH_RESULT], size: 1 }));
    const result = await searchRunbooksForSubjects(gw, ['legacyauth']);
    expect(result.ok && result.data.pages.map((p) => p.id)).toEqual(['98305']);
    const params = vi.mocked(gw.searchContent).mock.calls[0]![0];
    expect(params.get('cql')).toBe(buildRunbookSubjectCql(['legacyauth']));
    expect(params.get('limit')).toBe('25');
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const result = await searchRunbooksForSubjects(confluence(response(status)), ['legacyauth']);
    expect(result.ok === false && result.error.code).toBe(code);
  });
});

describe('readRunbookEvidence', () => {
  it('maps the page body to plain text and ordered steps', async () => {
    const result = await readRunbookEvidence(confluence(), '98305', NOW);
    expect(result).toEqual({
      ok: true,
      data: {
        origin: 'live',
        pageId: '98305',
        title: 'Auth service failover runbook',
        webuiPath: '/spaces/OPS/pages/98305/Auth',
        lastUpdated: '2026-10-01T08:00:00.000Z',
        steps: [
          { order: 1, instruction: 'Restart LegacyAuth', dependsOn: [] },
          { order: 2, instruction: 'Notify on-call', dependsOn: [] },
        ],
        stepSource: 'ordered-list',
        text: 'Use when the IdP is down.\nRestart LegacyAuth\nNotify on-call',
        retrievedAt: '2026-11-10T12:00:00.000Z',
      },
    });
  });

  it('rejects a body for another page id', async () => {
    const result = await readRunbookEvidence(confluence(), '1', NOW);
    expect(result.ok).toBe(false);
  });
});
