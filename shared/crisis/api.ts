import type { RehearsalSourceRef } from '../api';
import type {
  CommunicationKind,
  CrisisDebrief,
  CrisisRejectReason,
  CrisisRole,
  RoleView,
  TimelineEntry,
} from './types';

/**
 * Resolver contract for the Crisis Room (docs/M7_PLAN.md §2). The browser
 * never sends an account id, a scenario, a timestamp, an invite id or a
 * proposal id: identity comes from the Forge context and every id and secret
 * is generated on the server.
 */

/** Shown wherever team rooms are not possible because storage is not granted. */
export const CRISIS_NOT_ENABLED =
  'Team rooms need storage that is not enabled in this environment.';

/** Polling interval while a room is open. There is no realtime channel. */
export const CRISIS_POLL_MS = 4000;

/** Room id: server-generated, base64url. */
export const CRISIS_ROOM_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** Invite token: server-generated, base64url, 32 random bytes. */
export const CRISIS_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export type CrisisGate =
  { status: 'UNAVAILABLE'; detail: string } | { status: 'IDENTITY_UNAVAILABLE'; detail: string };

export type CrisisReject = CrisisRejectReason | 'ROOM_INVALID' | 'SCENARIO_UNAVAILABLE';

export interface CrisisRejected {
  status: 'REJECTED';
  reason: CrisisReject;
  message: string;
  /** Room version when the call was refused, when known. */
  version: number | null;
}

export interface CrisisInviteSummary {
  inviteId: string;
  role: CrisisRole;
  expiresAt: string;
  state: 'open' | 'used' | 'revoked' | 'expired';
}

/** Everything one participant may see of a room at one version. */
export interface CrisisRoomSnapshot {
  view: RoleView;
  scenarioTitle: string;
  /** True when the scenario is the authored demo (synthetic data). */
  synthetic: boolean;
  isOwner: boolean;
  expiresAt: string;
  timeline: TimelineEntry[];
  /** Owner only; never includes token hashes. */
  invites: CrisisInviteSummary[];
  /** Present once the session has completed. */
  debrief: CrisisDebrief | null;
}

export type CrisisRoomResponse =
  { status: 'OK'; room: CrisisRoomSnapshot } | CrisisRejected | CrisisGate;

export type CrisisViewResponse = CrisisRoomResponse | { status: 'UNCHANGED'; version: number };

export type CrisisInviteResponse =
  | {
      status: 'OK';
      room: CrisisRoomSnapshot;
      /** The token is returned once, here, and never stored or logged. */
      invite: { inviteId: string; role: CrisisRole; expiresAt: string; token: string };
    }
  | CrisisRejected
  | CrisisGate;

export interface CrisisCreateRoomRequest {
  source: RehearsalSourceRef;
}

export interface CrisisViewRequest {
  roomId: string;
  /** When equal to the stored version the answer is UNCHANGED. */
  knownVersion?: number;
}

export interface CrisisInviteRequest {
  roomId: string;
  expectedVersion: number;
  role: CrisisRole;
}

/** Commands the browser may send. Ids, tokens for new invites and clocks are server-side. */
export type CrisisClientCommand =
  | { type: 'join'; token: string }
  | { type: 'revoke-invite'; inviteId: string }
  | { type: 'leave' }
  | { type: 'assign-role'; accountId: string; role: CrisisRole }
  | { type: 'hand-off-command'; to: string }
  | { type: 'start' }
  | { type: 'propose'; decisionId: string; rationale: string }
  | { type: 'commit-decision'; decisionId: string; proposalId?: string }
  | { type: 'communicate'; kind: CommunicationKind; text: string }
  | { type: 'close' };

export interface CrisisCommandRequest {
  roomId: string;
  /** Ignored for `join` (a joiner has not seen the room yet). */
  expectedVersion: number;
  command: CrisisClientCommand;
}

export interface CrisisSaveRequest {
  roomId: string;
}

export const CRISIS_REJECT_TEXT: Record<CrisisReject, string> = {
  STALE_VERSION: 'Someone else changed the room first. It has been refreshed; check and try again.',
  FORBIDDEN: 'Your role cannot do this.',
  NOT_PARTICIPANT: 'This room does not exist or you are not in it.',
  INVALID_INPUT: 'That request was not valid.',
  INVALID_STATE: 'That is not possible in the room’s current state.',
  ROOM_EXPIRED: 'This room has expired.',
  ROOM_CLOSED: 'This room is closed.',
  INVITE_INVALID: 'This invite is not valid. Ask the room owner for a new one.',
  LOG_FULL: 'This room has reached its event limit; close it and start a new one.',
  ROOM_FULL: 'This room is full.',
  ROOM_INVALID: 'This room’s record failed its integrity check and cannot be shown.',
  SCENARIO_UNAVAILABLE: 'The rehearsal for this room could not be built.',
};
