import { useSite } from '../lib/site';
import { PageHeader } from '../components/Shell';
import { useConnection } from '../components/Connection';
import { ErrorPanel } from '../components/States';
import { formatAbsolute } from '../lib/format';

const SOURCES: { name: string; status: string; detail: string }[] = [
  {
    name: 'Jira',
    status: 'Checking',
    detail: 'Issue search and your own profile, read only, as you.',
  },
  {
    name: 'Confluence',
    status: 'In testing',
    detail:
      'Recovery runbook search and page steps, read only, as you. Being verified in a separate test environment.',
  },
  {
    name: 'Jira Service Management',
    status: 'Not connected',
    detail: 'Services and owners, planned for M2.',
  },
  {
    name: 'Rovo',
    status: 'Not connected',
    detail: 'Investigator and facilitator agent, planned for M6.',
  },
  {
    name: 'Teamwork Graph',
    status: 'Not connected',
    detail: 'Dependency enrichment, planned for M9.',
  },
];

export function SettingsPage() {
  const { siteUrl } = useSite();
  const { state, retry } = useConnection();
  // The Jira row reflects the live check rather than assuming success.
  const jiraStatus =
    state.status === 'ready'
      ? 'Connected'
      : state.status === 'error'
        ? 'Not connected'
        : 'Checking';

  return (
    <>
      <PageHeader
        title="Settings"
        lead="What ScenarioForge can read, and how it treats your data."
      />

      <section className="region" aria-labelledby="conn-title">
        <h2 id="conn-title" className="section-title">
          Jira connection
        </h2>
        {state.status === 'error' ? (
          <ErrorPanel error={state.error} onRetry={retry} />
        ) : (
          <dl className="facts">
            <dt>Status</dt>
            <dd>{state.status === 'loading' ? 'Checking' : 'Connected'}</dd>
            <dt>Signed in as</dt>
            <dd>
              {state.status === 'ready' ? (state.data.userDisplayName ?? 'Unknown') : 'Checking'}
            </dd>
            <dt>Site</dt>
            <dd>{siteUrl ?? 'Unknown'}</dd>
            <dt>Last checked</dt>
            <dd>{state.status === 'ready' ? formatAbsolute(state.data.checkedAt) : 'Checking'}</dd>
          </dl>
        )}
      </section>

      <section className="region" aria-labelledby="sources-title">
        <h2 id="sources-title" className="section-title">
          Data sources
        </h2>
        <table className="plain-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Used for</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td data-label="Status">{s.name === 'Jira' ? jiraStatus : s.status}</td>
                <td data-label="Used for">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="region" aria-labelledby="data-title">
        <h2 id="data-title" className="section-title">
          Data handling
        </h2>
        <dl className="facts">
          <dt>Permissions</dt>
          <dd>
            <code>read:jira-work</code> and <code>read:jira-user</code>. Every request runs as you,
            so you only see issues you can already browse.
          </dd>
          <dt>Storage</dt>
          <dd>
            Nothing is stored. Demo exercise results live in this browser tab until you close it.
          </dd>
          <dt>Demo data</dt>
          <dd>The rehearsal scenario is synthetic and labelled wherever it appears.</dd>
          <dt>AI</dt>
          <dd>No AI is used in this build. Exercise outcomes come from fixed scenario rules.</dd>
        </dl>
      </section>
    </>
  );
}
