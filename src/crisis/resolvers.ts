import type { ApiResult, RehearsalSourceRef, SaveRehearsalResponse } from '../../shared/api';
import { HISTORY_NOT_ENABLED } from '../../shared/api';
import type { StorageAdapter } from '../../shared/agents/storage';
import { createHmac } from 'node:crypto';
import {
  buildAfterActionReport,
  buildDebrief,
  buildTimeline,
  createRoom,
  CRISIS_NOT_ENABLED,
  CRISIS_REJECT_TEXT,
  CRISIS_ROLES,
  CRISIS_ROOM_ID,
  CRISIS_TOKEN,
  CrisisLogError,
  executeCommand,
  MAX_EVENTS,
  MAX_RATIONALE_LENGTH,
  MAX_TEXT_LENGTH,
  rebuildRoom,
  roleView,
} from '../../shared/crisis';
import type {
  CrisisClientCommand,
  CrisisCommand,
  CrisisEvent,
  CrisisGate,
  CrisisInviteResponse,
  CrisisReject,
  CrisisRejected,
  CrisisRole,
  CrisisRoomResponse,
  CrisisRoomSnapshot,
  CrisisRoomState,
  CrisisViewResponse,
  ParticipantAlias,
} from '../../shared/crisis';
import { HistoryStore } from '../../shared/history';
import type { HistoryUser, TrustedScenario } from '../../shared/history';
import { encodeSegment, FORGE_MAX_VALUE_BYTES, storedBytes } from '../../shared/history/keys';
import { historyUserOf, parseSource, type ResolverRequest } from '../history/resolvers';

/**
 * Crisis Room resolvers (docs/M7_PLAN.md §2).
 *
 * - Identity is `context.accountId` + `context.installContext` only.
 * - `crisisStorage()` returning null (storage:app not granted) answers every
 *   call UNAVAILABLE with CRISIS_NOT_ENABLED before anything else is done.
 * - Every write is a conditional write at the version the engine read, so two
 *   callers racing at the same version cannot both succeed.
 * - Every read folds the stored log with rebuildRoom; a log the engine could
 *   not have produced is reported as ROOM_INVALID and never served.
 * - Room ids, invite ids, proposal ids and invite tokens come from
 *   crypto.randomBytes here. Only the token hash is stored; the token is
 *   returned once to the owner and never logged.
 */

export interface CrisisResolverDeps {
  /** Room storage; null while storage:app is not granted. */
  crisisStorage: () => StorageAdapter | null;
  /** History storage for saving the after-action report; null when not granted. */
  historyStorage: () => StorageAdapter | null;
  /** Rebuilds a demo or generated scenario as the caller (history resolvers). */
  trustedScenario: (
    source: RehearsalSourceRef,
  ) => Promise<
    { ok: true; trusted: TrustedScenario } | { ok: false; result: ApiResult<SaveRehearsalResponse> }
  >;
  now?: () => Date;
  /** base64url of `bytes` cryptographically random bytes (node crypto.randomBytes in Forge). */
  random: (bytes: number) => string;
}

/** The stored value: the event log plus what the debrief save needs. */
interface RoomRecord {
  schema: 1;
  source: RehearsalSourceRef;
  remediation: TrustedScenario['remediation'];
  provenance: TrustedScenario['provenance'];
  events: CrisisEvent[];
  /**
   * Server-only key for client-visible participant ids. Absent on rooms created
   * before it existed; those derive a key from installation + room id, which
   * still keeps account ids out of payloads (see participantAlias).
   */
  aliasKey?: string;
}

export const ROOM_HOURS = 8;
export const INVITE_HOURS = 4;
const KEY_PREFIX = 'sfc1';
const PARTICIPANT_ID = /^p_[A-Za-z0-9_-]{16}$/;
const ID = /^[A-Za-z0-9:._-]{1,80}$/;
const INVITE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const JOIN_RETRIES = 3;
const NO_IDENTITY =
  'Your Atlassian account could not be identified, so team rooms are not available.';
const UNREACHABLE = 'Room storage could not be reached. Try again shortly.';

/**
 * Client-visible participant id: HMAC-SHA-256 of the account id under a
 * per-room secret that never leaves the server. Stable inside the room,
 * different in every other room, and not derivable from the account id alone.
 */
export function participantAlias(record: RoomRecord, installation: string, roomId: string) {
  const key = record.aliasKey ?? `legacy:${installation}:${roomId}`;
  const alias: ParticipantAlias = (accountId) =>
    `p_${createHmac('sha256', key).update(accountId).digest('base64url').slice(0, 16)}`;
  return alias;
}

export function roomKey(installation: string, roomId: string): string {
  return `${KEY_PREFIX}:${encodeSegment(installation)}:room:${roomId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const isRole = (v: unknown): v is CrisisRole =>
  typeof v === 'string' && (CRISIS_ROLES as readonly string[]).includes(v);
const isVersion = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_EVENTS;

function rejected(reason: CrisisReject, version: number | null, message?: string): CrisisRejected {
  return { status: 'REJECTED', reason, message: message ?? CRISIS_REJECT_TEXT[reason], version };
}

const invalid = (message: string) => rejected('INVALID_INPUT', null, message);

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** Strict parse of a browser command. Unknown types and extra shapes are refused. */
export function parseClientCommand(value: unknown): Parsed<CrisisClientCommand> {
  const c = asRecord(value);
  const bad = (message: string) => ({ ok: false, message }) as const;
  if (!c || typeof c.type !== 'string') return bad('command.type is required.');
  switch (c.type) {
    case 'join':
      return typeof c.token === 'string' && CRISIS_TOKEN.test(c.token)
        ? { ok: true, value: { type: 'join', token: c.token } }
        : bad('The invite token is malformed.');
    case 'revoke-invite':
      return typeof c.inviteId === 'string' && INVITE_ID.test(c.inviteId)
        ? { ok: true, value: { type: 'revoke-invite', inviteId: c.inviteId } }
        : bad('inviteId is malformed.');
    case 'leave':
    case 'start':
    case 'close':
      return { ok: true, value: { type: c.type } };
    case 'assign-role':
      if (typeof c.participantId !== 'string' || !PARTICIPANT_ID.test(c.participantId))
        return bad('participantId is malformed.');
      if (!isRole(c.role)) return bad('role is not a crisis role.');
      return {
        ok: true,
        value: { type: 'assign-role', participantId: c.participantId, role: c.role },
      };
    case 'hand-off-command':
      return typeof c.toParticipantId === 'string' && PARTICIPANT_ID.test(c.toParticipantId)
        ? { ok: true, value: { type: 'hand-off-command', toParticipantId: c.toParticipantId } }
        : bad('toParticipantId is malformed.');
    case 'propose':
      if (typeof c.decisionId !== 'string' || !ID.test(c.decisionId))
        return bad('decisionId is malformed.');
      if (typeof c.rationale !== 'string' || c.rationale.length > MAX_RATIONALE_LENGTH)
        return bad(`rationale is limited to ${MAX_RATIONALE_LENGTH} characters.`);
      return {
        ok: true,
        value: { type: 'propose', decisionId: c.decisionId, rationale: c.rationale },
      };
    case 'commit-decision': {
      if (typeof c.decisionId !== 'string' || !ID.test(c.decisionId))
        return bad('decisionId is malformed.');
      if (
        c.proposalId !== undefined &&
        (typeof c.proposalId !== 'string' || !INVITE_ID.test(c.proposalId))
      )
        return bad('proposalId is malformed.');
      return {
        ok: true,
        value: {
          type: 'commit-decision',
          decisionId: c.decisionId,
          ...(c.proposalId !== undefined ? { proposalId: c.proposalId as string } : {}),
        },
      };
    }
    case 'communicate':
      if (c.kind !== 'status-update' && c.kind !== 'stakeholder-notice')
        return bad('kind must be status-update or stakeholder-notice.');
      if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > MAX_TEXT_LENGTH)
        return bad(`text must be 1 to ${MAX_TEXT_LENGTH} characters.`);
      return { ok: true, value: { type: 'communicate', kind: c.kind, text: c.text } };
    default:
      return bad('Unknown command.');
  }
}

export function createCrisisResolvers(deps: CrisisResolverDeps) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random;

  type Gated =
    { ok: true; user: HistoryUser; storage: StorageAdapter } | { ok: false; gate: CrisisGate };

  function gate(request: ResolverRequest): Gated {
    const user = historyUserOf(request.context);
    if (!user) return { ok: false, gate: { status: 'IDENTITY_UNAVAILABLE', detail: NO_IDENTITY } };
    let storage: StorageAdapter | null;
    try {
      storage = deps.crisisStorage();
    } catch {
      storage = null;
    }
    if (!storage) return { ok: false, gate: { status: 'UNAVAILABLE', detail: CRISIS_NOT_ENABLED } };
    return { ok: true, user, storage };
  }

  type Loaded =
    | { ok: true; record: RoomRecord; storeVersion: number; state: CrisisRoomState }
    | { ok: false; response: CrisisRejected | CrisisGate };

  async function load(storage: StorageAdapter, user: HistoryUser, roomId: string): Promise<Loaded> {
    let stored;
    try {
      stored = await storage.get<RoomRecord>(roomKey(user.installation, roomId));
    } catch {
      return { ok: false, response: { status: 'UNAVAILABLE', detail: UNREACHABLE } };
    }
    // A missing room and a room you are not in answer the same way (no existence oracle).
    if (!stored) return { ok: false, response: rejected('NOT_PARTICIPANT', null) };
    const record = stored.value;
    try {
      if (record?.schema !== 1 || !Array.isArray(record.events)) throw new CrisisLogError('schema');
      const state = rebuildRoom(record.events);
      if (state.roomId !== roomId) throw new CrisisLogError('room id');
      return { ok: true, record, storeVersion: stored.version, state };
    } catch (error) {
      if (error instanceof CrisisLogError || error instanceof TypeError) {
        console.warn('Crisis room failed verification');
        return { ok: false, response: rejected('ROOM_INVALID', null) };
      }
      throw error;
    }
  }

  function snapshot(
    record: RoomRecord,
    state: CrisisRoomState,
    user: HistoryUser,
  ): CrisisRoomSnapshot | null {
    const viewer = user.accountId;
    const alias = participantAlias(record, user.installation, state.roomId);
    const result = roleView(state, viewer, alias);
    if (!result.ok) return null;
    const isOwner = state.owner === viewer;
    const nowMs = now().getTime();
    const completed = state.session?.status === 'completed';
    return {
      view: result.view,
      scenarioTitle: state.scenario.title,
      synthetic: record.source.kind === 'demo',
      isOwner,
      expiresAt: state.expiresAt,
      timeline: buildTimeline(record.events, alias),
      invites: isOwner
        ? state.invites.map((i) => ({
            inviteId: i.inviteId,
            role: i.role,
            expiresAt: i.expiresAt,
            state: i.usedBy
              ? 'used'
              : i.revoked
                ? 'revoked'
                : Date.parse(i.expiresAt) <= nowMs
                  ? 'expired'
                  : 'open',
          }))
        : [],
      debrief: completed ? buildDebrief(record.events, alias) : null,
    };
  }

  /** Runs one engine command and writes it at the version that was read. */
  async function apply(
    storage: StorageAdapter,
    user: HistoryUser,
    roomId: string,
    expectedVersion: number | 'current',
    command: CrisisCommand,
  ): Promise<
    | { ok: true; record: RoomRecord; state: CrisisRoomState }
    | { ok: false; response: CrisisRejected | CrisisGate }
  > {
    for (let attempt = 0; attempt < (expectedVersion === 'current' ? JOIN_RETRIES : 1); attempt++) {
      const loaded = await load(storage, user, roomId);
      if (!loaded.ok) return loaded;
      const { record, storeVersion, state } = loaded;
      const result = executeCommand(record.events, command, {
        actor: user.accountId,
        at: now().toISOString(),
        expectedVersion: expectedVersion === 'current' ? state.version : expectedVersion,
      });
      if (!result.ok) {
        const reason = result.reason;
        return { ok: false, response: rejected(reason, result.version) };
      }
      const next: RoomRecord = { ...record, events: result.events };
      if (storedBytes(next) > FORGE_MAX_VALUE_BYTES) {
        return { ok: false, response: rejected('LOG_FULL', state.version) };
      }
      let written;
      try {
        written = await storage.set(roomKey(user.installation, roomId), next, storeVersion);
      } catch {
        return { ok: false, response: { status: 'UNAVAILABLE', detail: UNREACHABLE } };
      }
      if (written.ok) return { ok: true, record: next, state: result.state };
      // Lost the race: someone else wrote this version first.
      if (expectedVersion !== 'current') {
        return { ok: false, response: rejected('STALE_VERSION', state.version + 1) };
      }
    }
    return { ok: false, response: rejected('STALE_VERSION', null) };
  }

  function roomIdOf(payload: Record<string, unknown> | null): string | null {
    const id = payload?.roomId;
    return typeof id === 'string' && CRISIS_ROOM_ID.test(id) ? id : null;
  }

  function respond(record: RoomRecord, state: CrisisRoomState, user: HistoryUser): CrisisRoomResponse {
    const room = snapshot(record, state, user);
    return room ? { status: 'OK', room } : rejected('NOT_PARTICIPANT', null);
  }

  const data = <T>(value: T): ApiResult<T> => ({ ok: true, data: value });

  async function crisisOpenRoom(request: ResolverRequest): Promise<ApiResult<CrisisRoomResponse>> {
    const payload = asRecord(request.payload);
    if (!payload) return data(invalid('A rehearsal source is required.'));
    if ('scenario' in payload)
      return data(invalid('A scenario is never accepted from the browser.'));
    const source = parseSource(payload.source);
    if (!source.ok) return data(invalid(source.message));
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const { user, storage } = gated;

    const built = await deps.trustedScenario(source.value);
    if (!built.ok) {
      const r = built.result;
      const message = !r.ok ? r.error.message : 'message' in r.data ? r.data.message : undefined;
      return data(rejected('SCENARIO_UNAVAILABLE', null, message));
    }
    const roomId = random(16);
    const at = now();
    let events: CrisisEvent[];
    try {
      events = createRoom({
        roomId,
        owner: user.accountId,
        scenario: built.trusted.scenario,
        at: at.toISOString(),
        expiresAt: new Date(at.getTime() + ROOM_HOURS * 3_600_000).toISOString(),
      });
    } catch (error) {
      if (error instanceof CrisisLogError) return data(rejected('SCENARIO_UNAVAILABLE', null));
      throw error;
    }
    const record: RoomRecord = {
      schema: 1,
      source: source.value,
      remediation: built.trusted.remediation,
      provenance: built.trusted.provenance,
      events,
      aliasKey: random(24),
    };
    if (storedBytes(record) > FORGE_MAX_VALUE_BYTES) return data(rejected('LOG_FULL', null));
    try {
      const written = await storage.set(roomKey(user.installation, roomId), record, null);
      if (!written.ok) return data(rejected('STALE_VERSION', null));
    } catch {
      return data({ status: 'UNAVAILABLE', detail: UNREACHABLE });
    }
    return data(respond(record, rebuildRoom(events), user));
  }

  async function crisisView(request: ResolverRequest): Promise<ApiResult<CrisisViewResponse>> {
    const payload = asRecord(request.payload);
    const roomId = roomIdOf(payload);
    if (!roomId) return data(invalid('roomId is malformed.'));
    const known = payload?.knownVersion;
    if (known !== undefined && !isVersion(known))
      return data(invalid('knownVersion is malformed.'));
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const loaded = await load(gated.storage, gated.user, roomId);
    if (!loaded.ok) return data(loaded.response);
    const { record, state } = loaded;
    if (!state.participants.some((p) => p.accountId === gated.user.accountId && p.active))
      return data(rejected('NOT_PARTICIPANT', null));
    if (known === state.version) return data({ status: 'UNCHANGED', version: state.version });
    return data(respond(record, state, gated.user));
  }

  async function crisisCommand(request: ResolverRequest): Promise<ApiResult<CrisisRoomResponse>> {
    const payload = asRecord(request.payload);
    const roomId = roomIdOf(payload);
    if (!roomId) return data(invalid('roomId is malformed.'));
    const parsed = parseClientCommand(payload?.command);
    if (!parsed.ok) return data(invalid(parsed.message));
    const cmd = parsed.value;
    const expected = payload?.expectedVersion;
    if (cmd.type !== 'join' && !isVersion(expected))
      return data(invalid('expectedVersion is malformed.'));
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);

    let command: CrisisCommand;
    if (cmd.type === 'assign-role' || cmd.type === 'hand-off-command') {
      // Clients name people by opaque participant id; the real id stays server-side.
      const loaded = await load(gated.storage, gated.user, roomId);
      if (!loaded.ok) return data(loaded.response);
      const alias = participantAlias(loaded.record, gated.user.installation, roomId);
      const wanted = cmd.type === 'assign-role' ? cmd.participantId : cmd.toParticipantId;
      const target = loaded.state.participants.find((p) => alias(p.accountId) === wanted);
      if (!target) return data(rejected('INVALID_INPUT', loaded.state.version, 'Unknown participant.'));
      command =
        cmd.type === 'assign-role'
          ? { type: 'assign-role', accountId: target.accountId, role: cmd.role }
          : { type: 'hand-off-command', to: target.accountId };
    } else {
      command = cmd.type === 'propose' ? { ...cmd, proposalId: random(12) } : cmd;
    }
    const applied = await apply(
      gated.storage,
      gated.user,
      roomId,
      cmd.type === 'join' ? 'current' : (expected as number),
      command,
    );
    if (!applied.ok) return data(applied.response);
    return data(respond(applied.record, applied.state, gated.user));
  }

  async function crisisInviteToken(
    request: ResolverRequest,
  ): Promise<ApiResult<CrisisInviteResponse>> {
    const payload = asRecord(request.payload);
    const roomId = roomIdOf(payload);
    if (!roomId) return data(invalid('roomId is malformed.'));
    if (!isVersion(payload?.expectedVersion)) return data(invalid('expectedVersion is malformed.'));
    if (!isRole(payload?.role) || payload.role === 'incident-commander')
      return data(invalid('role must be a crisis role other than incident commander.'));
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);

    const token = random(32);
    const inviteId = random(9);
    const role = payload.role;
    const expiresAt = new Date(now().getTime() + INVITE_HOURS * 3_600_000).toISOString();
    const applied = await apply(
      gated.storage,
      gated.user,
      roomId,
      payload.expectedVersion as number,
      {
        type: 'issue-invite',
        inviteId,
        token,
        role,
        expiresAt,
      },
    );
    if (!applied.ok) return data(applied.response);
    const room = snapshot(applied.record, applied.state, gated.user);
    if (!room) return data(rejected('NOT_PARTICIPANT', null));
    // The invite's real expiry is capped by the engine at the room's expiry.
    const issued = applied.state.invites.find((i) => i.inviteId === inviteId)!;
    return data({
      status: 'OK',
      room,
      invite: { inviteId, role, expiresAt: issued.expiresAt, token },
    });
  }

  /** Saves the after-action report to the owner's history through the existing saveRun path. */
  async function crisisSaveDebrief(
    request: ResolverRequest,
  ): Promise<ApiResult<SaveRehearsalResponse>> {
    const roomId = roomIdOf(asRecord(request.payload));
    if (!roomId)
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'roomId is malformed.' } };
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const loaded = await load(gated.storage, gated.user, roomId);
    if (!loaded.ok) {
      const r = loaded.response;
      return data(
        r.status === 'REJECTED'
          ? { status: 'REJECTED', reason: 'ORIGINAL_NOT_FOUND', message: r.message }
          : r,
      );
    }
    const { record, state } = loaded;
    if (state.owner !== gated.user.accountId) {
      return data({
        status: 'REJECTED',
        reason: 'ORIGINAL_NOT_FOUND',
        message: 'Only the room owner can save the debrief to history.',
      });
    }
    if (state.session?.status !== 'completed') {
      return data({
        status: 'REJECTED',
        reason: 'ORIGINAL_NOT_FOUND',
        message: 'The exercise has not finished yet.',
      });
    }
    let historyStorage: StorageAdapter | null;
    try {
      historyStorage = deps.historyStorage();
    } catch {
      historyStorage = null;
    }
    if (!historyStorage) return data({ status: 'UNAVAILABLE', detail: HISTORY_NOT_ENABLED });
    const report = buildAfterActionReport(record.events);
    const store = new HistoryStore({ storage: historyStorage, now });
    const result = await store.saveRun(
      gated.user,
      { scenario: state.scenario, remediation: record.remediation, provenance: record.provenance },
      report.submission,
    );
    switch (result.status) {
      case 'SAVED':
        return data({ status: 'SAVED', id: result.id, pruned: result.pruned });
      case 'UNAVAILABLE':
        return data({
          status: 'UNAVAILABLE',
          detail: 'History storage could not be reached. Try again shortly.',
        });
      default:
        return data(result);
    }
  }

  /** Cheap probe so the screen can say plainly whether team rooms work here. */
  async function crisisStatus(
    request: ResolverRequest,
  ): Promise<ApiResult<{ status: 'AVAILABLE' } | CrisisGate>> {
    const gated = gate(request);
    return data(gated.ok ? { status: 'AVAILABLE' } : gated.gate);
  }

  return {
    crisisStatus,
    crisisOpenRoom,
    crisisView,
    crisisCommand,
    crisisInviteToken,
    crisisSaveDebrief,
  };
}

export type CrisisResolvers = ReturnType<typeof createCrisisResolvers>;
