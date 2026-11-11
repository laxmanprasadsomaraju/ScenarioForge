import type {
  ApiResult,
  ApprovalSource,
  CheckRemediationApprovalRequest,
  CheckRemediationApprovalResponse,
  PrepareRemediationRequest,
  PrepareRemediationResponse,
} from '../../shared/api';
import { generateRehearsal } from '../../shared/rehearsal/generate';
import {
  buildCreateIssueRequest,
  buildDuplicateJql,
  buildWorkItemDraft,
  checkRequestApproval,
  decideDuplicate,
  draftHash,
  FIXED_ISSUE_TYPES,
  requestHash,
  REVIEW_STEP_FIX_ID,
  type DraftFix,
  type DuplicateCheck,
  type ExistingWorkItem,
  type RemediationRequest,
  type WorkItemDraft,
} from '../../shared/remediation';
import type { AnalysisEngine } from '../analysis/analyzeChange';
import { analyzeChange } from '../analysis/analyzeChange';
import type { ConfluenceGateway } from '../confluence/client';
import type { JiraIssueGateway, JiraResponse } from '../jira/client';
import { errorFromStatus } from '../jira/mapping';
import type { ServerInfoGateway } from './site';
import { readTrustedSite } from './site';

/**
 * Read-only preparation of a remediation work item (M8).
 *
 * Every call here is a GET made as the user: serverInfo for the site address,
 * the change and its remote links, the Confluence runbook search and pages
 * (through `analyzeChange`), and the duplicate search. Nothing is created,
 * linked or commented; there is no create path in this module.
 */

/** Read-only Jira calls used to prepare a work item. */
export interface RemediationJiraGateway extends JiraIssueGateway, ServerInfoGateway {
  /** `GET /rest/api/3/search/jql` */
  searchIssues(params: URLSearchParams): Promise<JiraResponse>;
}

export interface PrepareRemediationDeps {
  jira: RemediationJiraGateway;
  confluence: ConfluenceGateway;
  engine: AnalysisEngine;
  now?: () => Date;
}

/** More than one match is already `ambiguous`, so a few results are enough. */
export const DUPLICATE_SEARCH_MAX_RESULTS = 10;
const DUPLICATE_SEARCH_FIELDS = 'summary,labels';

/**
 * The fix text of `rem-step` / `rem-change-check` comes from the rehearsal
 * generator, whose remediation actions do not depend on the restore target.
 * This value only satisfies its input check; nothing else is read from it.
 */
const FIX_LOOKUP_RESTORE_MINUTES = 60;

interface Prepared {
  source: ApprovalSource;
  draft: WorkItemDraft;
  request: RemediationRequest;
  siteUrl: string;
}

function invalid(message: string): ApiResult<never> {
  return { ok: false, error: { code: 'INVALID_REQUEST', message } };
}

/** Rebuilds the analysis, draft and exact request from Jira and Confluence. */
async function rebuild(
  deps: PrepareRemediationDeps,
  input: PrepareRemediationRequest,
): Promise<ApiResult<Prepared>> {
  const site = await readTrustedSite(deps.jira);
  if (!site.ok) return site;

  const analysis = await analyzeChange(deps, { issueKey: input.changeKey });
  if (!analysis.ok) return analysis;
  const finding = analysis.data.findings.find((f) => f.id === input.findingId);
  if (!finding) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `A fresh analysis of ${input.changeKey} no longer reports finding ${input.findingId}.`,
      },
    };
  }

  let fix: DraftFix | undefined;
  if (input.fixId !== REVIEW_STEP_FIX_ID) {
    const generated = generateRehearsal({
      analysis: analysis.data,
      findingId: finding.id,
      restoreTargetMinutes: FIX_LOOKUP_RESTORE_MINUTES,
    });
    const action = generated.ok
      ? generated.rehearsal.scenario.remediation.find((r) => r.id === input.fixId)
      : undefined;
    if (!action) {
      return invalid(`Fix ${input.fixId} is not available for finding ${finding.id}.`);
    }
    fix = { id: action.id, title: action.title, description: action.description };
  }

  const built = buildWorkItemDraft(finding, analysis.data, undefined, {
    projectKey: input.projectKey,
    issueType: input.issueTypeName,
    issueTypes: FIXED_ISSUE_TYPES,
    ...(fix ? { fix } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    siteUrl: site.data,
  });
  if (!built.ok) return invalid(built.message);

  const request = buildCreateIssueRequest(built.draft, { siteUrl: site.data });
  if (!request.ok) return invalid(request.message);
  const source: ApprovalSource = {
    changeKey: input.changeKey,
    changeUpdated: analysis.data.change.updated ?? null,
    findingId: finding.id,
    fixId: input.fixId,
  };
  return {
    ok: true,
    data: { source, draft: built.draft, request: request.request, siteUrl: site.data },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Work items from a search response; null when the body is not a search result. */
export function mapExistingWorkItems(body: unknown): ExistingWorkItem[] | null {
  const issues = asRecord(body)?.issues;
  if (!Array.isArray(issues)) return null;
  const items: ExistingWorkItem[] = [];
  for (const raw of issues) {
    const issue = asRecord(raw);
    const key = issue?.key;
    if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) return null;
    const fields = asRecord(issue?.fields) ?? {};
    const labels = Array.isArray(fields.labels)
      ? fields.labels.filter((l): l is string => typeof l === 'string')
      : [];
    items.push({
      key,
      summary: typeof fields.summary === 'string' ? fields.summary : '',
      labels,
    });
  }
  return items;
}

/**
 * Duplicate search for the draft's idempotency label, as the user. A failed
 * search (403, 429, ...) is an error, never `none`: without it nothing may be
 * created.
 */
export async function searchDuplicates(
  gateway: RemediationJiraGateway,
  label: string,
): Promise<ApiResult<DuplicateCheck>> {
  const params = new URLSearchParams({
    jql: buildDuplicateJql(label),
    maxResults: String(DUPLICATE_SEARCH_MAX_RESULTS),
    fields: DUPLICATE_SEARCH_FIELDS,
  });
  const response = await gateway.searchIssues(params);
  if (!response.ok) {
    return { ok: false, error: errorFromStatus(response.status) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const items = mapExistingWorkItems(body);
  if (!items) {
    return {
      ok: false,
      error: {
        code: 'UNEXPECTED_RESPONSE',
        message: 'Jira returned a response ScenarioForge could not read.',
      },
    };
  }
  return { ok: true, data: decideDuplicate(label, items) };
}

export async function prepareRemediationRequest(
  deps: PrepareRemediationDeps,
  input: PrepareRemediationRequest,
): Promise<ApiResult<PrepareRemediationResponse>> {
  const now = deps.now ?? (() => new Date());
  const prepared = await rebuild(deps, input);
  if (!prepared.ok) return prepared;
  const { draft, request, siteUrl, source } = prepared.data;
  const duplicate = await searchDuplicates(deps.jira, draft.labels[1]!);
  if (!duplicate.ok) return duplicate;
  return {
    ok: true,
    data: {
      draft,
      request,
      draftHash: draftHash(draft),
      requestHash: requestHash(request),
      duplicate: duplicate.data,
      siteUrl,
      preparedAt: now().toISOString(),
      source,
    },
  };
}

/**
 * Re-verifies an approval against a request rebuilt now. `stale` when the
 * rebuilt request differs from the hash the person saw or from the approved
 * hash (for example the change or the runbook step text changed since).
 *
 * The approval record comes from the browser until approvals are stored
 * server-side (`storage:app`); this check proves the bytes still match, not
 * that the record was issued by ScenarioForge.
 */
export async function checkRemediationApproval(
  deps: PrepareRemediationDeps,
  input: CheckRemediationApprovalRequest,
  actorAccountId: string,
): Promise<ApiResult<CheckRemediationApprovalResponse>> {
  const now = deps.now ?? (() => new Date());
  const prepared = await rebuild(deps, input);
  if (!prepared.ok) return prepared;
  const { draft, request } = prepared.data;
  const duplicate = await searchDuplicates(deps.jira, draft.labels[1]!);
  if (!duplicate.ok) return duplicate;
  const fresh = requestHash(request);
  const approvalCheck = checkRequestApproval(request, input.approval, actorAccountId);
  const check = approvalCheck === 'valid' && input.requestHash !== fresh ? 'stale' : approvalCheck;
  return {
    ok: true,
    data: { check, requestHash: fresh, duplicate: duplicate.data, checkedAt: now().toISOString() },
  };
}
