import { describe, expect, it, vi } from 'vitest';
import type { JiraGateway, JiraResponse } from '../src/jira/client';
import { checkConnection, listRecentChanges } from '../src/jira/client';
import { mapIssue, mapSearchResponse } from '../src/jira/mapping';

const NOW = () => new Date('2026-11-09T12:00:00.000Z');

function response(status: number, body: unknown = {}): JiraResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function gateway(search: JiraResponse, myself: JiraResponse = response(200)): JiraGateway {
  return { searchIssues: vi.fn(async () => search), myself: vi.fn(async () => myself) };
}

const FULL_ISSUE = {
  key: 'SF-12',
  fields: {
    summary: 'Retire backup SSO provider',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    issuetype: { name: 'Task' },
    project: { key: 'SF' },
    updated: '2026-11-08T09:30:00.000+0000',
  },
};

describe('mapIssue', () => {
  it('maps a complete issue', () => {
    expect(mapIssue(FULL_ISSUE)).toEqual({
      key: 'SF-12',
      summary: 'Retire backup SSO provider',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      issueType: 'Task',
      projectKey: 'SF',
      updated: '2026-11-08T09:30:00.000+0000',
      browsePath: '/browse/SF-12',
    });
  });

  it('labels missing fields as unknown instead of guessing', () => {
    expect(mapIssue({ key: 'OPS-3' })).toEqual({
      key: 'OPS-3',
      summary: '(no summary)',
      status: 'Unknown',
      statusCategory: 'unknown',
      issueType: 'Unknown',
      projectKey: 'OPS',
      updated: null,
      browsePath: '/browse/OPS-3',
    });
  });

  it.each([null, 'SF-1', {}, { key: '' }, { key: '../admin' }, { key: 42 }])(
    'drops unusable issue %j',
    (raw) => {
      expect(mapIssue(raw)).toBeNull();
    },
  );
});

describe('mapSearchResponse', () => {
  it('flags truncated results', () => {
    expect(mapSearchResponse({ issues: [FULL_ISSUE], isLast: false })?.truncated).toBe(true);
    expect(mapSearchResponse({ issues: [], nextPageToken: 'abc' })?.truncated).toBe(true);
    expect(mapSearchResponse({ issues: [], isLast: true })?.truncated).toBe(false);
  });

  it('rejects malformed bodies', () => {
    expect(mapSearchResponse(null)).toBeNull();
    expect(mapSearchResponse({ issues: 'nope' })).toBeNull();
  });
});

describe('listRecentChanges', () => {
  it('returns live issues with the query used', async () => {
    const gw = gateway(response(200, { issues: [FULL_ISSUE], isLast: true }));
    const result = await listRecentChanges(gw, { updatedWithin: '30d', maxResults: 10 }, NOW);
    expect(result).toEqual({
      ok: true,
      data: {
        issues: [mapIssue(FULL_ISSUE)],
        truncated: false,
        fetchedAt: '2026-11-09T12:00:00.000Z',
        jql: 'updated >= -30d ORDER BY updated DESC',
      },
    });
    const params = vi.mocked(gw.searchIssues).mock.calls[0]![0];
    expect(params.get('maxResults')).toBe('10');
    expect(params.get('fields')).toBe('summary,status,issuetype,updated,project');
  });

  it('returns an empty list, not an error, when nothing matches', async () => {
    const result = await listRecentChanges(
      gateway(response(200, { issues: [], isLast: true })),
      { updatedWithin: '7d', maxResults: 5 },
      NOW,
    );
    expect(result.ok && result.data.issues).toEqual([]);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'UPSTREAM_ERROR'],
    [503, 'UPSTREAM_ERROR'],
  ])('maps HTTP %i to %s and returns no data', async (status, code) => {
    const result = await listRecentChanges(
      gateway(response(status)),
      { updatedWithin: '30d', maxResults: 10 },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code, upstreamStatus: status }),
    });
  });

  it('reports an unreadable success body as an error', async () => {
    const result = await listRecentChanges(
      gateway(response(200, '<html>')),
      { updatedWithin: '30d', maxResults: 10 },
      NOW,
    );
    expect(result.ok).toBe(false);
  });
});

describe('checkConnection', () => {
  it('reports the connected user without exposing account details', async () => {
    const result = await checkConnection(
      gateway(
        response(200),
        response(200, { displayName: 'Dev User', emailAddress: 'x@y.z', accountId: 'abc' }),
      ),
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      data: { connected: true, userDisplayName: 'Dev User', checkedAt: '2026-11-09T12:00:00.000Z' },
    });
  });

  it('reports permission failures', async () => {
    const result = await checkConnection(gateway(response(200), response(401)), NOW);
    expect(result.ok === false && result.error.code).toBe('UNAUTHENTICATED');
  });
});
