import type { StorageAdapter } from '../../shared/agents/storage';
import {
  REMEDIATION_WRITE_FLAG,
  remediationStorage,
  remediationWriteEnabled,
  type PlatformOptions,
} from '../platform/storageFactory';
import type { JiraWriteGateway } from './create';
import { forgeWriteTransport } from './forgeWrite';
import { createJiraWriteGateway, type WriteTransport } from './writeGateway';

/**
 * Production wiring for the M8 create path.
 *
 * Writes are hard-disabled in every deployed build, twice over:
 * 1. Both factories return null unless the server-side Forge variable
 *    `SF_REMEDIATION_WRITE` is exactly `enabled` (off by default) AND the
 *    store also has `SF_STORAGE=enabled`. With either missing the resolver
 *    answers WRITE_NOT_PERMITTED before reading anything.
 * 2. manifest.yml has no `write:jira-work` scope, so even a mis-set flag
 *    cannot write: Jira refuses the call. A test asserts the manifest.
 *
 * Real Jira writes wait for a separately approved `write-test` environment
 * (docs/M8_PLAN.md section 11).
 */
export { REMEDIATION_WRITE_FLAG };

export interface RemediationGatewayOptions extends PlatformOptions {
  transport?: WriteTransport;
  timeoutMs?: number;
}

export function productionRemediationWriter(
  options?: RemediationGatewayOptions,
): JiraWriteGateway | null {
  if (!remediationWriteEnabled(options?.env ?? process.env)) return null;
  return createJiraWriteGateway({
    transport: options?.transport ?? forgeWriteTransport,
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}

export function productionRemediationStorage(
  options?: RemediationGatewayOptions,
): StorageAdapter | null {
  return remediationStorage(options);
}

/** Writer and store together: both or neither, so a half-wired build stays disabled. */
export function remediationCreateWiring(options?: RemediationGatewayOptions): {
  writer: JiraWriteGateway | null;
  storage: StorageAdapter | null;
} {
  const writer = productionRemediationWriter(options);
  const storage = productionRemediationStorage(options);
  return writer && storage ? { writer, storage } : { writer: null, storage: null };
}
