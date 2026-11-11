import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '@forge/bridge';
import { ChangesPage } from '../src/pages/Changes';
import { IssueTable } from '../src/components/IssueTable';
import { changes, issue, renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  // The Command center reads saved history; it is not enabled in these tests.
  listRehearsalHistory: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: {
        status: 'UNAVAILABLE',
        detail: 'Rehearsal history is not enabled in this environment.',
      },
    }),
  ),
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
});

describe('Changes page', () => {
  it('shows the error panel and never rows when Jira returns FORBIDDEN', async () => {
    api.listRecentChanges.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'No browse permission.', upstreamStatus: 403 },
    });
    renderInApp(<ChangesPage />);

    expect(
      await screen.findByText('You do not have permission to view these issues'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No browse permission\. \(HTTP 403\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Jira issues could not be loaded.',
    );
  });

  it('retries the same request from the error panel', async () => {
    api.listRecentChanges
      .mockResolvedValueOnce({ ok: false, error: { code: 'UPSTREAM_ERROR', message: 'Down.' } })
      .mockResolvedValueOnce(changes([issue()]));
    renderInApp(<ChangesPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(api.listRecentChanges).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state that widens the window to 12 months', async () => {
    api.listRecentChanges.mockResolvedValue(changes([]));
    renderInApp(<ChangesPage />);

    expect(
      await screen.findByText('No issues you can see were updated in this window'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the last 12 months' }));

    await waitFor(() =>
      expect(api.listRecentChanges).toHaveBeenLastCalledWith({
        updatedWithin: '365d',
        maxResults: 50,
      }),
    );
    expect(screen.getByLabelText('Updated')).toHaveValue('365d');
    // Already at the widest window: no action is offered.
    expect(
      await screen.findByText('No issues you can see were updated in this window'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show the last 12 months' })).toBeNull();
  });

  it('shows a filtered-empty state whose action clears the filters', async () => {
    api.listRecentChanges.mockResolvedValue(
      changes([issue({ key: 'SF-1' }), issue({ key: 'SF-2', summary: 'Rotate keys' })]),
    );
    renderInApp(<ChangesPage />);
    await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'nothing matches');
    expect(screen.getByText('No issues match these filters')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Showing 2 of 2 issues.')).toBeInTheDocument();
  });

  it('labels the data as live Jira data', async () => {
    api.listRecentChanges.mockResolvedValue(changes([issue()]));
    renderInApp(<ChangesPage />);
    expect(screen.getByText('Live Jira data')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic demo data')).toBeNull();
  });
});

describe('IssueTable', () => {
  it('renders key, summary, status and updated, and opens the issue in Jira', async () => {
    const updated = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    renderInApp(
      <IssueTable
        caption="Test issues"
        issues={[
          issue({
            key: 'SF-7',
            summary: 'Move session store',
            status: 'In Progress',
            statusCategory: 'indeterminate',
            updated,
          }),
        ]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Test issues' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Key', 'Summary', 'Type', 'Status', 'Updated']);

    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('Move session store')).toBeInTheDocument();
    expect(within(row).getByText('In Progress')).toBeInTheDocument();
    expect(within(row).getByText('2 days ago')).toHaveAttribute('dateTime', updated);

    // Wait for the site URL from the bridge context, then open the issue.
    const open = within(row).getByRole('button', { name: 'Open SF-7 in Jira (new tab)' });
    expect(open).toHaveTextContent('SF-7');
    await waitFor(async () => {
      vi.mocked(router.open).mockClear();
      await userEvent.click(open);
      expect(router.open).toHaveBeenCalledWith('https://example.atlassian.net/browse/SF-7');
    });
  });

  it('drops the type column in compact mode', () => {
    renderInApp(<IssueTable caption="Compact" compact issues={[issue()]} />);
    expect(screen.queryByRole('columnheader', { name: 'Type' })).toBeNull();
  });
});
