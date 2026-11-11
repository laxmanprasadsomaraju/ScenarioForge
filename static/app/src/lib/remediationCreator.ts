import type { ApiResult } from '@shared/api';
import { api } from './api';
import type {
  DuplicateChecker,
  RemediationCreator,
} from '../components/simulation/RemediationPreview';

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
 * Creator for one finding. The server rebuilds the draft and the exact Jira
 * request; the browser checks the server's draft is the one the person
 * approved on screen (draft hash), then asks the server to issue an approval
 * for the request hash the person saw, then creates with the returned approval
 * id. The browser sends no approver, time, age or approval record: the server
 * derives the approver from the invocation, stamps the time with its own
 * clock, and re-checks everything on create.
 */
export function makeRemediationCreator(opts: {
  changeKey: string;
  findingId: string;
}): RemediationCreator {
  return async (draft, approval, { fixId }) => {
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
    const approved = await api.approveRemediationRequest({
      ...base,
      requestHash: prepared.data.requestHash,
    });
    if (!approved.ok) return approved;
    return api.createRemediationWorkItem({ ...base, approvalId: approved.data.approvalId });
  };
}

/** Read-only duplicate search: the server rebuilds the draft and searches by label (GETs only). */
export function makeDuplicateChecker(opts: {
  changeKey: string;
  findingId: string;
}): DuplicateChecker {
  return async (draft, { fixId }) => {
    const prepared = await api.prepareRemediationRequest({
      changeKey: opts.changeKey,
      findingId: opts.findingId,
      fixId,
      projectKey: draft.projectKey,
      issueTypeName: draft.issueType,
      summary: draft.summary,
    });
    return prepared.ok ? { ok: true, data: prepared.data.duplicate } : prepared;
  };
}
