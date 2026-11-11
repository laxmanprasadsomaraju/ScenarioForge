import type {
  DecisionRecord,
  EvidenceReference,
  ExerciseEvaluation,
  ExerciseSession,
  IsoDateTime,
  SimulationScenario,
} from '../domain/types';
import type { ObjectiveProgress } from '../simulation/engine';
import type { SessionAuditRecord } from '../simulation/types';
import type { RunSubmission } from '../history/types';

/**
 * M7 collaborative Crisis Room (docs/M7_PLAN.md).
 *
 * A room is an append-only event log. Every state is derived by folding the
 * log from the first event, so a reconnecting client (or the server after a
 * read) rebuilds exactly the same room. The engine is pure: no clock reads,
 * no randomness. The caller supplies `at` timestamps (server clock) and the
 * random invite secret, and the actor id always comes from the Forge
 * invocation context, never from the browser.
 */

export type CrisisRole =
  | 'incident-commander'
  | 'engineering-responder'
  | 'security-responder'
  | 'communications-lead'
  | 'observer';

export type RoomStatus = 'lobby' | 'running' | 'debrief' | 'closed';

export type CommunicationKind = 'status-update' | 'stakeholder-notice';

interface EventBase {
  /** 1-based position in the log; equals the room version after this event. */
  seq: number;
  /** Server clock when the event was appended. */
  at: IsoDateTime;
  /** accountId of the caller (from the Forge context). */
  actor: string;
}

export type CrisisEvent = EventBase &
  (
    | {
        type: 'room-created';
        roomId: string;
        scenario: SimulationScenario;
        scenarioFingerprint: string;
        expiresAt: IsoDateTime;
      }
    | {
        type: 'invite-issued';
        inviteId: string;
        /** SHA-256 of the token. The token itself is never stored or logged. */
        tokenHash: string;
        role: CrisisRole;
        expiresAt: IsoDateTime;
      }
    | { type: 'invite-revoked'; inviteId: string }
    | { type: 'participant-joined'; inviteId: string; role: CrisisRole }
    | { type: 'participant-left' }
    | { type: 'role-assigned'; accountId: string; role: CrisisRole }
    | { type: 'command-handed-off'; to: string }
    | { type: 'session-started' }
    | {
        type: 'proposal-made';
        proposalId: string;
        stepId: string;
        decisionId: string;
        rationale: string;
      }
    | {
        type: 'decision-committed';
        stepId: string;
        decisionId: string;
        /** The proposal the commander adopted, if any. */
        proposalId: string | null;
      }
    | { type: 'communication-posted'; kind: CommunicationKind; text: string }
    | { type: 'room-closed' }
  );

export type CrisisEventType = CrisisEvent['type'];

/** An event before the engine assigns `seq`, `at` and `actor`. */
export type CrisisEventBody = CrisisEvent extends infer E
  ? E extends CrisisEvent
    ? Omit<E, 'seq' | 'at' | 'actor'>
    : never
  : never;

export interface Participant {
  accountId: string;
  role: CrisisRole;
  joinedAt: IsoDateTime;
  /** False after `participant-left`; a left participant may rejoin with a new invite. */
  active: boolean;
}

export interface InviteState {
  inviteId: string;
  tokenHash: string;
  role: CrisisRole;
  expiresAt: IsoDateTime;
  issuedBy: string;
  usedBy: string | null;
  revoked: boolean;
}

export interface Proposal {
  proposalId: string;
  proposer: string;
  proposerRole: CrisisRole;
  stepId: string;
  decisionId: string;
  rationale: string;
  at: IsoDateTime;
  /** `superseded` once the session has moved past its step without adopting it. */
  status: 'open' | 'adopted' | 'superseded';
}

export interface CommittedDecision extends DecisionRecord {
  actor: string;
  proposalId: string | null;
  at: IsoDateTime;
}

export interface Communication {
  seq: number;
  actor: string;
  role: CrisisRole;
  kind: CommunicationKind;
  text: string;
  at: IsoDateTime;
  /** Simulated minute when posted (0 in the lobby). */
  atMinute: number;
}

/** Folded room state. Derived only; never stored separately from the log. */
export interface CrisisRoomState {
  roomId: string;
  owner: string;
  scenario: SimulationScenario;
  scenarioFingerprint: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  status: RoomStatus;
  /** Equals the number of events in the log. */
  version: number;
  commander: string;
  participants: Participant[];
  invites: InviteState[];
  proposals: Proposal[];
  decisions: CommittedDecision[];
  communications: Communication[];
  /** The single authoritative engine session; null until started. */
  session: ExerciseSession | null;
  startedAt: IsoDateTime | null;
}

export type CrisisCommand =
  | { type: 'issue-invite'; inviteId: string; token: string; role: CrisisRole; expiresAt: string }
  | { type: 'revoke-invite'; inviteId: string }
  | { type: 'join'; token: string }
  | { type: 'leave' }
  | { type: 'assign-role'; accountId: string; role: CrisisRole }
  | { type: 'hand-off-command'; to: string }
  | { type: 'start' }
  | { type: 'propose'; proposalId: string; decisionId: string; rationale: string }
  | { type: 'commit-decision'; decisionId: string; proposalId?: string }
  | { type: 'communicate'; kind: CommunicationKind; text: string }
  | { type: 'close' };

/** Trusted call context, built by the resolver from the Forge context and server clock. */
export interface CommandContext {
  actor: string;
  at: IsoDateTime;
  /** The room version the caller last saw. Any other value is rejected as stale. */
  expectedVersion: number;
}

export type CrisisRejectReason =
  | 'STALE_VERSION'
  | 'FORBIDDEN'
  | 'NOT_PARTICIPANT'
  | 'INVALID_INPUT'
  | 'INVALID_STATE'
  | 'ROOM_EXPIRED'
  | 'ROOM_CLOSED'
  /** Unknown, reused, revoked, expired or other-room token: one reason, no oracle. */
  | 'INVITE_INVALID'
  | 'LOG_FULL'
  | 'ROOM_FULL';

export type CommandResult =
  | { ok: true; event: CrisisEvent; state: CrisisRoomState; events: CrisisEvent[] }
  | { ok: false; reason: CrisisRejectReason; message: string; version: number };

export interface RoleView {
  roomId: string;
  version: number;
  status: RoomStatus;
  viewer: string;
  role: CrisisRole;
  commander: string;
  participants: { accountId: string; role: CrisisRole; active: boolean }[];
  step: { id: string; title: string; situation: string } | null;
  /** Decision options; empty for roles that cannot propose or commit. */
  options: { id: string; label: string; detail?: string }[];
  evidence: EvidenceReference[];
  objectives: { objectiveId: string; label: string; progress: ObjectiveProgress }[];
  elapsedMinutes: number;
  openProposals: Omit<Proposal, 'status'>[];
  decisions: CommittedDecision[];
  communications: Communication[];
  /** What the viewer may do now. */
  can: { propose: boolean; commit: boolean; communicate: CommunicationKind[]; manage: boolean };
}

export interface TimelineEntry {
  seq: number;
  at: IsoDateTime;
  actor: string;
  role: CrisisRole | null;
  type: CrisisEventType;
  /** Simulated minute, when the session was running. */
  atMinute: number | null;
  summary: string;
}

export interface RoleContribution {
  accountId: string;
  /** Roles held over the room's life, in order. */
  roles: CrisisRole[];
  proposals: number;
  proposalsAdopted: number;
  decisionsCommitted: number;
  statusUpdates: number;
  stakeholderNotices: number;
}

export interface CrisisDebrief {
  roomId: string;
  scenarioId: string;
  scenarioFingerprint: string;
  evaluation: ExerciseEvaluation;
  contributions: RoleContribution[];
  timeline: TimelineEntry[];
  /** Evidence cited by committed decisions, in first-cited order. */
  evidence: EvidenceReference[];
  decisions: (CommittedDecision & { label: string; assessment: string; narrative: string })[];
}

/** After-action report; `audit` and `submission` feed shared/history saveRun unchanged. */
export interface CrisisAfterActionReport {
  kind: 'crisis-after-action';
  schemaVersion: 1;
  roomId: string;
  owner: string;
  audit: SessionAuditRecord;
  submission: RunSubmission;
  debrief: CrisisDebrief;
}
