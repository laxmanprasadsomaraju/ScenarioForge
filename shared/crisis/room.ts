import type { SimulationScenario } from '../domain/types';
import { storedBytes, MAX_VALUE_BYTES } from '../history/keys';
import { sha256Hex } from '../remediation/sha256';
import { applyDecision, currentStep, startSession, validateScenario } from '../simulation/engine';
import { scenarioFingerprint } from '../simulation/replay';
import type {
  CommandContext,
  CommandResult,
  CrisisCommand,
  CrisisEvent,
  CrisisEventBody,
  CrisisRejectReason,
  CrisisRole,
  CrisisRoomState,
} from './types';

/**
 * Crisis Room engine: command validation and the event fold.
 *
 * `executeCommand` is the only way to grow a log. It checks the caller's
 * expected version, the room's status and expiry, and the caller's role, then
 * appends one event. `rebuildRoom` folds a stored log from scratch; it throws
 * on a log the engine could not have produced, so a tampered or corrupted log
 * is never served as a valid room.
 */

export class CrisisLogError extends Error {}

export const CRISIS_ROLES: readonly CrisisRole[] = [
  'incident-commander',
  'engineering-responder',
  'security-responder',
  'communications-lead',
  'observer',
];

/** Hard bounds. The whole log must fit one storage value (shared/history/keys). */
export const MAX_EVENTS = 400;
export const MAX_LOG_BYTES = MAX_VALUE_BYTES;
export const MAX_PARTICIPANTS = 12;
export const MAX_OPEN_INVITES = 20;
export const MAX_TEXT_LENGTH = 1000;
export const MAX_RATIONALE_LENGTH = 500;
export const MAX_ROOM_HOURS = 24;
export const MAX_INVITE_HOURS = 24;
export const MIN_TOKEN_LENGTH = 32;
export const MAX_TOKEN_LENGTH = 128;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const HOUR_MS = 3_600_000;

/** Roles that may propose a decision. The commander commits; observers only read. */
export const PROPOSER_ROLES: readonly CrisisRole[] = [
  'engineering-responder',
  'security-responder',
  'communications-lead',
];

/**
 * Invite token hash. Binding the room id means a token issued for another
 * room can never match here. Tokens are random secrets of at least 32
 * characters, so a fast hash is enough (no password stretching needed).
 */
export function hashInviteToken(roomId: string, token: string): string {
  return sha256Hex(`sf-crisis-invite:v1:${roomId}:${token}`);
}

export interface CreateRoomInput {
  roomId: string;
  owner: string;
  scenario: SimulationScenario;
  at: string;
  expiresAt: string;
}

/** Creates a room's first event. The owner starts as incident commander. */
export function createRoom(input: CreateRoomInput): CrisisEvent[] {
  const { roomId, owner, scenario, at, expiresAt } = input;
  if (!ID_PATTERN.test(roomId)) throw new CrisisLogError('Invalid room id.');
  if (!owner) throw new CrisisLogError('Owner is required.');
  const problems = validateScenario(scenario);
  if (problems.length) throw new CrisisLogError(`Invalid scenario: ${problems.join('; ')}`);
  const created = time(at);
  const expires = time(expiresAt);
  if (created === null || expires === null || expires <= created) {
    throw new CrisisLogError('Invalid room times.');
  }
  if (expires - created > MAX_ROOM_HOURS * HOUR_MS) {
    throw new CrisisLogError(`Rooms last at most ${MAX_ROOM_HOURS} hours.`);
  }
  const event: CrisisEvent = {
    seq: 1,
    at,
    actor: owner,
    type: 'room-created',
    roomId,
    scenario,
    scenarioFingerprint: scenarioFingerprint(scenario),
    expiresAt,
  };
  if (storedBytes([event]) > MAX_LOG_BYTES) throw new CrisisLogError('Scenario is too large.');
  return [event];
}

/** Folds a log from its first event. Reconnecting clients use exactly this. */
export function rebuildRoom(events: readonly CrisisEvent[]): CrisisRoomState {
  const first = events[0];
  if (!first || first.type !== 'room-created' || first.seq !== 1) {
    throw new CrisisLogError('Log must start with room-created.');
  }
  if (scenarioFingerprint(first.scenario) !== first.scenarioFingerprint) {
    throw new CrisisLogError('Scenario snapshot does not match its fingerprint.');
  }
  let state: CrisisRoomState = {
    roomId: first.roomId,
    owner: first.actor,
    scenario: first.scenario,
    scenarioFingerprint: first.scenarioFingerprint,
    createdAt: first.at,
    expiresAt: first.expiresAt,
    status: 'lobby',
    version: 1,
    commander: first.actor,
    participants: [
      { accountId: first.actor, role: 'incident-commander', joinedAt: first.at, active: true },
    ],
    invites: [],
    proposals: [],
    decisions: [],
    communications: [],
    session: null,
    startedAt: null,
  };
  for (let i = 1; i < events.length; i++) {
    const event = events[i]!;
    if (event.seq !== i + 1) throw new CrisisLogError(`Event ${i + 1} has seq ${event.seq}.`);
    // Re-check permissions on replay: a log the engine would have refused is invalid.
    const reason = authorize(state, event);
    if (reason)
      throw new CrisisLogError(`Event ${event.seq} (${event.type}) is not allowed: ${reason}.`);
    state = applyEvent(state, event);
  }
  return state;
}

/**
 * Validates `command` against the log and appends one event. Returns the new
 * log tail event and state; the input log is not mutated.
 */
export function executeCommand(
  events: readonly CrisisEvent[],
  command: CrisisCommand,
  ctx: CommandContext,
): CommandResult {
  const state = rebuildRoom(events);
  const reject = (reason: CrisisRejectReason, message: string) =>
    ({ ok: false, reason, message, version: state.version }) as const;

  if (ctx.expectedVersion !== state.version) {
    return reject('STALE_VERSION', `Room is at version ${state.version}; reload and retry.`);
  }
  const now = time(ctx.at);
  if (now === null || !ctx.actor) return reject('INVALID_INPUT', 'Invalid call context.');
  if (state.status === 'closed') return reject('ROOM_CLOSED', 'This room is closed.');
  if (command.type !== 'close' && now >= time(state.expiresAt)!) {
    return reject('ROOM_EXPIRED', 'This room has expired.');
  }

  const built = buildEvent(state, command, now);
  if ('reason' in built) return reject(built.reason, built.message);

  const event = {
    ...built.body,
    seq: state.version + 1,
    at: ctx.at,
    actor: ctx.actor,
  } as CrisisEvent;
  const reason = authorize(state, event);
  if (reason) return reject(reason, messages[reason]);

  const next = [...events, event];
  if (next.length > MAX_EVENTS || storedBytes(next) > MAX_LOG_BYTES) {
    return reject(
      'LOG_FULL',
      'This room has reached its event limit; close it and start a new one.',
    );
  }
  return { ok: true, event, state: applyEvent(state, event), events: next };
}

const messages: Record<CrisisRejectReason, string> = {
  STALE_VERSION: 'Room changed; reload and retry.',
  FORBIDDEN: 'Your role cannot do this.',
  NOT_PARTICIPANT: 'You are not in this room.',
  INVALID_INPUT: 'Invalid input.',
  INVALID_STATE: 'Not possible in the room’s current state.',
  ROOM_EXPIRED: 'This room has expired.',
  ROOM_CLOSED: 'This room is closed.',
  INVITE_INVALID: 'This invite is not valid.',
  LOG_FULL: 'This room has reached its event limit.',
  ROOM_FULL: 'This room is full.',
};

type Built = { body: CrisisEventBody } | { reason: CrisisRejectReason; message: string };

/** Turns a command into an event body; input validation only. */
function buildEvent(state: CrisisRoomState, cmd: CrisisCommand, now: number): Built {
  const bad = (message: string): Built => ({ reason: 'INVALID_INPUT', message });
  switch (cmd.type) {
    case 'issue-invite': {
      if (!ID_PATTERN.test(cmd.inviteId)) return bad('Invalid invite id.');
      if (!isRole(cmd.role)) return bad('Unknown role.');
      if (
        typeof cmd.token !== 'string' ||
        cmd.token.length < MIN_TOKEN_LENGTH ||
        cmd.token.length > MAX_TOKEN_LENGTH ||
        !TOKEN_PATTERN.test(cmd.token)
      ) {
        return bad('Invite token must be 32–128 URL-safe random characters.');
      }
      const expires = time(cmd.expiresAt);
      if (expires === null || expires <= now || expires - now > MAX_INVITE_HOURS * HOUR_MS) {
        return bad(`Invites expire within ${MAX_INVITE_HOURS} hours.`);
      }
      return {
        body: {
          type: 'invite-issued',
          inviteId: cmd.inviteId,
          tokenHash: hashInviteToken(state.roomId, cmd.token),
          role: cmd.role,
          expiresAt: cmd.expiresAt,
        },
      };
    }
    case 'revoke-invite':
      return { body: { type: 'invite-revoked', inviteId: cmd.inviteId } };
    case 'join': {
      if (typeof cmd.token !== 'string')
        return { reason: 'INVITE_INVALID', message: messages.INVITE_INVALID };
      const hash = hashInviteToken(state.roomId, cmd.token);
      const invite = state.invites.find((i) => i.tokenHash === hash);
      if (!invite || invite.revoked || invite.usedBy !== null || now >= time(invite.expiresAt)!) {
        return { reason: 'INVITE_INVALID', message: messages.INVITE_INVALID };
      }
      return { body: { type: 'participant-joined', inviteId: invite.inviteId, role: invite.role } };
    }
    case 'leave':
      return { body: { type: 'participant-left' } };
    case 'assign-role':
      if (!isRole(cmd.role)) return bad('Unknown role.');
      return { body: { type: 'role-assigned', accountId: cmd.accountId, role: cmd.role } };
    case 'hand-off-command':
      return { body: { type: 'command-handed-off', to: cmd.to } };
    case 'start':
      return { body: { type: 'session-started' } };
    case 'propose': {
      if (!ID_PATTERN.test(cmd.proposalId)) return bad('Invalid proposal id.');
      if (typeof cmd.rationale !== 'string' || cmd.rationale.length > MAX_RATIONALE_LENGTH) {
        return bad(`Rationale is limited to ${MAX_RATIONALE_LENGTH} characters.`);
      }
      const stepId = state.session?.currentStepId ?? '';
      return {
        body: {
          type: 'proposal-made',
          proposalId: cmd.proposalId,
          stepId,
          decisionId: cmd.decisionId,
          rationale: cmd.rationale,
        },
      };
    }
    case 'commit-decision': {
      const stepId = state.session?.currentStepId ?? '';
      return {
        body: {
          type: 'decision-committed',
          stepId,
          decisionId: cmd.decisionId,
          proposalId: cmd.proposalId ?? null,
        },
      };
    }
    case 'communicate':
      if (cmd.kind !== 'status-update' && cmd.kind !== 'stakeholder-notice')
        return bad('Unknown kind.');
      if (typeof cmd.text !== 'string' || !cmd.text.trim() || cmd.text.length > MAX_TEXT_LENGTH) {
        return bad(`Messages are 1–${MAX_TEXT_LENGTH} characters.`);
      }
      return { body: { type: 'communication-posted', kind: cmd.kind, text: cmd.text } };
    case 'close':
      return { body: { type: 'room-closed' } };
    default:
      return bad('Unknown command.');
  }
}

/**
 * Permission and state rules for one event. Used both when appending and when
 * rebuilding, so the same rules hold for live commands and stored logs.
 */
function authorize(state: CrisisRoomState, event: CrisisEvent): CrisisRejectReason | null {
  const { actor } = event;
  const me = active(state, actor);
  const isOwner = actor === state.owner;
  const now = time(event.at);
  if (now === null) return 'INVALID_INPUT';
  if (state.status === 'closed') return 'ROOM_CLOSED';
  if (event.type !== 'room-closed' && now >= time(state.expiresAt)!) return 'ROOM_EXPIRED';

  switch (event.type) {
    case 'room-created':
      return 'INVALID_STATE';
    case 'invite-issued': {
      if (!isOwner) return 'FORBIDDEN';
      if (event.role === 'incident-commander') return 'INVALID_INPUT';
      if (
        state.invites.some((i) => i.inviteId === event.inviteId || i.tokenHash === event.tokenHash)
      ) {
        return 'INVALID_INPUT';
      }
      const open = state.invites.filter(
        (i) => !i.revoked && i.usedBy === null && now < time(i.expiresAt)!,
      );
      return open.length >= MAX_OPEN_INVITES ? 'ROOM_FULL' : null;
    }
    case 'invite-revoked': {
      if (!isOwner) return 'FORBIDDEN';
      const invite = state.invites.find((i) => i.inviteId === event.inviteId);
      return !invite || invite.revoked || invite.usedBy !== null ? 'INVALID_INPUT' : null;
    }
    case 'participant-joined': {
      if (me) return 'INVALID_STATE';
      const invite = state.invites.find((i) => i.inviteId === event.inviteId);
      if (!invite || invite.revoked || invite.usedBy !== null || now >= time(invite.expiresAt)!) {
        return 'INVITE_INVALID';
      }
      if (invite.role !== event.role) return 'INVITE_INVALID';
      if (state.participants.filter((p) => p.active).length >= MAX_PARTICIPANTS) return 'ROOM_FULL';
      return null;
    }
    case 'participant-left':
      if (!me) return 'NOT_PARTICIPANT';
      // The owner closes instead; the commander hands off first.
      return isOwner || actor === state.commander ? 'INVALID_STATE' : null;
    case 'role-assigned': {
      if (!isOwner) return 'FORBIDDEN';
      const target = active(state, event.accountId);
      if (!target) return 'NOT_PARTICIPANT';
      if (event.role === 'incident-commander' || target.accountId === state.commander) {
        return 'INVALID_STATE';
      }
      return null;
    }
    case 'command-handed-off': {
      if (!me) return 'NOT_PARTICIPANT';
      if (actor !== state.commander && !isOwner) return 'FORBIDDEN';
      if (!active(state, event.to)) return 'NOT_PARTICIPANT';
      return event.to === state.commander ? 'INVALID_STATE' : null;
    }
    case 'session-started':
      if (!isOwner) return 'FORBIDDEN';
      return state.status === 'lobby' ? null : 'INVALID_STATE';
    case 'proposal-made': {
      if (!me) return 'NOT_PARTICIPANT';
      if (!PROPOSER_ROLES.includes(me.role)) return 'FORBIDDEN';
      if (state.status !== 'running' || !state.session) return 'INVALID_STATE';
      if (state.proposals.some((p) => p.proposalId === event.proposalId)) return 'INVALID_INPUT';
      const step = currentStep(state.scenario, state.session);
      if (!step || step.id !== event.stepId) return 'INVALID_STATE';
      return step.decisions.some((d) => d.id === event.decisionId) ? null : 'INVALID_INPUT';
    }
    case 'decision-committed': {
      if (!me) return 'NOT_PARTICIPANT';
      if (actor !== state.commander) return 'FORBIDDEN';
      if (state.status !== 'running' || !state.session) return 'INVALID_STATE';
      const step = currentStep(state.scenario, state.session);
      if (!step || step.id !== event.stepId) return 'INVALID_STATE';
      if (!step.decisions.some((d) => d.id === event.decisionId)) return 'INVALID_INPUT';
      if (event.proposalId !== null) {
        const p = state.proposals.find((x) => x.proposalId === event.proposalId);
        if (
          !p ||
          p.status !== 'open' ||
          p.decisionId !== event.decisionId ||
          p.stepId !== step.id
        ) {
          return 'INVALID_INPUT';
        }
      }
      return null;
    }
    case 'communication-posted': {
      if (!me) return 'NOT_PARTICIPANT';
      if (me.role === 'observer') return 'FORBIDDEN';
      if (event.kind === 'stakeholder-notice') {
        if (me.role !== 'incident-commander' && me.role !== 'communications-lead')
          return 'FORBIDDEN';
        return state.status === 'running' ? null : 'INVALID_STATE';
      }
      return state.status === 'running' || state.status === 'debrief' ? null : 'INVALID_STATE';
    }
    case 'room-closed':
      return isOwner ? null : 'FORBIDDEN';
  }
}

/** Pure fold of one already-authorized event. */
function applyEvent(state: CrisisRoomState, event: CrisisEvent): CrisisRoomState {
  const next: CrisisRoomState = { ...state, version: event.seq };
  switch (event.type) {
    case 'room-created':
      throw new CrisisLogError('room-created may only be the first event.');
    case 'invite-issued':
      next.invites = [
        ...state.invites,
        {
          inviteId: event.inviteId,
          tokenHash: event.tokenHash,
          role: event.role,
          expiresAt: event.expiresAt,
          issuedBy: event.actor,
          usedBy: null,
          revoked: false,
        },
      ];
      break;
    case 'invite-revoked':
      next.invites = state.invites.map((i) =>
        i.inviteId === event.inviteId ? { ...i, revoked: true } : i,
      );
      break;
    case 'participant-joined':
      next.invites = state.invites.map((i) =>
        i.inviteId === event.inviteId ? { ...i, usedBy: event.actor } : i,
      );
      next.participants = [
        ...state.participants.filter((p) => p.accountId !== event.actor),
        { accountId: event.actor, role: event.role, joinedAt: event.at, active: true },
      ];
      break;
    case 'participant-left':
      next.participants = state.participants.map((p) =>
        p.accountId === event.actor ? { ...p, active: false } : p,
      );
      break;
    case 'role-assigned':
      next.participants = state.participants.map((p) =>
        p.accountId === event.accountId ? { ...p, role: event.role } : p,
      );
      break;
    case 'command-handed-off': {
      const incomingRole = active(state, event.to)!.role;
      next.commander = event.to;
      next.participants = state.participants.map((p) => {
        if (p.accountId === event.to) return { ...p, role: 'incident-commander' };
        // The previous commander takes the incoming commander's former role.
        if (p.accountId === state.commander) return { ...p, role: incomingRole };
        return p;
      });
      break;
    }
    case 'session-started':
      next.status = 'running';
      next.startedAt = event.at;
      next.session = startSession(state.scenario, state.roomId, event.at);
      break;
    case 'proposal-made':
      next.proposals = [
        ...state.proposals,
        {
          proposalId: event.proposalId,
          proposer: event.actor,
          proposerRole: active(state, event.actor)!.role,
          stepId: event.stepId,
          decisionId: event.decisionId,
          rationale: event.rationale,
          at: event.at,
          status: 'open',
        },
      ];
      break;
    case 'decision-committed': {
      const session = applyDecision(state.scenario, state.session!, event.decisionId);
      next.session = session;
      next.decisions = [
        ...state.decisions,
        {
          ...session.decisions[session.decisions.length - 1]!,
          actor: event.actor,
          proposalId: event.proposalId,
          at: event.at,
        },
      ];
      next.proposals = state.proposals.map((p) => {
        if (p.proposalId === event.proposalId) return { ...p, status: 'adopted' };
        if (p.status === 'open' && p.stepId === event.stepId) return { ...p, status: 'superseded' };
        return p;
      });
      if (session.status === 'completed') next.status = 'debrief';
      break;
    }
    case 'communication-posted':
      next.communications = [
        ...state.communications,
        {
          seq: event.seq,
          actor: event.actor,
          role: active(state, event.actor)!.role,
          kind: event.kind,
          text: event.text,
          at: event.at,
          atMinute: state.session?.elapsedMinutes ?? 0,
        },
      ];
      break;
    case 'room-closed':
      next.status = 'closed';
      break;
  }
  return next;
}

function active(state: CrisisRoomState, accountId: string) {
  return state.participants.find((p) => p.accountId === accountId && p.active) ?? null;
}

function isRole(value: unknown): value is CrisisRole {
  return CRISIS_ROLES.includes(value as CrisisRole);
}

function time(iso: string): number | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
