import { describe, expect, it } from 'vitest';
import {
  buildAfterActionReport,
  buildDebrief,
  createRoom,
  CrisisLogError,
  executeCommand,
  hashInviteToken,
  MAX_EVENTS,
  rebuildRoom,
  roleView,
  type CrisisCommand,
  type CrisisEvent,
  type CrisisRole,
} from '../shared/crisis';
import { replaySession, verifyAuditRecord } from '../shared/simulation/replay';
import { evaluateSession } from '../shared/simulation/engine';
import { authBackupRetiredScenario as scenario } from '../shared/simulation/scenarios/authBackupRetired';

const OWNER = 'acc-owner';
const ENG = 'acc-eng';
const SEC = 'acc-sec';
const COMMS = 'acc-comms';
const OBS = 'acc-obs';
const T0 = Date.parse('2026-11-11T10:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const token = (n: string) => `tok_${n}`.padEnd(40, 'x');

/** Small driver over the pure engine: tracks log and clock, throws on rejection. */
class Room {
  events: CrisisEvent[];
  clock = 1;
  constructor(roomId = 'room-1', owner = OWNER) {
    this.events = createRoom({ roomId, owner, scenario, at: at(0), expiresAt: at(8 * 60) });
  }
  get version() {
    return this.events.length;
  }
  try(actor: string, command: CrisisCommand, expectedVersion = this.version) {
    const r = executeCommand(this.events, command, {
      actor,
      at: at(this.clock++),
      expectedVersion,
    });
    if (r.ok) this.events = r.events;
    return r;
  }
  do(actor: string, command: CrisisCommand) {
    const r = this.try(actor, command);
    if (!r.ok) throw new Error(`${command.type} by ${actor}: ${r.reason} ${r.message}`);
    return r;
  }
  invite(role: CrisisRole, n: string, expiresAt = at(120)) {
    this.do(OWNER, {
      type: 'issue-invite',
      inviteId: `inv-${n}`,
      token: token(n),
      role,
      expiresAt,
    });
    return token(n);
  }
  join(actor: string, role: CrisisRole) {
    this.do(actor, { type: 'join', token: this.invite(role, actor) });
  }
  get state() {
    return rebuildRoom(this.events);
  }
}

function fullRoom() {
  const r = new Room();
  r.join(ENG, 'engineering-responder');
  r.join(SEC, 'security-responder');
  r.join(COMMS, 'communications-lead');
  r.join(OBS, 'observer');
  r.do(OWNER, { type: 'start' });
  return r;
}

const OPTIMAL = ['check-changes', 'notify-now', 'activate-nimbus'];

function playOptimal(r: Room) {
  r.do(ENG, {
    type: 'propose',
    proposalId: 'p1',
    decisionId: 'check-changes',
    rationale: 'Runbook is stale',
  });
  r.do(SEC, { type: 'propose', proposalId: 'p2', decisionId: 'bypass-sso', rationale: '' });
  r.do(OWNER, { type: 'commit-decision', decisionId: 'check-changes', proposalId: 'p1' });
  r.do(COMMS, { type: 'propose', proposalId: 'p3', decisionId: 'notify-now', rationale: 'SLA' });
  r.do(COMMS, { type: 'communicate', kind: 'stakeholder-notice', text: 'Sign-in degraded.' });
  r.do(OWNER, { type: 'commit-decision', decisionId: 'notify-now', proposalId: 'p3' });
  r.do(ENG, { type: 'communicate', kind: 'status-update', text: 'Activating NimbusID.' });
  r.do(OWNER, { type: 'commit-decision', decisionId: 'activate-nimbus' });
}

describe('room creation', () => {
  it('starts in the lobby with the owner as commander and a fingerprinted snapshot', () => {
    const s = new Room().state;
    expect(s.status).toBe('lobby');
    expect(s.commander).toBe(OWNER);
    expect(s.version).toBe(1);
    expect(s.scenarioFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
  it('rejects bad ids, inverted or over-long lifetimes', () => {
    expect(() =>
      createRoom({ roomId: 'bad id!', owner: OWNER, scenario, at: at(0), expiresAt: at(5) }),
    ).toThrow();
    expect(() =>
      createRoom({ roomId: 'r', owner: OWNER, scenario, at: at(5), expiresAt: at(0) }),
    ).toThrow();
    expect(() =>
      createRoom({ roomId: 'r', owner: OWNER, scenario, at: at(0), expiresAt: at(25 * 60) }),
    ).toThrow();
  });
  it('rejects a log whose scenario snapshot was edited', () => {
    const r = new Room();
    const first = r.events[0] as Extract<CrisisEvent, { type: 'room-created' }>;
    const tampered = { ...first, scenario: { ...first.scenario, title: 'changed' } };
    expect(() => rebuildRoom([tampered])).toThrow(CrisisLogError);
  });
});

describe('permissions per role', () => {
  it('only proposer roles propose; only the commander commits', () => {
    const r = fullRoom();
    expect(
      r.try(OWNER, {
        type: 'propose',
        proposalId: 'x',
        decisionId: 'check-changes',
        rationale: '',
      }),
    ).toMatchObject({ ok: false, reason: 'FORBIDDEN' });
    for (const who of [ENG, SEC, COMMS]) {
      expect(r.try(who, { type: 'commit-decision', decisionId: 'check-changes' })).toMatchObject({
        ok: false,
        reason: 'FORBIDDEN',
      });
    }
    expect(
      r.try(ENG, { type: 'propose', proposalId: 'ok', decisionId: 'check-changes', rationale: '' })
        .ok,
    ).toBe(true);
  });
  it('observers cannot act in any way', () => {
    const r = fullRoom();
    const cmds: CrisisCommand[] = [
      { type: 'propose', proposalId: 'o1', decisionId: 'check-changes', rationale: '' },
      { type: 'commit-decision', decisionId: 'check-changes' },
      { type: 'communicate', kind: 'status-update', text: 'hi' },
      { type: 'communicate', kind: 'stakeholder-notice', text: 'hi' },
      {
        type: 'issue-invite',
        inviteId: 'o2',
        token: token('o2'),
        role: 'observer',
        expiresAt: at(60),
      },
      { type: 'start' },
      { type: 'close' },
      { type: 'hand-off-command', to: OBS },
      { type: 'assign-role', accountId: ENG, role: 'observer' },
    ];
    for (const c of cmds) {
      const res = r.try(OBS, c);
      expect(res.ok, c.type).toBe(false);
    }
    expect(r.state.version).toBe(r.version);
  });
  it('stakeholder notices are for commander and comms lead only', () => {
    const r = fullRoom();
    expect(
      r.try(ENG, { type: 'communicate', kind: 'stakeholder-notice', text: 'x' }),
    ).toMatchObject({ reason: 'FORBIDDEN' });
    expect(
      r.try(SEC, { type: 'communicate', kind: 'stakeholder-notice', text: 'x' }),
    ).toMatchObject({ reason: 'FORBIDDEN' });
    expect(r.try(COMMS, { type: 'communicate', kind: 'stakeholder-notice', text: 'x' }).ok).toBe(
      true,
    );
    expect(r.try(OWNER, { type: 'communicate', kind: 'stakeholder-notice', text: 'y' }).ok).toBe(
      true,
    );
    expect(r.try(SEC, { type: 'communicate', kind: 'status-update', text: 'z' }).ok).toBe(true);
  });
  it('only the owner manages invites, roles, start and close', () => {
    const r = new Room();
    r.join(ENG, 'engineering-responder');
    expect(
      r.try(ENG, {
        type: 'issue-invite',
        inviteId: 'e',
        token: token('e'),
        role: 'observer',
        expiresAt: at(60),
      }),
    ).toMatchObject({ reason: 'FORBIDDEN' });
    expect(r.try(ENG, { type: 'start' })).toMatchObject({ reason: 'FORBIDDEN' });
    expect(r.try(ENG, { type: 'close' })).toMatchObject({ reason: 'FORBIDDEN' });
    expect(
      r.try(OWNER, { type: 'assign-role', accountId: ENG, role: 'incident-commander' }),
    ).toMatchObject({ reason: 'INVALID_STATE' });
    r.do(OWNER, { type: 'assign-role', accountId: ENG, role: 'security-responder' });
    expect(r.state.participants.find((p) => p.accountId === ENG)?.role).toBe('security-responder');
  });
  it('strangers are not participants', () => {
    const r = fullRoom();
    expect(
      r.try('acc-stranger', { type: 'communicate', kind: 'status-update', text: 'x' }),
    ).toMatchObject({ reason: 'NOT_PARTICIPANT' });
    expect(roleView(r.state, 'acc-stranger')).toEqual({ ok: false, reason: 'NOT_PARTICIPANT' });
  });
  it('rejects proposals and commits outside the running state or for unavailable decisions', () => {
    const r = new Room();
    r.join(ENG, 'engineering-responder');
    expect(
      r.try(ENG, { type: 'propose', proposalId: 'p', decisionId: 'check-changes', rationale: '' }),
    ).toMatchObject({ reason: 'INVALID_STATE' });
    expect(r.try(OWNER, { type: 'commit-decision', decisionId: 'check-changes' })).toMatchObject({
      reason: 'INVALID_STATE',
    });
    r.do(OWNER, { type: 'start' });
    expect(
      r.try(ENG, {
        type: 'propose',
        proposalId: 'p',
        decisionId: 'activate-nimbus',
        rationale: '',
      }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    expect(r.try(OWNER, { type: 'start' })).toMatchObject({ reason: 'INVALID_STATE' });
  });
  it('a commit may adopt only an open proposal for the same decision', () => {
    const r = fullRoom();
    r.do(ENG, { type: 'propose', proposalId: 'p1', decisionId: 'check-changes', rationale: '' });
    expect(
      r.try(OWNER, { type: 'commit-decision', decisionId: 'bypass-sso', proposalId: 'p1' }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    expect(
      r.try(OWNER, { type: 'commit-decision', decisionId: 'check-changes', proposalId: 'nope' }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    r.do(OWNER, { type: 'commit-decision', decisionId: 'check-changes', proposalId: 'p1' });
    expect(r.state.proposals[0]?.status).toBe('adopted');
  });
});

describe('optimistic concurrency', () => {
  it('rejects a stale expectedVersion without appending', () => {
    const r = fullRoom();
    const seen = r.version;
    r.do(ENG, { type: 'propose', proposalId: 'p1', decisionId: 'check-changes', rationale: '' });
    const stale = r.try(OWNER, { type: 'commit-decision', decisionId: 'bypass-sso' }, seen);
    expect(stale).toMatchObject({ ok: false, reason: 'STALE_VERSION', version: seen + 1 });
    expect(r.version).toBe(seen + 1);
    expect(
      r.try(OWNER, { type: 'commit-decision', decisionId: 'bypass-sso' }, seen + 5),
    ).toMatchObject({ reason: 'STALE_VERSION' });
  });
  it('two writers racing on the same version: exactly one wins', () => {
    const r = fullRoom();
    const base = [...r.events];
    const v = base.length;
    const a = executeCommand(
      base,
      { type: 'commit-decision', decisionId: 'check-changes' },
      { actor: OWNER, at: at(50), expectedVersion: v },
    );
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = executeCommand(
      a.events,
      { type: 'propose', proposalId: 'late', decisionId: 'check-changes', rationale: '' },
      { actor: ENG, at: at(51), expectedVersion: v },
    );
    expect(b).toMatchObject({ ok: false, reason: 'STALE_VERSION' });
  });
  it('does not mutate the input log', () => {
    const r = fullRoom();
    const copy = JSON.stringify(r.events);
    executeCommand(
      r.events,
      { type: 'close' },
      { actor: OWNER, at: at(99), expectedVersion: r.version },
    );
    expect(JSON.stringify(r.events)).toBe(copy);
  });
});

describe('invites', () => {
  it('never stores or emits the token, only a room-bound hash', () => {
    const r = new Room();
    const t = r.invite('observer', 'a');
    const json = JSON.stringify(r.events) + JSON.stringify(r.state);
    expect(json).not.toContain(t);
    expect(r.state.invites[0]?.tokenHash).toBe(hashInviteToken('room-1', t));
  });
  it('is single-use', () => {
    const r = new Room();
    const t = r.invite('observer', 'a');
    r.do(OBS, { type: 'join', token: t });
    expect(r.try('acc-other', { type: 'join', token: t })).toMatchObject({
      reason: 'INVITE_INVALID',
    });
  });
  it('expires', () => {
    const r = new Room();
    const t = r.invite('observer', 'a', at(3));
    r.clock = 3;
    expect(r.try(OBS, { type: 'join', token: t })).toMatchObject({ reason: 'INVITE_INVALID' });
  });
  it('cannot be used in another room', () => {
    const a = new Room('room-a');
    const b = new Room('room-b');
    const t = a.invite('observer', 'a');
    expect(b.try(OBS, { type: 'join', token: t })).toMatchObject({ reason: 'INVITE_INVALID' });
  });
  it('is void once revoked and unknown tokens are rejected the same way', () => {
    const r = new Room();
    const t = r.invite('observer', 'a');
    r.do(OWNER, { type: 'revoke-invite', inviteId: 'inv-a' });
    expect(r.try(OBS, { type: 'join', token: t })).toMatchObject({ reason: 'INVITE_INVALID' });
    expect(r.try(OBS, { type: 'join', token: token('zzz') })).toMatchObject({
      reason: 'INVITE_INVALID',
    });
  });
  it('rejects weak tokens, commander invites, long expiry and duplicate ids', () => {
    const r = new Room();
    expect(
      r.try(OWNER, {
        type: 'issue-invite',
        inviteId: 'w',
        token: 'short',
        role: 'observer',
        expiresAt: at(60),
      }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    expect(
      r.try(OWNER, {
        type: 'issue-invite',
        inviteId: 'w',
        token: token('w'),
        role: 'incident-commander',
        expiresAt: at(60),
      }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    expect(
      r.try(OWNER, {
        type: 'issue-invite',
        inviteId: 'w',
        token: token('w'),
        role: 'observer',
        expiresAt: at(25 * 60),
      }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    r.invite('observer', 'd');
    expect(
      r.try(OWNER, {
        type: 'issue-invite',
        inviteId: 'inv-d',
        token: token('d2'),
        role: 'observer',
        expiresAt: at(60),
      }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
  });
  it('an active participant cannot join twice', () => {
    const r = new Room();
    r.join(ENG, 'engineering-responder');
    expect(r.try(ENG, { type: 'join', token: r.invite('observer', 'again') })).toMatchObject({
      reason: 'INVALID_STATE',
    });
  });
  it('rejects every command after the room expires, except close', () => {
    const r = new Room();
    r.clock = 8 * 60;
    expect(r.try(OWNER, { type: 'start' })).toMatchObject({ reason: 'ROOM_EXPIRED' });
    expect(r.try(OWNER, { type: 'close' }).ok).toBe(true);
    expect(r.try(OWNER, { type: 'close' })).toMatchObject({ reason: 'ROOM_CLOSED' });
  });
});

describe('commander handoff', () => {
  it('moves command and swaps roles; only the new commander commits', () => {
    const r = fullRoom();
    expect(r.try(ENG, { type: 'hand-off-command', to: ENG })).toMatchObject({
      reason: 'FORBIDDEN',
    });
    r.do(OWNER, { type: 'hand-off-command', to: ENG });
    const s = r.state;
    expect(s.commander).toBe(ENG);
    expect(s.participants.find((p) => p.accountId === OWNER)?.role).toBe('engineering-responder');
    expect(s.participants.filter((p) => p.role === 'incident-commander')).toHaveLength(1);
    expect(r.try(OWNER, { type: 'commit-decision', decisionId: 'check-changes' })).toMatchObject({
      reason: 'FORBIDDEN',
    });
    r.do(ENG, { type: 'commit-decision', decisionId: 'check-changes' });
    expect(r.state.decisions[0]?.actor).toBe(ENG);
  });
  it('the owner can reclaim command; the commander cannot leave without handing off', () => {
    const r = fullRoom();
    r.do(OWNER, { type: 'hand-off-command', to: SEC });
    expect(r.try(SEC, { type: 'leave' })).toMatchObject({ reason: 'INVALID_STATE' });
    r.do(OWNER, { type: 'hand-off-command', to: OWNER });
    expect(r.state.commander).toBe(OWNER);
    r.do(SEC, { type: 'leave' });
    expect(r.try(SEC, { type: 'communicate', kind: 'status-update', text: 'x' })).toMatchObject({
      reason: 'NOT_PARTICIPANT',
    });
    expect(r.try(OWNER, { type: 'hand-off-command', to: SEC })).toMatchObject({
      reason: 'NOT_PARTICIPANT',
    });
  });
});

describe('replay determinism and reconnect', () => {
  it('the team session equals a solo replay of the committed decisions', () => {
    const r = fullRoom();
    playOptimal(r);
    const s = r.state;
    expect(s.status).toBe('debrief');
    const solo = replaySession(scenario, OPTIMAL, 'room-1', s.startedAt!);
    expect(s.session).toEqual(solo);
    expect(evaluateSession(scenario, solo).metCount).toBe(4);
  });
  it('rebuilding any prefix gives the state that was live at that version', () => {
    const r = fullRoom();
    const live: string[] = [];
    const orig = r.do.bind(r);
    r.do = (a, c) => {
      const res = orig(a, c);
      live.push(JSON.stringify(res.state));
      return res;
    };
    playOptimal(r);
    const base = r.events.length - live.length;
    live.forEach((json, i) =>
      expect(JSON.stringify(rebuildRoom(r.events.slice(0, base + i + 1)))).toBe(json),
    );
    expect(JSON.stringify(rebuildRoom(JSON.parse(JSON.stringify(r.events))))).toBe(
      JSON.stringify(r.state),
    );
  });
  it('rejects a log with an injected event the engine would refuse', () => {
    const r = fullRoom();
    const forged = {
      seq: r.version + 1,
      at: at(90),
      actor: OBS,
      type: 'decision-committed',
      stepId: 'detect',
      decisionId: 'bypass-sso',
      proposalId: null,
    } as CrisisEvent;
    expect(() => rebuildRoom([...r.events, forged])).toThrow(CrisisLogError);
    const gap = { ...forged, actor: OWNER, seq: r.version + 2 } as CrisisEvent;
    expect(() => rebuildRoom([...r.events, gap])).toThrow(CrisisLogError);
  });
});

describe('role-scoped views', () => {
  it('scopes evidence and options by role', () => {
    const r = fullRoom();
    const s = r.state;
    const v = (who: string) => {
      const res = roleView(s, who);
      if (!res.ok) throw new Error('no view');
      return res.view;
    };
    expect(v(OWNER).evidence).toHaveLength(scenario.evidence.length);
    expect(v(OBS).evidence).toEqual([]);
    expect(v(OBS).options).toEqual([]);
    expect(v(OBS).can).toEqual({ propose: false, commit: false, communicate: [], manage: false });
    expect(
      v(COMMS).evidence.every((e) => e.kind === 'jsm-service' || e.kind === 'scenario-rule'),
    ).toBe(true);
    expect(v(SEC).evidence.some((e) => e.kind === 'jsm-service')).toBe(false);
    expect(v(ENG).options.length).toBeGreaterThan(1);
    expect(v(ENG).can.commit).toBe(false);
    expect(v(OWNER).can.commit).toBe(true);
    expect(v(OWNER).can.manage).toBe(true);
    for (const who of [OWNER, ENG, SEC, COMMS, OBS]) {
      expect(v(who).step?.id).toBe('detect');
      expect(JSON.stringify(v(who))).not.toContain('tokenHash');
    }
  });
  it('tracks objective progress live', () => {
    const r = fullRoom();
    playOptimal(r);
    const res = roleView(r.state, OBS);
    expect(res.ok && res.view.objectives.every((o) => o.progress === 'met')).toBe(true);
  });
});

describe('debrief and after-action report', () => {
  it('attributes contributions per role from the log', () => {
    const r = fullRoom();
    playOptimal(r);
    const d = buildDebrief(r.events);
    const c = (id: string) => d.contributions.find((x) => x.accountId === id)!;
    expect(c(OWNER)).toMatchObject({ decisionsCommitted: 3, roles: ['incident-commander'] });
    expect(c(ENG)).toMatchObject({ proposals: 1, proposalsAdopted: 1, statusUpdates: 1 });
    expect(c(SEC)).toMatchObject({ proposals: 1, proposalsAdopted: 0 });
    expect(c(COMMS)).toMatchObject({ proposals: 1, proposalsAdopted: 1, stakeholderNotices: 1 });
    expect(c(OBS)).toMatchObject({ proposals: 0, decisionsCommitted: 0, roles: ['observer'] });
    expect(d.decisions.map((x) => x.decisionId)).toEqual(OPTIMAL);
    expect(d.evaluation.metCount).toBe(4);
    expect(d.timeline).toHaveLength(r.events.length);
    expect(
      d.timeline.filter((t) => t.type === 'decision-committed').map((t) => t.atMinute),
    ).toEqual(d.decisions.map((x) => x.atMinute));
    expect(d.evidence.map((e) => e.id)).toEqual(['ev-change', 'ev-runbook-review', 'ev-service']);
  });
  it('records role history across a handoff', () => {
    const r = fullRoom();
    r.do(OWNER, { type: 'hand-off-command', to: ENG });
    r.do(ENG, { type: 'commit-decision', decisionId: 'check-changes' });
    r.do(ENG, { type: 'commit-decision', decisionId: 'notify-now' });
    r.do(ENG, { type: 'commit-decision', decisionId: 'activate-nimbus' });
    const d = buildDebrief(r.events);
    expect(d.contributions.find((x) => x.accountId === OWNER)?.roles).toEqual([
      'incident-commander',
      'engineering-responder',
    ]);
    expect(d.contributions.find((x) => x.accountId === ENG)?.roles).toEqual([
      'engineering-responder',
      'incident-commander',
    ]);
  });
  it('produces a verifiable audit record and a history submission', () => {
    const r = fullRoom();
    playOptimal(r);
    const report = buildAfterActionReport(r.events);
    expect(verifyAuditRecord(report.audit, scenario)).toEqual({ ok: true });
    expect(report.submission.decisionIds).toEqual(OPTIMAL);
    expect(report.submission.sessionId).toBe('room-1');
    expect(report.submission.scenarioFingerprint).toBe(report.audit.scenarioFingerprint);
  });
  it('refuses a debrief before the session completes', () => {
    expect(() => buildDebrief(fullRoom().events)).toThrow(CrisisLogError);
  });
  it('status updates remain allowed in debrief, stakeholder notices and proposals do not', () => {
    const r = fullRoom();
    playOptimal(r);
    expect(r.try(ENG, { type: 'communicate', kind: 'status-update', text: 'lesson' }).ok).toBe(
      true,
    );
    expect(
      r.try(COMMS, { type: 'communicate', kind: 'stakeholder-notice', text: 'x' }),
    ).toMatchObject({ reason: 'INVALID_STATE' });
    r.do(OWNER, { type: 'close' });
    expect(r.try(ENG, { type: 'communicate', kind: 'status-update', text: 'x' })).toMatchObject({
      reason: 'ROOM_CLOSED',
    });
  });
});

describe('isolation and bounds', () => {
  it('rooms do not share state', () => {
    const a = fullRoom();
    const b = new Room('room-2');
    a.do(ENG, { type: 'propose', proposalId: 'p1', decisionId: 'check-changes', rationale: '' });
    expect(b.state.participants.map((p) => p.accountId)).toEqual([OWNER]);
    expect(b.try(ENG, { type: 'communicate', kind: 'status-update', text: 'x' })).toMatchObject({
      reason: 'NOT_PARTICIPANT',
    });
    expect(b.state.proposals).toEqual([]);
  });
  it('caps message length', () => {
    const r = fullRoom();
    expect(
      r.try(ENG, { type: 'communicate', kind: 'status-update', text: 'x'.repeat(1001) }),
    ).toMatchObject({ reason: 'INVALID_INPUT' });
    expect(r.try(ENG, { type: 'communicate', kind: 'status-update', text: '   ' })).toMatchObject({
      reason: 'INVALID_INPUT',
    });
  });
  it('caps the event log size', () => {
    const r = fullRoom();
    let full = null;
    for (let i = 0; i < MAX_EVENTS + 5; i++) {
      const res = r.try(ENG, { type: 'communicate', kind: 'status-update', text: 'x'.repeat(400) });
      if (!res.ok) {
        full = res;
        break;
      }
    }
    expect(full).toMatchObject({ reason: 'LOG_FULL' });
    expect(r.events.length).toBeLessThanOrEqual(MAX_EVENTS);
  });
  it('caps open invites', () => {
    const r = new Room();
    for (let i = 0; i < 20; i++) r.invite('observer', `n${i}`);
    expect(
      r.try(OWNER, {
        type: 'issue-invite',
        inviteId: 'x21',
        token: token('x21'),
        role: 'observer',
        expiresAt: at(60),
      }),
    ).toMatchObject({ reason: 'ROOM_FULL' });
  });
});
