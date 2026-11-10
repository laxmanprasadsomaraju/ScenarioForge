import { invoke } from '@forge/bridge';
import { bridgeCall, previewMode } from './preview';
import type {
  ApiResult,
  ConnectionStatus,
  GetRecoveryProcedureRequest,
  ListChangesRequest,
  ListChangesResponse,
  ListRecoveryPagesRequest,
  ListRecoveryPagesResponse,
  RecoveryProcedureExcerpt,
} from '@shared/api';
import type { AnalyzeChangeRequest, AnalyzeChangeResponse } from '@shared/analysis/types';
import type { GetReadinessGraphRequest, GetReadinessGraphResponse } from '@shared/graph/types';

/**
 * Typed wrappers around Forge resolver calls. A bridge failure (network,
 * missing consent, resolver crash) becomes an explicit error result; it is
 * never converted into empty or placeholder data.
 */
async function call<T>(functionKey: string, payload?: object): Promise<ApiResult<T>> {
  if (import.meta.env.DEV && previewMode) {
    const { previewCall } = await import('../dev/previewFixtures');
    return (await previewCall(functionKey, previewMode, payload)) as ApiResult<T>;
  }
  try {
    const result = await bridgeCall(() => invoke<ApiResult<T>>(functionKey, payload));
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      return {
        ok: false,
        error: {
          code: 'UNEXPECTED_RESPONSE',
          message: 'The ScenarioForge backend returned an unexpected response.',
        },
      };
    }
    return result;
  } catch {
    return {
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'Could not reach the ScenarioForge backend.' },
    };
  }
}

export const api = {
  getConnectionStatus: () => call<ConnectionStatus>('getConnectionStatus'),
  listRecentChanges: (request: ListChangesRequest) =>
    call<ListChangesResponse>('listRecentChanges', request),
  listRecoveryPages: (request: ListRecoveryPagesRequest) =>
    call<ListRecoveryPagesResponse>('listRecoveryPages', request),
  getRecoveryProcedure: (request: GetRecoveryProcedureRequest) =>
    call<RecoveryProcedureExcerpt>('getRecoveryProcedure', request),
  analyzeChange: (request: AnalyzeChangeRequest) =>
    call<AnalyzeChangeResponse>('analyzeChange', request),
  getReadinessGraph: (request: GetReadinessGraphRequest) =>
    call<GetReadinessGraphResponse>('getReadinessGraph', request),
};
