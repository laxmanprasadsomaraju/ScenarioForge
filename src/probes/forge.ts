import api, { route } from '@forge/api';
import { forgeKvsClient } from '../ai/forgeStorage';
import type { StorageProbeResult } from './storageProbe';
import { runStorageProbe } from './storageProbe';
import type { WhoamiProbeResult } from './whoamiProbe';
import { runWhoamiProbe } from './whoamiProbe';

/**
 * Forge entry points for the TEST-ONLY `identity-probe` agent's actions
 * (manifest functions `action-whoami-probe`, `action-storage-probe`).
 * `rovo-test` build only. Forge passes `(payload, context)` to an action
 * function (https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/).
 *
 * Jira is called with `api.asUser()` only. There is deliberately no
 * app-identity fallback.
 */

const log = (line: string): void => console.log(line);

export function whoamiProbe(payload: unknown, context: unknown): Promise<WhoamiProbeResult> {
  return runWhoamiProbe(
    {
      requestMyself: () => api.asUser().requestJira(route`/rest/api/3/myself`),
      log,
    },
    payload,
    context,
  );
}

export function storageProbe(): Promise<StorageProbeResult> {
  return runStorageProbe({
    env: process.env,
    clientFor: forgeKvsClient,
    now: () => new Date(),
    newId: () => globalThis.crypto.randomUUID(),
    log,
  });
}
