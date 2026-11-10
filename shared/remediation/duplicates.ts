import { IDEMPOTENCY_LABEL_PATTERN } from './draft';
import { REMEDIATION_LABEL, type DuplicateCheck, type ExistingWorkItem } from './types';

/**
 * Duplicate prevention without any API call. The search itself
 * (`GET /rest/api/3/search/jql` asUser, `read:jira-work`) is made later by the
 * server; this module only builds its JQL and decides from its results.
 */

/** Quotes a value for JQL: backslashes and double quotes escaped, line breaks refused. */
export function jqlString(value: string): string {
  if (/[\r\n]/.test(value) || value.includes(String.fromCharCode(0))) {
    throw new Error('JQL values cannot contain line breaks or NUL characters.');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * JQL for the duplicate search. Only an idempotency label of the exact shape
 * this app produces is accepted, so no user text ever reaches the query.
 */
export function buildDuplicateJql(label: string): string {
  if (!IDEMPOTENCY_LABEL_PATTERN.test(label)) {
    throw new Error('Not a ScenarioForge idempotency label.');
  }
  return `labels = ${jqlString(label)} ORDER BY created ASC`;
}

/**
 * Decides from the search results:
 * - `none`: nothing carries the label; creating is allowed.
 * - `duplicate`: exactly one work item carries both the label and
 *   `scenarioforge-remediation`; adopt its key instead of creating.
 * - `ambiguous`: anything else (several matches, a match without the fixed
 *   label, or results that do not carry the exact label). A person decides.
 */
export function decideDuplicate(
  label: string,
  existing: readonly ExistingWorkItem[],
): DuplicateCheck {
  const matches = existing.map((item) => item.key);
  const exact = existing.filter((item) => item.labels.includes(label));
  if (existing.length === 0) {
    return { decision: 'none', label, matches, reason: 'No work item has this label.' };
  }
  if (exact.length !== existing.length) {
    return {
      decision: 'ambiguous',
      label,
      matches,
      reason: 'The search returned work items without the exact label.',
    };
  }
  if (exact.length > 1) {
    return {
      decision: 'ambiguous',
      label,
      matches,
      reason: `${exact.length} work items have this label.`,
    };
  }
  const only = exact[0]!;
  if (!only.labels.includes(REMEDIATION_LABEL)) {
    return {
      decision: 'ambiguous',
      label,
      matches,
      reason: `${only.key} has the label but not ${REMEDIATION_LABEL}.`,
    };
  }
  return {
    decision: 'duplicate',
    label,
    issueKey: only.key,
    matches,
    reason: `${only.key} already exists for this fix.`,
  };
}
