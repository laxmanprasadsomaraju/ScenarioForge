import { useCallback } from 'react';
import Button from '@atlaskit/button/new';
import { api } from '../lib/api';
import { useExercises } from '../lib/exercises';
import { formatRelative } from '../lib/format';
import { useRouter } from '../lib/router';
import { useApi } from '../lib/useApi';
import { ConnectionStatusLine } from '../components/Connection';
import { IssueTable } from '../components/IssueTable';
import { OriginTag } from '../components/OriginTag';
import { PageHeader } from '../components/Shell';
import { EmptyState, ErrorPanel, SkeletonRows } from '../components/States';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';

type StageState = 'live' | 'demo' | 'planned';

const LOOP: { name: string; state: StageState; note: string }[] = [
  { name: 'Change', state: 'live', note: 'Live from Jira' },
  { name: 'Recovery risk', state: 'live', note: 'Checked per change' },
  { name: 'Rehearsal', state: 'demo', note: 'Demo scenario' },
  { name: 'Evaluation', state: 'demo', note: 'Rule-based, demo' },
  { name: 'Remediation', state: 'planned', note: 'Planned for M8' },
  { name: 'Retest', state: 'planned', note: 'Planned for M8' },
];

export function OverviewPage() {
  const { navigate } = useRouter();
  const { completed } = useExercises();
  const load = useCallback(
    () => api.listRecentChanges({ updatedWithin: '30d', maxResults: 6 }),
    [],
  );
  const { state, retry } = useApi(load);

  return (
    <>
      <PageHeader
        title="Recovery readiness"
        lead="When things change, prove you’re still prepared."
        aside={<ConnectionStatusLine />}
      />

      <section className="loop" aria-labelledby="loop-title">
        <h2 id="loop-title" className="section-title">
          The readiness loop
        </h2>
        <ol className="loop-list">
          {LOOP.map((stage, i) => (
            <li key={stage.name} className={`loop-stage loop-${stage.state}`}>
              <span className="loop-index num">{i + 1}</span>
              <span className="loop-name">{stage.name}</span>
              <span className="loop-state">{stage.note}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="overview-grid">
        <section className="region region-changes" aria-labelledby="recent-title">
          <div className="region-head">
            <h2 id="recent-title" className="section-title">
              Recent changes
            </h2>
            <OriginTag origin="live" />
          </div>
          {state.status === 'loading' ? (
            <SkeletonRows rows={5} label="Loading recent Jira changes" />
          ) : null}
          {state.status === 'error' ? <ErrorPanel error={state.error} onRetry={retry} /> : null}
          {state.status === 'ready' && state.data.issues.length === 0 ? (
            <EmptyState
              title="No Jira issues updated in the last 30 days"
              action={{ label: 'Browse all changes', onClick: () => navigate('changes') }}
            >
              Issues you can browse in Jira appear here as they change.
            </EmptyState>
          ) : null}
          {state.status === 'ready' && state.data.issues.length > 0 ? (
            <>
              <IssueTable
                issues={state.data.issues.slice(0, 6)}
                caption="Recently updated Jira issues"
                compact
              />
              <div className="region-foot">
                <Button appearance="subtle" onClick={() => navigate('changes')}>
                  Filter and sort all changes
                </Button>
              </div>
            </>
          ) : null}
        </section>

        <div className="overview-side">
          <section className="region" aria-labelledby="readiness-title">
            <h2 id="readiness-title" className="section-title">
              Readiness
            </h2>
            <p className="state-unknown">Not assessed</p>
            <p className="region-body">
              Nothing is marked ready. A readiness check looks for conflicts between one change and
              the runbooks it can read; finding none is not a pass. ScenarioForge never reports a
              check as passed without evidence.
            </p>
          </section>

          <section className="region" aria-labelledby="findings-title">
            <h2 id="findings-title" className="section-title">
              Findings
            </h2>
            <p className="region-body">
              Nothing is checked automatically, so no findings are shown here. Pick a change under
              Readiness checks to see which runbook steps it may affect.
            </p>
            <div className="region-foot">
              <Button appearance="subtle" onClick={() => navigate('readiness')}>
                Open readiness checks
              </Button>
            </div>
          </section>

          <section className="region" aria-labelledby="activity-title">
            <div className="region-head">
              <h2 id="activity-title" className="section-title">
                Exercise activity
              </h2>
              <OriginTag origin="demo" />
            </div>
            {completed.length === 0 ? (
              <EmptyState
                title="No rehearsals this session"
                action={{
                  label: 'Start the demo rehearsal',
                  onClick: () => navigate('simulations'),
                }}
              >
                Try “{authBackupRetiredScenario.title}”, a short synthetic exercise played on a
                simulated clock.
              </EmptyState>
            ) : (
              <ul className="activity-list">
                {completed.slice(0, 4).map((ex) => (
                  <li key={ex.session.id}>
                    <span className="activity-score num">
                      {ex.evaluation.metCount}/{ex.evaluation.totalCount}
                    </span>
                    <span>objectives met in T+{ex.evaluation.elapsedMinutes} min</span>
                    <span className="activity-when">{formatRelative(ex.completedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
