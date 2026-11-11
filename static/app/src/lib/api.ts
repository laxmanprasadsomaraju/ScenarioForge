import { invoke } from '@forge/bridge';
import { bridgeCall, previewMode } from './preview';
import type {
  ApiResult,
  ConnectionStatus,
  GetRecoveryProcedureRequest,
  GetRehearsalRunRequest,
  GetRehearsalRunResponse,
  GetRetestComparisonRequest,
  GetRetestComparisonResponse,
  ListRehearsalHistoryResponse,
  SaveRehearsalResponse,
  SaveRehearsalRunRequest,
  PrepareRemediationRequest,
  PrepareRemediationResponse,
  CreateRemediationWorkItemRequest,
  CreateRemediationWorkItemResponse,
  SaveRetestRequest,
  ListChangesRequest,
  ListChangesResponse,
  ListRecoveryPagesRequest,
  ListRecoveryPagesResponse,
  RecoveryProcedureExcerpt,
} from '@shared/api';
import type { AnalyzeChangeRequest, AnalyzeChangeResponse } from '@shared/analysis/types';
import type {
  CrisisCommandRequest,
  CrisisCreateRoomRequest,
  CrisisGate,
  CrisisInviteRequest,
  CrisisInviteResponse,
  CrisisRoomResponse,
  CrisisSaveRequest,
  CrisisViewRequest,
  CrisisViewResponse,
} from '@shared/crisis/api';
import type { GetReadinessGraphRequest, GetReadinessGraphResponse } from '@shared/graph/types';

/**
 * Typed wrappers around Forge resolver calls. A bridge failure (network,
 * missing consent, resolver crash) becomes an explicit error result; it is
 * never converted into empty or placeholder data.
 */
async function call<T>(functionKey: string, payload?: object): Promise<ApiResult<T>> {
  if (import.meta.env.DEV && previewMode) {
    if (functionKey.startsWith('crisis')) {
      // Dev only: the real crisis resolvers over in-memory storage.
      const { crisisPreviewCall } = await import('../dev/crisisPreview');
      return (await crisisPreviewCall(functionKey, previewMode, payload)) as ApiResult<T>;
    }
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
  // Rehearsal history. No accountId is ever sent: the server uses the Forge context.
  listRehearsalHistory: () => call<ListRehearsalHistoryResponse>('listRehearsalHistory'),
  getRehearsalRun: (request: GetRehearsalRunRequest) =>
    call<GetRehearsalRunResponse>('getRehearsalRun', request),
  getRetestComparison: (request: GetRetestComparisonRequest) =>
    call<GetRetestComparisonResponse>('getRetestComparison', request),
  saveRehearsalRun: (request: SaveRehearsalRunRequest) =>
    call<SaveRehearsalResponse>('saveRehearsalRun', request),
  saveRetest: (request: SaveRetestRequest) => call<SaveRehearsalResponse>('saveRetest', request),
  // Remediation (M8). The server rebuilds the draft and request; the browser copy is never trusted.
  prepareRemediationRequest: (request: PrepareRemediationRequest) =>
    call<PrepareRemediationResponse>('prepareRemediationRequest', request),
  createRemediationWorkItem: (request: CreateRemediationWorkItemRequest) =>
    call<CreateRemediationWorkItemResponse>('createRemediationWorkItem', request),
  // Crisis room. Identity, ids, tokens and clocks are all server-side.
  crisisStatus: () => call<{ status: 'AVAILABLE' } | CrisisGate>('crisisStatus'),
  crisisOpenRoom: (request: CrisisCreateRoomRequest) =>
    call<CrisisRoomResponse>('crisisOpenRoom', request),
  crisisView: (request: CrisisViewRequest) => call<CrisisViewResponse>('crisisView', request),
  crisisCommand: (request: CrisisCommandRequest) =>
    call<CrisisRoomResponse>('crisisCommand', request),
  crisisInviteToken: (request: CrisisInviteRequest) =>
    call<CrisisInviteResponse>('crisisInviteToken', request),
  crisisSaveDebrief: (request: CrisisSaveRequest) =>
    call<SaveRehearsalResponse>('crisisSaveDebrief', request),
};
