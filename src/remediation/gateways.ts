import type { StorageAdapter } from '../../shared/agents/storage';
import type { JiraWriteGateway } from './create';

/**
 * Production wiring for the M8 create path. Both factories return null in
 * every build: `write:jira-work` is not granted (no write gateway exists) and
 * `storage:app` is not granted (no approval store). With either missing,
 * `createRemediationWorkItem` refuses before any call; with no writer it
 * answers WRITE_NOT_PERMITTED before reading anything.
 *
 * Enabling either needs the owner's approval in their own words
 * (docs/M8_PLAN.md §11). A test asserts both stay null.
 */
export function productionRemediationWriter(): JiraWriteGateway | null {
  return null;
}

export function productionRemediationStorage(): StorageAdapter | null {
  return null;
}
