import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { router } from '@forge/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ListRecoveryPagesResponse, RecoveryProcedureExcerpt } from '@shared/api';
import { RecoveryPlansPage } from '../src/pages/RecoveryPlans';
import { renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRecoveryPages: vi.fn(),
  getRecoveryProcedure: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const CQL = 'type = page AND (text ~ "runbook" OR text ~ "recovery")';

function pages(list: ListRecoveryPagesResponse['pages']): ApiResult<ListRecoveryPagesResponse> {
  return {
    ok: true,
    data: { pages: list, truncated: false, fetchedAt: new Date().toISOString(), cql: CQL },
  };
}

const PAGE = {
  id: '98305',
  title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
  spaceKey: 'SFDEMO',
  lastUpdated: new Date(Date.now() - 3600_000).toISOString(),
  webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
};

function procedure(
  overrides: Partial<RecoveryProcedureExcerpt> = {},
): ApiResult<RecoveryProcedureExcerpt> {
  return {
    ok: true,
    data: {
      pageId: PAGE.id,
      title: PAGE.title,
      spaceId: '1',
      lastUpdated: PAGE.lastUpdated,
      webuiPath: PAGE.webuiPath,
      excerpt: 'Synthetic runbook. 1. Confirm failures. 2. Fail over to LegacyAuth.',
      excerptTruncated: false,
      steps: [
        { order: 1, instruction: 'Confirm elevated sign-in failures.', dependsOn: [] },
        { order: 2, instruction: 'Fail over to LegacyAuth.', dependsOn: [] },
      ],
      stepSource: 'ordered-list',
      evidence: {
        id: `confluence-page-${PAGE.id}`,
        origin: 'live',
        kind: 'confluence-page',
        title: PAGE.title,
        retrievedAt: new Date().toISOString(),
      },
      ...overrides,
    },
  };
}

beforeEach(() => {
  api.listRecoveryPages.mockResolvedValue(pages([PAGE]));
  api.getRecoveryProcedure.mockResolvedValue(procedure());
});

describe('Recovery plans', () => {
  it('lists live Confluence pages with the query used', async () => {
    renderInApp(<RecoveryPlansPage />);
    expect(screen.getByText('Live Confluence data')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: PAGE.title })).toBeInTheDocument();
    expect(screen.getByText(CQL)).toBeInTheDocument();
    expect(api.listRecoveryPages).toHaveBeenCalledWith(
      expect.objectContaining({ spaceKey: null, maxResults: 25 }),
    );
  });

  it('opens a page, shows its numbered steps and links to the source', async () => {
    const user = userEvent.setup();
    renderInApp(<RecoveryPlansPage />);
    await user.click(await screen.findByRole('button', { name: PAGE.title }));

    const steps = await screen.findByRole('list');
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Confirm elevated sign-in failures.', 'Fail over to LegacyAuth.']);
    expect(api.getRecoveryProcedure).toHaveBeenCalledWith({ pageId: PAGE.id });
    await user.click(screen.getByRole('button', { name: 'Open in Confluence' }));
    expect(router.open).toHaveBeenCalledWith(`https://example.atlassian.net/wiki${PAGE.webuiPath}`);
  });

  it('does not guess steps when the page has no numbered list', async () => {
    const user = userEvent.setup();
    api.getRecoveryProcedure.mockResolvedValue(procedure({ steps: [], stepSource: 'none' }));
    renderInApp(<RecoveryPlansPage />);
    await user.click(await screen.findByRole('button', { name: PAGE.title }));
    expect(await screen.findByText(/did not guess any steps/)).toBeInTheDocument();
  });

  it('names Confluence when access is missing and shows no pages', async () => {
    api.listRecoveryPages.mockResolvedValue({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Grant access and try again.',
        upstreamStatus: 401,
      },
    });
    renderInApp(<RecoveryPlansPage />);
    expect(await screen.findByText('ScenarioForge needs access to Confluence')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports Confluence being unavailable as an error, not an empty result', async () => {
    api.listRecoveryPages.mockResolvedValue({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Confluence may not be available on this site.',
        upstreamStatus: 404,
      },
    });
    renderInApp(<RecoveryPlansPage />);
    expect(await screen.findByText('Confluence could not find that resource')).toBeInTheDocument();
    expect(screen.queryByText('No recovery pages found')).not.toBeInTheDocument();
  });

  it('validates the space key before searching', async () => {
    const user = userEvent.setup();
    renderInApp(<RecoveryPlansPage />);
    await screen.findByRole('button', { name: PAGE.title });
    await user.type(screen.getByRole('textbox', { name: /Space key/ }), 'OPS DROP');
    expect(screen.getByText(/letters and digits only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();

    await user.clear(screen.getByRole('textbox', { name: /Space key/ }));
    await user.type(screen.getByRole('textbox', { name: /Space key/ }), 'SFDEMO');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(api.listRecoveryPages).toHaveBeenLastCalledWith(
      expect.objectContaining({ spaceKey: 'SFDEMO' }),
    );
  });
});
