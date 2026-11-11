import type { JiraWriteCall } from '../../shared/remediation';
import type { JiraResponse } from '../jira/client';
import type { JiraWriteGateway } from './create';

/**
 * M8 write gateway: exactly three Jira calls, as the user, POST only.
 *
 *   POST /rest/api/3/issue
 *   POST /rest/api/3/issueLink
 *   POST /rest/api/3/issue/{key}/remotelink
 *
 * The transport is injected so this file has no Forge import and tests never
 * touch a network. The Forge transport lives in forgeWrite.ts and uses
 * `asUser()` only. Anything else (other method, other path) throws before a
 * request is made.
 *
 * Responses are parsed strictly: an unexpected success status is not treated
 * as success. For the create that means a throw (the outcome is unknown and
 * is resolved by label adoption, never a second create); for links it means a
 * failed link, recorded and visible.
 */

export const DEFAULT_WRITE_TIMEOUT_MS = 10_000;

export interface WriteTransportInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

/** Sends one request as the user. Path is already validated by the gateway. */
export type WriteTransport = (path: string, init: WriteTransportInit) => Promise<JiraResponse>;

const ISSUE_KEY = '[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]*';
const REMOTE_LINK_PATH = new RegExp(`^/rest/api/3/issue/(${ISSUE_KEY})/remotelink$`);

export type WriteKind = 'create-issue' | 'issue-link' | 'remote-link';

/** The only calls the gateway will send; null for anything else. */
export function classifyWrite(call: { method: string; path: string }): WriteKind | null {
  if (call.method !== 'POST') return null;
  if (call.path === '/rest/api/3/issue') return 'create-issue';
  if (call.path === '/rest/api/3/issueLink') return 'issue-link';
  return REMOTE_LINK_PATH.test(call.path) ? 'remote-link' : null;
}

const EXPECTED: Record<WriteKind, number[]> = {
  'create-issue': [201],
  'issue-link': [201],
  'remote-link': [200, 201],
};

export interface WriteGatewayOptions {
  transport: WriteTransport;
  timeoutMs?: number;
}

export function createJiraWriteGateway(options: WriteGatewayOptions): JiraWriteGateway {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  return {
    async send(call: JiraWriteCall<unknown>): Promise<JiraResponse> {
      const kind = classifyWrite(call);
      if (!kind) throw new Error('Write call is not one of the three permitted calls.');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Jira write timed out.'));
        }, timeoutMs);
      });
      try {
        const response = await Promise.race([
          options.transport(call.path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(call.body),
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (!response.ok) return response;
        if (!EXPECTED[kind].includes(response.status)) {
          if (kind === 'create-issue') throw new Error('Unexpected success status for create.');
          return { ok: false, status: 502, json: async () => ({}) };
        }
        return response;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
