import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../shared/agents/storage';
import { HISTORY_NOT_ENABLED } from '../shared/api';
import { CRISIS_NOT_ENABLED, hashInviteToken } from '../shared/crisis';
import type {
  CrisisClientCommand,
  CrisisInviteResponse,
  CrisisRoomResponse,
  CrisisRoomSnapshot,
  CrisisViewResponse,
} from '../shared/crisis';
import { HistoryStore } from '../shared/history';
import { authBackupRetiredScenario } from '../shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '../shared/simulation/scenarios/authBackupRetiredRemediation';
import { createCrisisResolvers, parseClientCommand, roomKey } from '../src/crisis/resolvers';

const INSTALL = 'ari:cloud:ecosystem::installation/test-1';
const OWNER = 'acc-owner';
const ENG = 'acc-eng';
const OBS = 'acc-obs';
const ctx = (accountId: string, installContext = INSTALL) => ({ accountId, installContext });
const DEMO = { kind: 'demo', scenarioId: authBackupRetiredScenario.id } as const;

function setup(opts: { storage?: InMemoryStorage | null; history?: InMemoryStorage | null } = {}) {
  const storage = opts.storage === undefined ? new InMemoryStorage() : opts.storage;
  const history = opts.history === undefined ? null : opts.history;
  let clock = Date.parse('2026-11-11T10:00:00.000Z');
  let n = 0;
  const resolvers = createCrisisResolvers({
    crisisStorage: () => storage,
    historyStorage: () => history,
    trustedScenario: async (source) =>
      source.kind === 'demo'
        ? {
            ok: true,
            trusted: {
              scenario: authBackupRetiredScenario,
              remediation: authBackupRetiredRemediation,
              provenance: null,
            },
          }
        : { ok: false, result: { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } } },
    now: () => new Date((clock += 1000)),
    random: (bytes) => `r${String(++n).padStart(4, '0')}`.padEnd(Math.ceil((bytes * 4) / 3), 'x'),
  });
  return { resolvers, storage };
}

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`call failed: ${JSON.stringify(r.error)}`);
  return r.data;
}

function room(
  r: CrisisRoomResponse | CrisisViewResponse | CrisisInviteResponse,
): CrisisRoomSnapshot {
  if (r.status !== 'OK') throw new Error(`expected OK, got ${JSON.stringify(r)}`);
  return r.room;
}

async function created() {
  const env = setup();
  const res = ok(
    await env.resolvers.crisisOpenRoom({ payload: { source: DEMO }, context: ctx(OWNER) }),
  );
  const snap = room(res);
  return { ...env, storage: env.storage!, roomId: snap.view.roomId, snap };
}

async function invite(
  env: Awaited<ReturnType<typeof created>>,
  role: 'engineering-responder' | 'observer',
  version: number,
) {
  const res = ok(
    await env.resolvers.crisisInviteToken({
      payload: { roomId: env.roomId, expectedVersion: version, role },
      context: ctx(OWNER),
    }),
  );
  if (res.status !== 'OK') throw new Error(JSON.stringify(res));
  return res;
}

const command = (
  env: Awaited<ReturnType<typeof created>>,
  actor: string,
  expectedVersion: number,
  cmd: CrisisClientCommand,
) =>
  env.resolvers
    .crisisCommand({
      payload: { roomId: env.roomId, expectedVersion, command: cmd },
      context: ctx(actor),
    })
    .then(ok);

describe('crisis resolvers: gates', () => {
  it('answers UNAVAILABLE with the plain message when storage is null', async () => {
    const { resolvers } = setup({ storage: null });
    const r = ok(
      await resolvers.crisisOpenRoom({ payload: { source: DEMO }, context: ctx(OWNER) }),
    );
    expect(r).toEqual({ status: 'UNAVAILABLE', detail: CRISIS_NOT_ENABLED });
    const v = ok(
      await resolvers.crisisView({ payload: { roomId: 'a'.repeat(22) }, context: ctx(OWNER) }),
    );
    expect(v.status).toBe('UNAVAILABLE');
  });

  it('needs an identity from the context and never reads one from the payload', async () => {
    const { resolvers } = setup();
    const r = ok(
      await resolvers.crisisOpenRoom({
        payload: { source: DEMO, accountId: OWNER },
        context: {},
      }),
    );
    expect(r.status).toBe('IDENTITY_UNAVAILABLE');
  });

  it('refuses a scenario from the browser and malformed input', async () => {
    const { resolvers } = setup();
    const bad = ok(
      await resolvers.crisisOpenRoom({
        payload: { source: DEMO, scenario: authBackupRetiredScenario },
        context: ctx(OWNER),
      }),
    );
    expect(bad).toMatchObject({ status: 'REJECTED', reason: 'INVALID_INPUT' });
    const badId = ok(
      await resolvers.crisisView({ payload: { roomId: '../x' }, context: ctx(OWNER) }),
    );
    expect(badId).toMatchObject({ status: 'REJECTED', reason: 'INVALID_INPUT' });
    const gen = ok(
      await resolvers.crisisOpenRoom({
        payload: {
          source: {
            kind: 'generated',
            changeKey: 'OPS-1',
            findingId: 'OPS-1:1:1:x',
            restoreTargetMinutes: 30,
            notifyTargetMinutes: 10,
          },
        },
        context: ctx(OWNER),
      }),
    );
    expect(gen).toMatchObject({ status: 'REJECTED', reason: 'SCENARIO_UNAVAILABLE' });
  });

  it('parses only known command shapes', () => {
    expect(parseClientCommand({ type: 'issue-invite', token: 'x'.repeat(40) }).ok).toBe(false);
    expect(parseClientCommand({ type: 'join', token: 'short' }).ok).toBe(false);
    expect(parseClientCommand({ type: 'communicate', kind: 'tweet', text: 'x' }).ok).toBe(false);
    expect(parseClientCommand({ type: 'propose', decisionId: 'd1', rationale: 'r' }).ok).toBe(true);
  });
});

describe('crisis resolvers: rooms', () => {
  it('creates a room keyed by installation, owner as commander', async () => {
    const env = await created();
    expect(env.snap.view.role).toBe('incident-commander');
    expect(env.snap.isOwner).toBe(true);
    expect(env.snap.synthetic).toBe(true);
    expect(env.storage.keys()).toEqual([roomKey(INSTALL, env.roomId)]);
  });

  it('denies a non-participant view, same answer as an unknown room', async () => {
    const env = await created();
    const v = ok(
      await env.resolvers.crisisView({ payload: { roomId: env.roomId }, context: ctx(ENG) }),
    );
    const missing = ok(
      await env.resolvers.crisisView({ payload: { roomId: 'z'.repeat(22) }, context: ctx(ENG) }),
    );
    expect(v).toEqual(missing);
    expect(v).toMatchObject({ status: 'REJECTED', reason: 'NOT_PARTICIPANT' });
    // Another installation never sees the room.
    const other = ok(
      await env.resolvers.crisisView({
        payload: { roomId: env.roomId },
        context: ctx(OWNER, 'other'),
      }),
    );
    expect(other).toMatchObject({ reason: 'NOT_PARTICIPANT' });
  });

  it('issues an invite token once and stores only its hash', async () => {
    const env = await created();
    const inv = await invite(env, 'engineering-responder', 1);
    expect(inv.invite.token.length).toBeGreaterThanOrEqual(32);
    const stored = JSON.stringify(await env.storage.get(roomKey(INSTALL, env.roomId)));
    expect(stored).not.toContain(inv.invite.token);
    expect(stored).toContain(hashInviteToken(env.roomId, inv.invite.token));
    expect(inv.room.invites).toEqual([
      expect.objectContaining({ state: 'open', role: 'engineering-responder' }),
    ]);
    expect(JSON.stringify(inv.room)).not.toContain(hashInviteToken(env.roomId, inv.invite.token));
  });

  it('lets a user join once; a reused invite is INVITE_INVALID', async () => {
    const env = await created();
    const inv = await invite(env, 'engineering-responder', 1);
    const joined = room(await command(env, ENG, 0, { type: 'join', token: inv.invite.token }));
    expect(joined.view.role).toBe('engineering-responder');
    expect(joined.isOwner).toBe(false);
    expect(joined.invites).toEqual([]);
    const reuse = await command(env, OBS, 0, { type: 'join', token: inv.invite.token });
    expect(reuse).toMatchObject({ status: 'REJECTED', reason: 'INVITE_INVALID' });
  });

  it('two users racing at the same version: exactly one write wins', async () => {
    const env = await created();
    const inv = await invite(env, 'engineering-responder', 1);
    const joined = room(await command(env, ENG, 0, { type: 'join', token: inv.invite.token }));
    room(await command(env, OWNER, joined.view.version, { type: 'start' }));
    const v = joined.view.version + 1;
    const [a, b] = await Promise.all([
      command(env, OWNER, v, { type: 'communicate', kind: 'status-update', text: 'A' }),
      command(env, ENG, v, { type: 'communicate', kind: 'status-update', text: 'B' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['OK', 'REJECTED']);
    const loser = a.status === 'REJECTED' ? a : b;
    expect(loser).toMatchObject({ reason: 'STALE_VERSION' });
    const view = room(
      ok(await env.resolvers.crisisView({ payload: { roomId: env.roomId }, context: ctx(ENG) })),
    );
    expect(view.view.communications).toHaveLength(1);
    expect(view.view.version).toBe(v + 1);
  });

  it('rejects a stale expectedVersion', async () => {
    const env = await created();
    await invite(env, 'observer', 1);
    const r = await command(env, OWNER, 1, { type: 'start' });
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'STALE_VERSION' });
  });

  it('answers UNCHANGED for a known version and rebuilds on read', async () => {
    const env = await created();
    const r = ok(
      await env.resolvers.crisisView({
        payload: { roomId: env.roomId, knownVersion: 1 },
        context: ctx(OWNER),
      }),
    );
    expect(r).toEqual({ status: 'UNCHANGED', version: 1 });
  });

  it('refuses to serve a tampered log', async () => {
    const env = await created();
    const key = roomKey(INSTALL, env.roomId);
    const stored = (await env.storage.get<{ events: { actor: string }[] }>(key))!;
    stored.value.events[0]!.actor = ENG;
    (stored.value.events[0] as unknown as { scenarioFingerprint: string }).scenarioFingerprint =
      'x';
    await env.storage.set(key, stored.value, stored.version);
    const r = ok(
      await env.resolvers.crisisView({ payload: { roomId: env.roomId }, context: ctx(OWNER) }),
    );
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'ROOM_INVALID' });
  });

  it('enforces roles: observer cannot propose, responder cannot commit; commander adopts', async () => {
    const env = await created();
    const i1 = await invite(env, 'engineering-responder', 1);
    let v = room(await command(env, ENG, 0, { type: 'join', token: i1.invite.token })).view.version;
    const i2 = await invite(env, 'observer', v);
    const obs = room(await command(env, OBS, 0, { type: 'join', token: i2.invite.token }));
    expect(obs.view.options).toEqual([]);
    v = room(await command(env, OWNER, obs.view.version, { type: 'start' })).view.version;
    const engView = room(
      ok(await env.resolvers.crisisView({ payload: { roomId: env.roomId }, context: ctx(ENG) })),
    );
    const decisionId = engView.view.options[0]!.id;
    expect(
      await command(env, OBS, v, { type: 'propose', decisionId, rationale: 'x' }),
    ).toMatchObject({
      reason: 'FORBIDDEN',
    });
    expect(await command(env, ENG, v, { type: 'commit-decision', decisionId })).toMatchObject({
      reason: 'FORBIDDEN',
    });
    const proposed = room(
      await command(env, ENG, v, { type: 'propose', decisionId, rationale: 'Fast' }),
    );
    const proposalId = proposed.view.openProposals[0]!.proposalId;
    const committed = room(
      await command(env, OWNER, proposed.view.version, {
        type: 'commit-decision',
        decisionId,
        proposalId,
      }),
    );
    expect(committed.view.decisions[0]).toMatchObject({ actor: committed.view.viewer, proposalId });
    expect(committed.timeline.at(-1)!.summary).toContain('adopted proposal');
  });
});

describe('crisis resolvers: debrief', () => {
  async function finished(history: InMemoryStorage | null) {
    const env = setup({ history });
    const snap = room(
      ok(await env.resolvers.crisisOpenRoom({ payload: { source: DEMO }, context: ctx(OWNER) })),
    );
    const roomId = snap.view.roomId;
    let current = room(
      ok(
        await env.resolvers.crisisCommand({
          payload: { roomId, expectedVersion: 1, command: { type: 'start' } },
          context: ctx(OWNER),
        }),
      ),
    );
    while (current.view.status === 'running') {
      current = room(
        ok(
          await env.resolvers.crisisCommand({
            payload: {
              roomId,
              expectedVersion: current.view.version,
              command: { type: 'commit-decision', decisionId: current.view.options[0]!.id },
            },
            context: ctx(OWNER),
          }),
        ),
      );
    }
    return { ...env, roomId, current };
  }

  it('serves the debrief once the session completes', async () => {
    const { current } = await finished(null);
    expect(current.view.status).toBe('debrief');
    expect(current.debrief?.contributions[0]).toMatchObject({ participantId: current.view.viewer });
  });

  it('save says history is not enabled when history storage is null', async () => {
    const { resolvers, roomId } = await finished(null);
    const r = ok(await resolvers.crisisSaveDebrief({ payload: { roomId }, context: ctx(OWNER) }));
    expect(r).toEqual({ status: 'UNAVAILABLE', detail: HISTORY_NOT_ENABLED });
  });

  it('saves to the owner history through saveRun when history storage exists', async () => {
    const history = new InMemoryStorage();
    const { resolvers, roomId } = await finished(history);
    const r = ok(await resolvers.crisisSaveDebrief({ payload: { roomId }, context: ctx(OWNER) }));
    expect(r.status).toBe('SAVED');
    const list = await new HistoryStore({ storage: history }).listRuns({
      installation: INSTALL,
      accountId: OWNER,
    });
    expect(list.status).toBe('OK');
  });

  it('only the owner can save', async () => {
    const { resolvers, roomId } = await finished(new InMemoryStorage());
    const r = ok(await resolvers.crisisSaveDebrief({ payload: { roomId }, context: ctx(ENG) }));
    expect(r.status).toBe('REJECTED');
  });
});

describe('crisis resolvers: status probe and timeline', () => {
  it('reports AVAILABLE only when storage and identity exist', async () => {
    expect(ok(await setup().resolvers.crisisStatus({ context: ctx(OWNER) }))).toEqual({
      status: 'AVAILABLE',
    });
    expect(
      ok(await setup({ storage: null }).resolvers.crisisStatus({ context: ctx(OWNER) })),
    ).toEqual({ status: 'UNAVAILABLE', detail: CRISIS_NOT_ENABLED });
  });

  it('timeline summaries name roles, never account ids or tokens', async () => {
    const env = await created();
    const inv = await invite(env, 'engineering-responder', 1);
    const joined = room(await command(env, ENG, 0, { type: 'join', token: inv.invite.token }));
    const text = joined.timeline.map((e) => e.summary).join(' ');
    expect(text).toContain('Engineering responder joined.');
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain(ENG);
    expect(text).not.toContain(inv.invite.token);
  });
});
