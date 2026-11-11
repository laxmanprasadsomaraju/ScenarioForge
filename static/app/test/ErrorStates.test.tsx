import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '@shared/api';
import { ChangesPage } from '../src/pages/Changes';
import { ReadinessPage } from '../src/pages/Readiness';
import { RecoveryPlansPage } from '../src/pages/RecoveryPlans';
import { renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  listRehearsalHistory: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: { status: 'UNAVAILABLE', detail: 'Rehearsal history is not enabled.' },
    }),
  ),
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRecoveryPages: vi.fn(),
  getRecoveryProcedure: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
});

const FAILURES: Array<{ name: string; error: ApiError; title: RegExp }> = [
  {
    name: 'rate limit',
    error: { code: 'RATE_LIMITED', message: 'Slow down.', upstreamStatus: 429 },
    title: /is busy$/,
  },
  {
    name: 'Atlassian down',
    error: { code: 'UPSTREAM_ERROR', message: 'Bad gateway.', upstreamStatus: 502 },
    title: /could not be reached$/,
  },
  {
    name: 'no access (403)',
    error: { code: 'FORBIDDEN', message: 'Not allowed.', upstreamStatus: 403 },
    title: /do not have permission/,
  },
  {
    name: 'not consented',
    error: { code: 'UNAUTHENTICATED', message: 'Needs consent.' },
    title: /needs access to/,
  },
];

/**
 * Every screen that reads from Jira or Confluence shows a named error with the
 * server's reason and a retry, never rows, and never an "all clear".
 */
describe.each(FAILURES)('$name', ({ error, title }) => {
  it('Changes shows an error and no rows', async () => {
    api.listRecentChanges.mockResolvedValue({ ok: false, error });
    renderInApp(<ChangesPage />);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(error.message))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });

  it('Readiness checks shows an error and offers no check', async () => {
    api.listRecentChanges.mockResolvedValue({ ok: false, error });
    renderInApp(<ReadinessPage />);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check recovery impact/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no conflicts/i)).not.toBeInTheDocument();
  });

  it('Runbooks names Confluence and lists no pages', async () => {
    api.listRecoveryPages.mockResolvedValue({ ok: false, error });
    renderInApp(<RecoveryPlansPage />);
    const heading = await screen.findByRole('heading', { name: title });
    expect(heading.textContent).toMatch(/Confluence|permission/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
