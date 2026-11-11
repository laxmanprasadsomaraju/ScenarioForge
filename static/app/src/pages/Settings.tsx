import { useCallback } from 'react';
import { useSite } from '../lib/site';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { PageHeader } from '../components/PageHeader';
import { useConnection } from '../components/Connection';
import { ErrorPanel, SkeletonRows } from '../components/States';
import { StatusBadge, type StatusTone } from '../components/Badge';
import { AppearanceControl } from '../components/AppearanceControl';
import { useRovoEnabled } from '../components/AskRovo';
import { formatAbsolute } from '../lib/format';
import { MANIFEST_SCOPES, NOT_REQUESTED_SCOPES } from '@shared/environment';
import { MAX_AGE_DAYS, MAX_RETESTS_PER_RUN, MAX_RUNS_PER_USER } from '@shared/history/store';

interface SourceRow {
  name: string;
  tone: StatusTone;
  status: string;
  detail: string;
}

/** Sources this build does not read. Planned, never shown as connected. */
const NOT_CONNECTED: SourceRow[] = [
  {
    name: 'Jira Service Management',
    tone: 'unknown',
    status: 'Not connected',
    detail: 'Services and owners. Not read by this build.',
  },
  {
    name: 'Teamwork Graph',
    tone: 'unknown',
    status: 'Not connected',
    detail: 'Dependency enrichment. Not read by this build.',
  },
];

const SAFETY_RULES = [
  'Every request runs as you, so you only see what you can already open in Jira and Confluence.',
  'Read only: ScenarioForge never edits, creates or deletes anything in Jira or Confluence.',
  'Findings are never shown from a link alone; they come from your own check.',
  'Rehearsal outcomes are modelled by fixed scenario rules. The same choices give the same result.',
  'Synthetic demo data is labelled wherever it appears and is never mixed into live results.',
  'Fix work items are drafts for you to copy; nothing is created on your behalf.',
];

function HistoryRetention() {
  const load = useCallback(() => api.listRehearsalHistory(), []);
  const { state, retry } = useApi(load);
  if (state.status === 'loading') return <SkeletonRows rows={2} label="Checking history" />;
  if (state.status === 'error')
    return <ErrorPanel error={state.error} onRetry={retry} product="Jira" />;
  const r = state.data;
  const enabled = r.status === 'OK' || r.status === 'CONFLICT';
  return (
    <dl className="facts">
      <dt>Status</dt>
      <dd>
        {enabled ? (
          <StatusBadge tone="info">Saved on this site</StatusBadge>
        ) : (
          <StatusBadge tone="unknown">Not enabled in this environment</StatusBadge>
        )}
      </dd>
      {r.status === 'UNAVAILABLE' || r.status === 'IDENTITY_UNAVAILABLE' ? (
        <>
          <dt>Detail</dt>
          <dd>
            {r.detail} Rehearsals and their reports stay in this browser tab until you close it.
          </dd>
        </>
      ) : null}
      {r.status === 'OK' ? (
        <>
          <dt>Saved rehearsals</dt>
          <dd className="num">{r.items.length}</dd>
        </>
      ) : null}
      <dt>Retention</dt>
      <dd>
        {enabled
          ? `Your own rehearsals only, kept for ${MAX_AGE_DAYS} days; at most ${MAX_RUNS_PER_USER} runs, each with up to ${MAX_RETESTS_PER_RUN} retests. The oldest go first.`
          : 'Nothing is stored, so nothing is retained.'}
      </dd>
    </dl>
  );
}

export function SettingsPage() {
  const { siteUrl } = useSite();
  const { state, retry } = useConnection();
  const rovoEnabled = useRovoEnabled();
  // The Jira row reflects the live check rather than assuming success.
  const jira: SourceRow =
    state.status === 'ready'
      ? {
          name: 'Jira',
          tone: 'info',
          status: 'Connected',
          detail: 'Issue search and your own profile, read only, as you.',
        }
      : state.status === 'error'
        ? {
            name: 'Jira',
            tone: 'danger',
            status: 'Not connected',
            detail: 'The connection check failed; see above.',
          }
        : { name: 'Jira', tone: 'unknown', status: 'Checking', detail: 'Checking now.' };
  const sources: SourceRow[] = [
    jira,
    {
      name: 'Confluence',
      tone: 'unknown',
      status: 'Permitted, checked on use',
      detail:
        'Runbook search and page steps, read only, as you. Checked each time you open Runbooks or run a readiness check.',
    },
    ...NOT_CONNECTED,
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        lead="What ScenarioForge can read, what it keeps, and the rules it follows."
      />

      <section className="region" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="section-title">
          Appearance
        </h2>
        <AppearanceControl />
      </section>

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
          Connected sources
        </h2>
        <table className="plain-table" aria-labelledby="sources-title">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Used for</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td data-label="Status">
                  <StatusBadge tone={s.tone}>{s.status}</StatusBadge>
                </td>
                <td data-label="Used for">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="region" aria-labelledby="perm-title">
        <h2 id="perm-title" className="section-title">
          Permissions
        </h2>
        <p className="region-body">
          The scopes this installation requests, exactly as declared. Nothing else is available to
          the app.
        </p>
        <table className="plain-table" aria-labelledby="perm-title">
          <thead>
            <tr>
              <th scope="col">Scope</th>
              <th scope="col">Product</th>
              <th scope="col">Used for</th>
            </tr>
          </thead>
          <tbody>
            {MANIFEST_SCOPES.map((s) => (
              <tr key={s.scope}>
                <th scope="row">
                  <code>{s.scope}</code>
                </th>
                <td data-label="Product">{s.product}</td>
                <td data-label="Used for">{s.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="settings-subtitle">Not requested</h3>
        <ul className="settings-list">
          {NOT_REQUESTED_SCOPES.map((s) => (
            <li key={s.scope}>
              <code>{s.scope}</code>: not granted, so {s.needed.toLowerCase().replace(/\.$/, '')} is
              off.
            </li>
          ))}
        </ul>
      </section>

      <section className="region" aria-labelledby="ai-title">
        <h2 id="ai-title" className="section-title">
          AI availability
        </h2>
        <dl className="facts">
          <dt>ScenarioForge AI</dt>
          <dd>
            <StatusBadge tone="unknown">Not enabled in this environment</StatusBadge>
          </dd>
          <dt>How results are made</dt>
          <dd>
            Findings come from explicit links and text matches; rehearsal outcomes from fixed
            scenario rules. No AI model is called.
          </dd>
          <dt>Rovo on this site</dt>
          <dd>
            {rovoEnabled
              ? 'Enabled. Where a ScenarioForge agent is installed, an "Ask the investigator" action appears on readiness checks.'
              : 'Not detected. No Rovo actions are shown.'}
          </dd>
        </dl>
      </section>

      <section className="region" aria-labelledby="history-title">
        <h2 id="history-title" className="section-title">
          Rehearsal history and retention
        </h2>
        <HistoryRetention />
      </section>

      <section className="region" aria-labelledby="safety-title">
        <h2 id="safety-title" className="section-title">
          Safety rules
        </h2>
        <ul className="settings-list">
          {SAFETY_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section className="region" aria-labelledby="info-title">
        <h2 id="info-title" className="section-title">
          App info
        </h2>
        <dl className="facts">
          <dt>App</dt>
          <dd>ScenarioForge, a Forge app for Jira (global page)</dd>
          <dt>Runtime</dt>
          <dd>Atlassian Forge; the app runs on Atlassian infrastructure, no external egress.</dd>
          <dt>Site</dt>
          <dd>{siteUrl ?? 'Unknown'}</dd>
          <dt>Demo data</dt>
          <dd>The demo rehearsal scenario is synthetic and labelled wherever it appears.</dd>
        </dl>
      </section>
    </>
  );
}
