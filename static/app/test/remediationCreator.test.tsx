import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeChange } from '@shared/analysis';
import type { ChangeEvidence, RunbookEvidence } from '@shared/analysis/types';
import {
  approveDraft,
  buildCreateIssueRequest,
  buildWorkItemDraft,
  draftHash,
  FIXED_ISSUE_TYPES,
  requestHash,
} from '@shared/remediation';
import { api } from '../src/lib/api';
import { makeRemediationCreator, remediationCreateUiEnabled } from '../src/lib/remediationCreator';

vi.mock('../src/lib/api', () => ({
  api: { prepareRemediationRequest: vi.fn(), createRemediationWorkItem: vi.fn() },
}));

const SITE = 'https://example.atlassian.net';
const ME = '557058:test-approver';
const AT = '2026-11-10T09:00:00.000Z';
const STEP = 'If the primary IdP is unavailable, run `authctl failover --target legacyauth`.';
const change: ChangeEvidence = {
  origin: 'live',
  key: 'MC-62',
  summary: 'Retire LegacyAuth backup SSO tenant',
  descriptionText: 'We will decommission the LegacyAuth tenant on 30 November.',
  status: 'To Do',
  issueType: 'Change',
  updated: AT,
  browsePath: '/browse/MC-62',
  remoteLinks: [],
  retrievedAt: AT,
};
const page: RunbookEvidence = {
  origin: 'live',
  pageId: '98305',
  title: 'RB-AUTH-01',
  webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
  lastUpdated: AT,
  steps: [{ order: 1, instruction: STEP, dependsOn: [] }],
  stepSource: 'ordered-list',
  text: ['Related change: MC-62', STEP].join('\n'),
  retrievedAt: AT,
};
const analysis = analyzeChange(change, [page], AT);
const finding = analysis.findings[0]!;
const built = buildWorkItemDraft(finding, analysis, undefined, {
  projectKey: 'OPS',
  issueType: 'Task',
  issueTypes: FIXED_ISSUE_TYPES,
  siteUrl: SITE,
});
if (!built.ok) throw new Error(built.message);
const draft = built.draft;
const req = buildCreateIssueRequest(draft, { siteUrl: SITE }, FIXED_ISSUE_TYPES);
if (!req.ok) throw new Error(req.message);
const prepared = {
  draft,
  request: req.request,
  draftHash: draftHash(draft),
  requestHash: requestHash(req.request),
  duplicate: { decision: 'none' as const },
  siteUrl: SITE,
  preparedAt: AT,
};
const approval = approveDraft(draft, ME, AT, FIXED_ISSUE_TYPES);
const creator = () =>
  makeRemediationCreator({
    changeKey: 'MC-62',
    findingId: finding.id,
    accountId: ME,
    now: () => new Date(AT),
  });

beforeEach(() => vi.clearAllMocks());

describe('remediation creator (browser to server)', () => {
  it('is off unless the build flag says enabled', () => {
    expect(remediationCreateUiEnabled()).toBe(false);
  });

  it('prepares on the server, binds the approval to the request hash, then creates once', async () => {
    vi.mocked(api.prepareRemediationRequest).mockResolvedValue({
      ok: true,
      data: prepared as never,
    });
    vi.mocked(api.createRemediationWorkItem).mockResolvedValue({
      ok: false,
      error: { code: 'WRITE_NOT_PERMITTED', message: 'Nothing was sent to Jira.' },
    });
    const result = await creator()(draft, approval, { fixId: 'rem-step' });
    expect(result).toMatchObject({ ok: false, error: { code: 'WRITE_NOT_PERMITTED' } });
    expect(api.prepareRemediationRequest).toHaveBeenCalledTimes(1);
    expect(api.createRemediationWorkItem).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(api.createRemediationWorkItem).mock.calls[0]![0];
    expect(sent.requestHash).toBe(prepared.requestHash);
    expect(sent.approval.requestHash).toBe(prepared.requestHash);
    expect(sent.approval.draftHash).toBe(approval.draftHash);
    expect(sent.approval.approverAccountId).toBe(ME);
    expect(sent).not.toHaveProperty('siteUrl');
  });

  it('refuses without calling create when the server draft differs from the approved one', async () => {
    vi.mocked(api.prepareRemediationRequest).mockResolvedValue({
      ok: true,
      data: { ...prepared, draftHash: 'f'.repeat(64) } as never,
    });
    const result = await creator()(draft, approval, { fixId: 'rem-step' });
    expect(result).toMatchObject({ ok: false, error: { code: 'APPROVAL_INVALID' } });
    expect(api.createRemediationWorkItem).not.toHaveBeenCalled();
  });

  it('does not create when prepare fails or the account is unknown', async () => {
    vi.mocked(api.prepareRemediationRequest).mockResolvedValue({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'down' },
    });
    expect(await creator()(draft, approval, { fixId: 'rem-step' })).toMatchObject({ ok: false });
    const anon = makeRemediationCreator({
      changeKey: 'MC-62',
      findingId: finding.id,
      accountId: null,
    });
    expect(await anon(draft, approval, { fixId: 'rem-step' })).toMatchObject({ ok: false });
    expect(api.createRemediationWorkItem).not.toHaveBeenCalled();
  });
});
