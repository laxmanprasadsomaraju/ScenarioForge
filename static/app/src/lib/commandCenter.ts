import type { HistoryListItem } from '@shared/api';
import type { CheckRecord } from './checkLog';
import type { CompletedExercise } from './exercises';
import type { RouteId } from './routes';

/**
 * Read-only selectors for the Command center. Every figure and every action
 * comes from state the app holds now (this tab's checks and rehearsals, the
 * saved history when it can be read); nothing is estimated or defaulted.
 */

export type ActionKind = 'rehearse' | 'review' | 'retest';

export interface PriorityAction {
  id: string;
  kind: ActionKind;
  /** Verb first: what to do. */
  title: string;
  /** Why, in one sentence, naming the state it came from. */
  reason: string;
  /** Where the action opens: a readiness check, or a screen. */
  target: { kind: 'check'; changeKey: string; findingId: string } | { kind: 'route'; id: RouteId };
  label: string;
}

const scenarioIdFor = (changeKey: string, findingId: string) =>
  `rehearsal:${changeKey}:${findingId}`;

/** Scenario ids of finding rehearsals completed in this tab or saved to history. */
export function rehearsedScenarioIds(
  completed: CompletedExercise[],
  saved: HistoryListItem[] | null,
): Set<string> {
  const ids = new Set(completed.map((ex) => ex.scenario.id));
  for (const item of saved ?? []) {
    if (item.run.changeKey && item.run.findingId) {
      ids.add(scenarioIdFor(item.run.changeKey, item.run.findingId));
    }
  }
  return ids;
}

/** Runs in this tab that missed objectives and have no retest yet. */
export function runsAwaitingRetest(completed: CompletedExercise[]): CompletedExercise[] {
  const retested = new Set(
    completed.flatMap((ex) => (ex.retest ? [ex.retest.original.session.id] : [])),
  );
  return completed.filter(
    (ex) =>
      !ex.retest &&
      ex.evaluation.metCount < ex.evaluation.totalCount &&
      !retested.has(ex.session.id),
  );
}

const step = (f: { pageTitle: string; stepOrder: number }) => `${f.pageTitle}, step ${f.stepOrder}`;

/**
 * What to do next, most urgent first: confirmed findings not yet rehearsed,
 * then suspected findings to confirm or dismiss, then runs to retest. Empty
 * when nothing in the current state calls for an action.
 */
export function priorityActions(
  checks: CheckRecord[],
  completed: CompletedExercise[],
  saved: HistoryListItem[] | null,
): PriorityAction[] {
  const rehearsed = rehearsedScenarioIds(completed, saved);
  const rehearse: PriorityAction[] = [];
  const review: PriorityAction[] = [];
  for (const check of checks) {
    for (const f of check.findings) {
      if (rehearsed.has(scenarioIdFor(check.changeKey, f.id))) continue;
      const target = { kind: 'check', changeKey: check.changeKey, findingId: f.id } as const;
      if (f.confidence === 'confirmed') {
        rehearse.push({
          id: `rehearse:${f.id}`,
          kind: 'rehearse',
          title: `Rehearse the confirmed finding on ${check.changeKey}`,
          reason: `${step(f)} conflicts with this change and has not been rehearsed.`,
          target,
          label: 'Rehearse',
        });
      } else {
        review.push({
          id: `review:${f.id}`,
          kind: 'review',
          title: `Confirm or review the suspected finding on ${check.changeKey}`,
          reason: `${step(f)} may be affected; the link is not confirmed.`,
          target,
          label: 'Review finding',
        });
      }
    }
  }
  const retest: PriorityAction[] = runsAwaitingRetest(completed).map((ex) => ({
    id: `retest:${ex.session.id}`,
    kind: 'retest',
    title: `Retest “${ex.scenario.title}”`,
    reason: `Met ${ex.evaluation.metCount} of ${ex.evaluation.totalCount} objectives (modelled), with no retest after fixes.`,
    target: { kind: 'route', id: 'reports' },
    label: 'Open run to retest',
  }));
  return [...rehearse, ...review, ...retest];
}

export interface FindingCounts {
  confirmed: number;
  suspected: number;
  /** Checks that ran but could not assess the change. */
  notAssessed: number;
}

export function findingCounts(checks: CheckRecord[]): FindingCounts {
  let confirmed = 0;
  let suspected = 0;
  let notAssessed = 0;
  for (const c of checks) {
    if (c.status === 'not-assessed') notAssessed += 1;
    for (const f of c.findings) {
      if (f.confidence === 'confirmed') confirmed += 1;
      else suspected += 1;
    }
  }
  return { confirmed, suspected, notAssessed };
}
