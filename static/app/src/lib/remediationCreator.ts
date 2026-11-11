import type { ApiResult } from '@shared/api';
import { approveRequest, FIXED_ISSUE_TYPES } from '@shared/remediation';
import { api } from './api';
import type { RemediationCreator } from '../components/simulation/RemediationPreview';

/**
 * Build-time switch for the create button. Off unless the build sets
 * VITE_SF_REMEDIATION_CREATE=enabled. Even when on, the backend refuses
 * (WRITE_NOT_PERMITTED) while no write gateway exists, so the flag only
 * decides whether the browser may ask.
 */
export function remediationCreateUiEnabled(): boolean {
  return (import.meta.env as Record<string, unknown>).VITE_SF_REMEDIATION_CREATE === 'enabled';
}

const refuse = (message: string): ApiResult<never> => ({
  ok: false,
  error: { code: 'APPROVAL_INVALID', message },
});

/**
 * Creator for one finding: the server rebuilds the draft and the exact Jira
 * request; the browser checks the server's draft is the one the person
 * approved (SHA-256 draft hash), binds the approval to the server's request
 * hash, then asks the server to create. The server re-checks everything.
 */
export function makeRemediationCreator(opts: {
  changeKey: string;
  findingId: string;
  accountId: string | null;
  now?: () => Date;
}): RemediationCreator {
  return async (draft, approval, { fixId }) => {
    if (!opts.accountId) return refuse('Your Atlassian account is not known.');
    const base = {
      changeKey: opts.changeKey,
      findingId: opts.findingId,
      fixId,
      projectKey: draft.projectKey,
      issueTypeName: draft.issueType,
      summary: draft.summary,
    };
    const prepared = await api.prepareRemediationRequest(base);
    if (!prepared.ok) return prepared;
    if (prepared.data.draftHash !== approval.draftHash) {
      return refuse(
        'The draft rebuilt by the server differs from the one you approved. Review and approve it again.',
      );
    }
    let bound;
    try {
      bound = approveRequest(
        prepared.data.draft,
        { siteUrl: prepared.data.siteUrl },
        opts.accountId,
        (opts.now ?? (() => new Date()))().toISOString(),
        FIXED_ISSUE_TYPES,
      );
    } catch (error) {
      return refuse(error instanceof Error ? error.message : 'The draft cannot be approved.');
    }
    if (bound.requestHash !== prepared.data.requestHash) {
      return refuse('The request changed while preparing. Approve it again.');
    }
    return api.createRemediationWorkItem({
      ...base,
      requestHash: prepared.data.requestHash,
      approval: bound,
    });
  };
}
