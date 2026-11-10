import { canonicalJson } from '../simulation/replay';
import { descriptionToAdf, isUrlOnOrigin, SITE_ORIGIN_PATTERN, type AdfDoc } from './adf';
import { validateDraft } from './draft';
import { sha256Hex } from './sha256';
import { FIXED_ISSUE_TYPES, type WorkItemDraft } from './types';

/**
 * The exact Jira requests a draft would become, and their fingerprint.
 *
 * Nothing here sends anything. The bodies are checked against the Jira
 * platform REST v3 OpenAPI spec
 * (https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json,
 * read 2026-11-10; all three need `write:jira-work`, which is not granted):
 * - `POST /rest/api/3/issue` (createIssue), body `IssueUpdateDetails`:
 *   `fields.project`, `fields.issuetype`, `fields.summary`,
 *   `fields.description` (ADF), `fields.labels` (array of strings).
 * - `POST /rest/api/3/issueLink` (linkIssues), body `LinkIssueRequestJsonBean`:
 *   required `type` (`IssueLinkType`, `name` or `id`), `inwardIssue` and
 *   `outwardIssue` (`LinkedIssue`, `key` or `id`); no other properties allowed.
 * - `POST /rest/api/3/issue/{issueIdOrKey}/remotelink`
 *   (createOrUpdateRemoteIssueLink), body `RemoteIssueLinkRequest`: required
 *   `object` (`RemoteObject`, required `title` and `url`), optional `globalId`
 *   (max 255; an existing link with the same globalId is updated, not added).
 *
 * The two follow-up calls need the key of the created work item, which only
 * exists after the create. They carry `CREATED_ISSUE_KEY` in its place; the
 * fingerprint covers the template, and `resolveFollowUpRequests` fills in the
 * key Jira returned (checked to be in the draft's project) without changing
 * anything else.
 */

/** Stands for the created work item's key in the follow-up requests. */
export const CREATED_ISSUE_KEY = '{createdIssueKey}';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]*$/;
/** Jira ids are numeric strings. */
const ISSUE_TYPE_ID_PATTERN = /^[1-9][0-9]{0,17}$/;
const MAX_GLOBAL_ID_LENGTH = 255;

export interface CreateIssueBody {
  fields: {
    project: { key: string };
    /** `{ id }` once read from createmeta; `{ name }` until then. */
    issuetype: { id: string } | { name: string };
    summary: string;
    description: AdfDoc;
    labels: string[];
  };
}

export interface IssueLinkBody {
  type: { name: 'Relates' };
  /** The change. */
  inwardIssue: { key: string };
  /** The new work item (the "from" issue, in the project the user creates in). */
  outwardIssue: { key: string };
}

export interface RemoteLinkBody {
  globalId: string;
  object: { url: string; title: string };
}

export interface JiraWriteCall<Body> {
  method: 'POST';
  path: string;
  body: Body;
}

/** Every call that creating the work item would make, in order. */
export interface RemediationRequest {
  schemaVersion: 1;
  createIssue: JiraWriteCall<CreateIssueBody>;
  issueLink: JiraWriteCall<IssueLinkBody>;
  /** Null when the draft has no runbook page link. */
  remoteLink: JiraWriteCall<RemoteLinkBody> | null;
}

export interface RequestContext {
  /** Trusted site origin, from the server (never the browser). */
  siteUrl: string;
  /** Issue type id from createmeta; when absent the draft's issue type name is sent. */
  issueTypeId?: string;
}

export type BuildRequestResult =
  { ok: true; request: RemediationRequest } | { ok: false; message: string };

/** SHA-256 over the canonical JSON of every call (method, path and body) as it would be sent. */
export function requestHash(request: RemediationRequest): string {
  return sha256Hex(canonicalJson(request));
}

/**
 * Builds the exact requests for a valid draft. Refuses a draft whose links are
 * not absolute https URLs on `context.siteUrl`, or whose change link is not
 * that site's browse URL for the change.
 */
export function buildCreateIssueRequest(
  draft: WorkItemDraft,
  context: RequestContext,
  issueTypes: readonly string[] = FIXED_ISSUE_TYPES,
): BuildRequestResult {
  const problems = validateDraft(draft, issueTypes);
  if (problems.length > 0) {
    return { ok: false, message: problems[0]!.message };
  }
  const site = context.siteUrl;
  if (!SITE_ORIGIN_PATTERN.test(site)) {
    return { ok: false, message: 'The site address is not a plain https address.' };
  }
  if (context.issueTypeId !== undefined && !ISSUE_TYPE_ID_PATTERN.test(context.issueTypeId)) {
    return { ok: false, message: 'The issue type id is not a Jira id.' };
  }
  const { issueLink, remoteLink } = draft.links;
  if (issueLink.url !== `${site}/browse/${issueLink.issueKey}`) {
    return { ok: false, message: `The link to ${issueLink.issueKey} is not on ${site}.` };
  }
  if (
    remoteLink &&
    (!isUrlOnOrigin(remoteLink.url, site) || !remoteLink.url.startsWith(`${site}/wiki/`))
  ) {
    return { ok: false, message: `The link to the runbook page is not on ${site}.` };
  }
  if (
    remoteLink &&
    (remoteLink.globalId.length > MAX_GLOBAL_ID_LENGTH || remoteLink.title.trim() === '')
  ) {
    return { ok: false, message: 'The runbook page link cannot be sent as it is.' };
  }

  const request: RemediationRequest = {
    schemaVersion: 1,
    createIssue: {
      method: 'POST',
      path: '/rest/api/3/issue',
      body: {
        fields: {
          project: { key: draft.projectKey },
          issuetype:
            context.issueTypeId !== undefined
              ? { id: context.issueTypeId }
              : { name: draft.issueType },
          summary: draft.summary,
          description: descriptionToAdf(draft.description, site),
          labels: [...draft.labels],
        },
      },
    },
    issueLink: {
      method: 'POST',
      path: '/rest/api/3/issueLink',
      body: {
        type: { name: issueLink.type },
        inwardIssue: { key: issueLink.issueKey },
        outwardIssue: { key: CREATED_ISSUE_KEY },
      },
    },
    remoteLink: remoteLink
      ? {
          method: 'POST',
          path: `/rest/api/3/issue/${CREATED_ISSUE_KEY}/remotelink`,
          body: {
            globalId: remoteLink.globalId,
            object: { url: remoteLink.url, title: remoteLink.title },
          },
        }
      : null,
  };
  return { ok: true, request };
}

/**
 * The follow-up calls with the created work item's key filled in. Refuses a
 * key that is not a work item key in the project the request creates in.
 */
export function resolveFollowUpRequests(
  request: RemediationRequest,
  createdIssueKey: string,
):
  | {
      ok: true;
      issueLink: JiraWriteCall<IssueLinkBody>;
      remoteLink: JiraWriteCall<RemoteLinkBody> | null;
    }
  | { ok: false; message: string } {
  const projectKey = request.createIssue.body.fields.project.key;
  if (!ISSUE_KEY_PATTERN.test(createdIssueKey) || !createdIssueKey.startsWith(`${projectKey}-`)) {
    return { ok: false, message: `${createdIssueKey} is not a work item key in ${projectKey}.` };
  }
  const issueLink = structuredClone(request.issueLink);
  issueLink.body.outwardIssue.key = createdIssueKey;
  const remoteLink = request.remoteLink ? structuredClone(request.remoteLink) : null;
  if (remoteLink) {
    remoteLink.path = `/rest/api/3/issue/${createdIssueKey}/remotelink`;
  }
  return { ok: true, issueLink, remoteLink };
}
