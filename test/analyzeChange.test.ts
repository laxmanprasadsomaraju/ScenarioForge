import { describe, expect, it, vi } from 'vitest';
import type { AnalysisEngine } from '../src/analysis/analyzeChange';
import { analyzeChange } from '../src/analysis/analyzeChange';
import { pendingEngine } from '../src/analysis/pendingEngine';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import type { JiraIssueGateway, JiraResponse } from '../src/jira/client';
import { buildRunbookSubjectCql } from '../src/validation';
import type {
  ChangeAnalysis,
  ChangeEvidence,
  ChangeSubject,
  RunbookEvidence,
} from '../shared/analysis/types';
import { MAX_RUNBOOKS_READ } from '../shared/analysis/types';

const NOW = () => new Date('2026-11-10T12:00:00.000Z');

function response(status: number, body: unknown = {}): JiraResponse & ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ISSUE = {
  key: 'MC-10',
  fields: {
    summary: 'Retire LegacyAuth',
    description: null,
    status: { name: 'To Do' },
    issuetype: { name: 'Change' },
    updated: '2026-11-08T09:30:00.000+0000',
  },
};

const SUBJECT: ChangeSubject = {
  term: 'legacyauth',
  display: 'LegacyAuth',
  action: 'retire',
  excerpt: 'Retire LegacyAuth',
};

function searchBody(count: number) {
  return {
    results: Array.from({ length: count }, (_, i) => ({
      content: { id: String(100 + i), type: 'page', title: `Runbook ${i}` },
    })),
    size: count,
  };
}

function pageBody(id: string) {
  return {
    id,
    title: `Runbook ${id}`,
    body: { storage: { value: '<ol><li>Restart LegacyAuth</li></ol>' } },
  };
}

function jiraGateway(issue: JiraResponse = response(200, ISSUE)): JiraIssueGateway {
  return {
    getIssue: vi.fn(async () => issue),
    getRemoteLinks: vi.fn(async () => response(200, [])),
  };
}

function confluenceGateway(
  search: ConfluenceResponse | (() => Promise<ConfluenceResponse>),
  page: (id: string) => Promise<ConfluenceResponse> = async (id) => response(200, pageBody(id)),
): ConfluenceGateway {
  return {
    searchContent: vi.fn(typeof search === 'function' ? search : async () => search),
    getPage: vi.fn(async (id: string) => page(id)),
  };
}

/** Fake engine: records what it was given and reports one finding per runbook. */
function fakeEngine(subjects: ChangeSubject[] = [SUBJECT], terms = ['legacyauth']) {
  const engine: AnalysisEngine = {
    extractChangeSubjects: vi.fn(() => subjects),
    searchTermsForSubjects: vi.fn(() => terms),
    analyzeChange: vi.fn(
      (change: ChangeEvidence, runbooks: RunbookEvidence[], analyzedAt: string) =>
        ({
          changeKey: change.key,
          analyzedAt,
          status: subjects.length === 0 ? 'not-assessed' : 'no-findings',
          ...(subjects.length === 0 ? { notAssessedReason: 'No change subjects recognised.' } : {}),
          subjects,
          findings: [],
          coverage: {
            pagesFound: -1,
            pagesRead: runbooks.length,
            pagesWithoutSteps: 0,
            pagesSkipped: -1,
          },
        }) satisfies ChangeAnalysis,
    ),
  };
  return engine;
}

async function run(
  confluence: ConfluenceGateway,
  engine: AnalysisEngine = fakeEngine(),
  jira: JiraIssueGateway = jiraGateway(),
) {
  return analyzeChange({ jira, confluence, engine, now: NOW }, { issueKey: 'MC-10' });
}

describe('analyzeChange orchestration', () => {
  it('reads the change, searches runbooks for the subject terms and runs the engine', async () => {
    const confluence = confluenceGateway(response(200, searchBody(2)));
    const engine = fakeEngine();
    const result = await run(confluence, engine);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        changeKey: 'MC-10',
        analyzedAt: '2026-11-10T12:00:00.000Z',
        status: 'no-findings',
        subjects: [SUBJECT],
        coverage: { pagesFound: 2, pagesRead: 2, pagesWithoutSteps: 0, pagesSkipped: 0 },
      }),
    });
    const change = vi.mocked(engine.extractChangeSubjects).mock.calls[0]![0];
    expect(change).toMatchObject({ key: 'MC-10', descriptionText: null, remoteLinks: [] });
    const params = vi.mocked(confluence.searchContent).mock.calls[0]![0];
    expect(params.get('cql')).toBe(buildRunbookSubjectCql(['legacyauth']));
    const runbooks = vi.mocked(engine.analyzeChange).mock.calls[0]![1];
    expect(runbooks.map((r) => r.pageId)).toEqual(['100', '101']);
    expect(runbooks[0]!.steps[0]!.instruction).toBe('Restart LegacyAuth');
  });

  it('returns the engine result without calling Confluence when there are no subjects', async () => {
    const confluence = confluenceGateway(response(200, searchBody(1)));
    const engine = fakeEngine([]);
    const result = await run(confluence, engine);
    expect(result.ok && result.data.status).toBe('not-assessed');
    expect(result.ok && result.data.coverage).toMatchObject({ pagesFound: 0, pagesSkipped: 0 });
    expect(confluence.searchContent).not.toHaveBeenCalled();
    expect(confluence.getPage).not.toHaveBeenCalled();
    expect(engine.searchTermsForSubjects).not.toHaveBeenCalled();
  });

  it('reads at most MAX_RUNBOOKS_READ pages and counts the rest as skipped', async () => {
    const confluence = confluenceGateway(response(200, searchBody(MAX_RUNBOOKS_READ + 3)));
    const engine = fakeEngine();
    const result = await run(confluence, engine);
    expect(confluence.getPage).toHaveBeenCalledTimes(MAX_RUNBOOKS_READ);
    expect(vi.mocked(engine.analyzeChange).mock.calls[0]![1]).toHaveLength(MAX_RUNBOOKS_READ);
    expect(result.ok && result.data.coverage).toMatchObject({
      pagesFound: MAX_RUNBOOKS_READ + 3,
      pagesRead: MAX_RUNBOOKS_READ,
      pagesSkipped: 3,
    });
  });

  it('counts page read failures (HTTP error, bad body or exception) as skipped', async () => {
    const confluence = confluenceGateway(response(200, searchBody(4)), async (id) => {
      if (id === '100') return response(403);
      if (id === '101') return response(200, { id: '999' });
      if (id === '102') throw new Error('network');
      return response(200, pageBody(id));
    });
    const engine = fakeEngine();
    const result = await run(confluence, engine);
    expect(vi.mocked(engine.analyzeChange).mock.calls[0]![1].map((r) => r.pageId)).toEqual(['103']);
    expect(result.ok && result.data.coverage).toMatchObject({
      pagesFound: 4,
      pagesRead: 1,
      pagesSkipped: 3,
    });
  });

  it('is not-assessed with the subjects kept when no page could be read', async () => {
    const confluence = confluenceGateway(response(200, searchBody(2)), async () => response(403));
    const engine = fakeEngine();
    const result = await run(confluence, engine);
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        status: 'not-assessed',
        notAssessedReason:
          'Runbooks were not checked: 2 recovery pages found, but none could be read.',
        subjects: [SUBJECT],
        findings: [],
        coverage: { pagesFound: 2, pagesRead: 0, pagesWithoutSteps: 0, pagesSkipped: 2 },
      }),
    });
    expect(engine.analyzeChange).not.toHaveBeenCalled();
  });

  it('is not-assessed (not no-findings) when no recovery page mentions a subject', async () => {
    const result = await run(confluenceGateway(response(200, searchBody(0))));
    expect(result.ok && result.data).toMatchObject({
      status: 'not-assessed',
      notAssessedReason:
        'Runbooks were not checked: No Confluence recovery page you can view mentions legacyauth.',
      subjects: [SUBJECT],
    });
  });

  it.each([401, 403, 404])(
    'reports Confluence search HTTP %i as not-assessed with a reason and keeps subjects',
    async (status) => {
      const confluence = confluenceGateway(response(status));
      const result = await run(confluence);
      expect(result.ok).toBe(true);
      const data = result.ok ? result.data : null;
      expect(data?.status).toBe('not-assessed');
      expect(data?.notAssessedReason).toMatch(/^Runbooks were not checked: .*Confluence/);
      expect(data?.subjects).toEqual([SUBJECT]);
      expect(data?.findings).toEqual([]);
      expect(confluence.getPage).not.toHaveBeenCalled();
    },
  );

  it('reports a thrown Confluence search as not-assessed', async () => {
    const confluence = confluenceGateway(async () => {
      throw new Error('socket hang up');
    });
    const result = await run(confluence);
    expect(result.ok && result.data.notAssessedReason).toBe(
      'Runbooks were not checked: ScenarioForge could not reach Confluence.',
    );
  });

  it('does not search when the engine returns an unsafe term', async () => {
    const confluence = confluenceGateway(response(200, searchBody(1)));
    const result = await run(confluence, fakeEngine([SUBJECT], ['x" OR space = "HR']));
    expect(result.ok && result.data.status).toBe('not-assessed');
    expect(result.ok && result.data.notAssessedReason).toMatch(/^Runbooks were not searched/);
    expect(confluence.searchContent).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [401, 'UNAUTHENTICATED'],
  ])('returns Jira HTTP %i as a %s error', async (status, code) => {
    const confluence = confluenceGateway(response(200, searchBody(1)));
    const engine = fakeEngine();
    const result = await run(confluence, engine, jiraGateway(response(status)));
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code, upstreamStatus: status }),
    });
    expect(engine.extractChangeSubjects).not.toHaveBeenCalled();
    expect(confluence.searchContent).not.toHaveBeenCalled();
  });

  it('the placeholder engine reports not-assessed without calling Confluence', async () => {
    const confluence = confluenceGateway(response(200, searchBody(1)));
    const result = await run(confluence, pendingEngine);
    expect(result.ok && result.data.status).toBe('not-assessed');
    expect(confluence.searchContent).not.toHaveBeenCalled();
  });
});
