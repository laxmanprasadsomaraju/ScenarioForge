import type {
  HistoryListItem,
  ListChangesResponse,
  ListRehearsalHistoryResponse,
} from '@shared/api';
import { readinessLinkPath } from '@shared/links/deepLink';
import { Button } from '../components/Button';
import { OriginBadge, StatusBadge } from '../components/Badge';
import { ConnectionStatusLine } from '../components/Connection';
import { DataRegion } from '../components/DataRegion';
import { OriginTag } from '../components/OriginTag';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/States';
import { CheckImpactButton } from '../components/readiness/CheckImpactButton';
import { JourneyStrip, StatTile, type JourneyStep } from '../components/command/CommandParts';
import { api } from '../lib/api';
import { useCheckLog, type CheckRecord } from '../lib/checkLog';
import { findingCounts, priorityActions, type PriorityAction } from '../lib/commandCenter';
import { useExercises, type CompletedExercise } from '../lib/exercises';
import { useFixApprovals } from '../lib/fixApprovals';
import { formatRelative } from '../lib/format';
import { useRouter } from '../lib/router';
import { useApi, type RemoteState } from '../lib/useApi';

const RECENT_LIMIT = 20;
const loadChanges = () => api.listRecentChanges({ updatedWithin: '30d', maxResults: RECENT_LIMIT });
const loadHistory = () => api.listRehearsalHistory();

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const VERDICT = {
  resolved: 'Resolved',
  'still-failing': 'Still failing',
  inconclusive: 'Inconclusive',
};

/** Saved history when it can be read; null with the reason otherwise. */
function savedHistory(state: RemoteState<ListRehearsalHistoryResponse>): {
  items: HistoryListItem[] | null;
  reason: string | null;
  loading: boolean;
} {
  if (state.status === 'loading') return { items: null, reason: null, loading: true };
  if (state.status === 'error') return { items: null, reason: state.error.message, loading: false };
  const data = state.data;
  if (data.status === 'OK') return { items: data.items, reason: null, loading: false };
  return {
    items: null,
    reason: 'detail' in data ? data.detail : 'History could not be read.',
    loading: false,
  };
}

function checkBadge(check: CheckRecord) {
  if (check.status === 'not-assessed')
    return <StatusBadge tone="unknown">Not assessed</StatusBadge>;
  if (check.findings.length === 0) return <StatusBadge tone="unknown">No findings</StatusBadge>;
  const confirmed = check.findings.some((f) => f.confidence === 'confirmed');
  return (
    <StatusBadge tone={confirmed ? 'warning' : 'suspected'}>
      {plural(check.findings.length, 'finding')}
    </StatusBadge>
  );
}

function exerciseResult(ex: CompletedExercise): string {
  if (ex.retest) return `Retest: ${VERDICT[ex.retest.comparison.outcome]}`;
  return `${ex.evaluation.metCount} of ${ex.evaluation.totalCount} objectives met, modelled`;
}

export function OverviewPage() {
  const { navigate, navigatePath } = useRouter();
  const { completed } = useExercises();
  const { approvals } = useFixApprovals();
  const { checks } = useCheckLog();
  const changes = useApi(loadChanges);
  const history = useApi(loadHistory);
  const saved = savedHistory(history.state);

  const runs = completed.filter((ex) => !ex.retest);
  const retests = completed.filter((ex) => ex.retest);
  const counts = findingCounts(checks);
  const actions = priorityActions(checks, completed, saved.items, approvals);
  const appliedFixes = retests.reduce(
    (n, ex) => n + (ex.retest?.appliedRemediationIds.length ?? 0),
    0,
  );
  const savedRuns = saved.items?.length ?? null;
  const changeState: RemoteState<ListChangesResponse> = changes.state;

  const open = (action: PriorityAction) =>
    action.target.kind === 'check'
      ? navigatePath(readinessLinkPath(action.target.changeKey, action.target.findingId))
      : navigate(action.target.id);

  const summary =
    checks.length === 0 && completed.length === 0
      ? 'Nothing checked or rehearsed in this session yet.'
      : `${plural(checks.length, 'change')} checked and ${plural(runs.length, 'rehearsal')} completed this session. ${
          actions.length === 0
            ? 'Nothing needs action.'
            : `${plural(actions.length, 'item')} need attention.`
        }`;

  const recentCount = changeState.status === 'ready' ? changeState.data.issues.length : null;
  const steps: JourneyStep[] = [
    {
      name: 'Detect',
      status:
        changeState.status === 'ready'
          ? `${plural(changeState.data.issues.length, 'recent change')}${changeState.data.truncated ? ' or more' : ''}`
          : changeState.status === 'error'
            ? 'Jira not available'
            : 'Loading changes',
      active: recentCount !== null && recentCount > 0,
      onOpen: () => navigate('changes'),
      openLabel: 'Detect: open Changes',
    },
    {
      name: 'Understand',
      status: checks.length ? `${plural(checks.length, 'change')} checked` : 'Not started',
      active: checks.length > 0,
      onOpen: () => navigate('readiness'),
      openLabel: 'Understand: open Readiness checks',
    },
    {
      name: 'Rehearse',
      status: runs.length ? `${plural(runs.length, 'rehearsal')} completed` : 'Not started',
      active: runs.length > 0,
      onOpen: () => navigate('simulations'),
      openLabel: 'Rehearse: open Rehearsals',
    },
    {
      name: 'Fix',
      status: appliedFixes
        ? `${plural(appliedFixes, 'fix', 'fixes')} applied in retests`
        : 'None applied',
      active: appliedFixes > 0,
      onOpen: () => navigate('reports'),
      openLabel: 'Fix: open History to review fixes',
    },
    {
      name: 'Verify',
      status: retests.length
        ? `${plural(retests.length, 'retest')} run`
        : savedRuns
          ? `${plural(savedRuns, 'saved run')}, no retest this session`
          : 'Not started',
      active: retests.length > 0,
      onOpen: () => navigate('reports'),
      openLabel: 'Verify: open History',
    },
  ];

  const [first, ...rest] = actions;
  const checkedByKey = new Map(checks.map((c) => [c.changeKey, c]));

  return (
    <>
      <PageHeader
        title="Command center"
        lead="What changed, what you have checked, and what to do next."
        aside={<ConnectionStatusLine />}
      />

      <div className="cc-summary">
        <p className="cc-summary-line">{summary}</p>
        <dl className="cc-sources">
          <div>
            <dt>Changes</dt>
            <dd>
              {changeState.status === 'ready'
                ? `Live from Jira, read ${formatRelative(changeState.data.fetchedAt)}`
                : changeState.status === 'error'
                  ? 'Jira could not be read'
                  : 'Reading Jira'}
            </dd>
          </div>
          <div>
            <dt>Checks and rehearsals</dt>
            <dd>This browser tab only</dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>
              {saved.loading
                ? 'Reading'
                : saved.items
                  ? 'Saved runs available'
                  : 'Not available here'}
            </dd>
          </div>
        </dl>
      </div>

      <JourneyStrip steps={steps} />

      <section className="cc-next" aria-labelledby="next-title">
        <h2 id="next-title" className="section-title">
          Next action
        </h2>
        {first ? (
          <>
            <div className="cc-next-main">
              <div>
                <p className="cc-next-title">{first.title}</p>
                <p className="cc-next-reason">{first.reason}</p>
              </div>
              <Button variant="primary" onClick={() => open(first)}>
                {first.label}
              </Button>
            </div>
            {rest.length ? (
              <ul className="cc-next-list" aria-label="Also needs attention">
                {rest.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <div>
                      <p className="cc-next-item">{a.title}</p>
                      <p className="cc-next-reason">{a.reason}</p>
                    </div>
                    <Button spacing="compact" onClick={() => open(a)}>
                      {a.label}
                    </Button>
                  </li>
                ))}
                {rest.length > 3 ? (
                  <li className="cc-next-more">{plural(rest.length - 3, 'more item')}</li>
                ) : null}
              </ul>
            ) : null}
          </>
        ) : (
          <div className="cc-next-main">
            <div>
              <p className="cc-next-title">
                {checks.length
                  ? 'Nothing needs action from this session'
                  : 'Pick a change to check'}
              </p>
              <p className="cc-next-reason">
                {checks.length
                  ? 'No findings is not a pass: a check reads only the runbooks it can reach.'
                  : 'A check shows which runbook steps one change may break.'}
              </p>
            </div>
            <div className="cc-next-actions">
              <Button variant="primary" onClick={() => navigate('readiness')}>
                {checks.length ? 'Check another change' : 'Check a recent change'}
              </Button>
              {completed.length === 0 ? (
                <Button onClick={() => navigate('simulations')}>Try the synthetic demo</Button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <section className="cc-figures" aria-labelledby="figures-title">
        <h2 id="figures-title" className="section-title">
          Figures
        </h2>
        <dl className="stat-grid">
          <StatTile
            label="Recent changes"
            value={recentCount}
            missing={changeState.status === 'loading' ? 'Loading' : 'Not available'}
            scope="Live from Jira, last 30 days"
            note={
              changeState.status === 'ready' && changeState.data.truncated
                ? `First ${RECENT_LIMIT} shown; more exist`
                : undefined
            }
          />
          <StatTile label="Changes checked" value={checks.length} scope="This session" />
          <StatTile
            label="Findings"
            value={checks.length ? counts.confirmed + counts.suspected : null}
            scope="This session"
            note={
              checks.length
                ? `${counts.confirmed} confirmed, ${counts.suspected} suspected${
                    counts.notAssessed ? `, ${counts.notAssessed} not assessed` : ''
                  }`
                : 'No change checked yet'
            }
          />
          <StatTile
            label="Rehearsals completed"
            value={runs.length}
            scope="This session"
            note={runs[0] ? `Latest: ${exerciseResult(runs[0])}` : undefined}
          />
          <StatTile
            label="Retests"
            value={retests.length}
            scope="This session"
            note={
              retests.length
                ? `${retests.filter((r) => r.retest?.comparison.outcome === 'resolved').length} resolved`
                : undefined
            }
          />
          <StatTile
            label="Saved runs"
            value={savedRuns}
            missing={saved.loading ? 'Loading' : 'Not available'}
            scope="Saved history"
            note={saved.reason ?? undefined}
          />
        </dl>
      </section>

      <div className="overview-grid">
        <DataRegion
          id="recent-title"
          title="Recent changes"
          className="region-changes"
          origin={<OriginTag origin="live" />}
          state={changeState}
          loading={{ label: 'Loading recent Jira changes', rows: 5 }}
          onRetry={changes.retry}
          isEmpty={(data) => data.issues.length === 0}
          empty={
            <EmptyState
              title="No Jira issues updated in the last 30 days"
              action={{ label: 'Browse all changes', onClick: () => navigate('changes') }}
            >
              Issues you can browse in Jira appear here as they change.
            </EmptyState>
          }
        >
          {(data) => (
            <>
              <ul className="cc-changes" aria-label="Recently updated Jira issues">
                {data.issues.slice(0, 5).map((issue) => {
                  const check = checkedByKey.get(issue.key);
                  return (
                    <li key={issue.key}>
                      <div className="cc-change-text">
                        <span className="cc-change-key">{issue.key}</span>
                        <span className="cc-change-summary">{issue.summary}</span>
                        <span className="cc-change-meta">
                          Updated {formatRelative(issue.updated)}
                          {check ? checkBadge(check) : null}
                        </span>
                      </div>
                      <CheckImpactButton issue={issue} />
                    </li>
                  );
                })}
              </ul>
              <div className="region-foot">
                <Button onClick={() => navigate('changes')}>Browse all changes</Button>
              </div>
            </>
          )}
        </DataRegion>

        <section className="region overview-side" aria-labelledby="activity-title">
          <div className="region-head">
            <h2 id="activity-title" className="section-title">
              Exercise activity
            </h2>
            <OriginBadge origin="session">This session</OriginBadge>
          </div>
          {completed.length === 0 ? (
            <EmptyState
              title="No rehearsals this session"
              action={{ label: 'Try the synthetic demo', onClick: () => navigate('simulations') }}
            >
              A short synthetic exercise played on a simulated clock.
            </EmptyState>
          ) : (
            <ul className="activity-list">
              {completed.slice(0, 4).map((ex) => (
                <li key={ex.session.id}>
                  <span className="activity-title">{ex.scenario.title}</span>
                  <span className="activity-result">{exerciseResult(ex)}</span>
                  <span className="activity-when">
                    {ex.scenario.id.startsWith('rehearsal:') ? (
                      <OriginBadge origin="modelled">Modelled</OriginBadge>
                    ) : (
                      <OriginBadge origin="synthetic">Synthetic</OriginBadge>
                    )}
                    {formatRelative(ex.completedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {completed.length ? (
            <div className="region-foot">
              <Button onClick={() => navigate('reports')}>Open history</Button>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
