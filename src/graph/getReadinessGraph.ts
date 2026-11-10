import type { GetReadinessGraphRequest, ReadinessGraph } from '../../shared/graph/types';
import { buildGraphFromAnalysis } from '../../shared/graph/build';
import { validateGraph } from '../../shared/graph/validate';
import type { ApiResult } from '../../shared/api';
import { jsmGraphExtras } from '../../shared/graph/jsm';
import type { AnalyzeChangeDeps } from '../analysis/analyzeChange';
import { analyzeChange } from '../analysis/analyzeChange';
import type { JiraFieldGateway } from '../jira/affectedServices';
import { probeAffectedServices } from '../jira/affectedServices';
import type { JiraIssueGateway } from '../jira/client';

export interface ReadinessGraphDeps extends AnalyzeChangeDeps {
  jira: JiraIssueGateway & JiraFieldGateway;
}

/**
 * Readiness graph for one change (M4), read as the signed-in user.
 *
 * Runs the M3 change-to-recovery analysis with the same gateways and engine,
 * then builds the graph from it. Services come from the JSM Affected services
 * probe (one field read with `read:jira-work`, see
 * src/jira/affectedServices.ts); a probe failure only changes the JSM source
 * status and never fails the graph. No team source is connected yet, so
 * owning teams stay unassessed.
 *
 * A graph that fails `validateGraph` is never returned: it would mean an edge
 * without evidence or an invented node, so the caller gets an
 * `UNEXPECTED_RESPONSE` error instead. Only the problem count is logged, so
 * no page or issue text reaches the logs.
 */
export async function getReadinessGraph(
  deps: ReadinessGraphDeps,
  request: GetReadinessGraphRequest,
): Promise<ApiResult<ReadinessGraph>> {
  const analysis = await analyzeChange(deps, request);
  if (!analysis.ok) {
    return analysis;
  }
  const now = deps.now ?? (() => new Date());
  const probe = await probeAffectedServices(deps.jira, analysis.data.changeKey, now);
  const graph = buildGraphFromAnalysis(
    analysis.data,
    now().toISOString(),
    jsmGraphExtras(analysis.data, probe),
  );
  const problems = validateGraph(graph);
  if (problems.length > 0) {
    console.error('Readiness graph failed validation', `${problems.length} problem(s)`);
    return {
      ok: false,
      error: {
        code: 'UNEXPECTED_RESPONSE',
        message: 'ScenarioForge could not build a readiness graph it can stand behind.',
      },
    };
  }
  return { ok: true, data: graph };
}
