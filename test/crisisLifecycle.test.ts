import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../shared/agents/storage';
import { ROLE_EVIDENCE } from '../shared/crisis';
import type {
  CrisisClientCommand,
  CrisisRole,
  CrisisRoomResponse,
  CrisisRoomSnapshot,
  CrisisViewResponse,
} from '../shared/crisis';
import { HistoryStore } from '../shared/history';
import { authBackupRetiredScenario } from '../shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '../shared/simulation/scenarios/authBackupRetiredRemediation';
import { createCrisisResolvers, parseClientCommand, roomKey } from '../src/crisis/resolvers';

/**
 * M7 end-to-end through the resolvers over the in-memory storage adapter: five
 * roles, role-scoped information, proposals, commander approval, messages,
 * hand-off, reconnect and replay, debrief and history. Automated tests only;
 * this does not show that two real users can collaborate.
 */
const INSTALL = 'ari:cloud:ecosystem::installation/test-1';
const A = {
  owner: 'acc-owner',
  eng: 'acc-eng',
  sec: 'acc-sec',
  comms: 'acc-comms',
  obs: 'acc-obs',
};
const ctx = (accountId: string, installContext = INSTALL) => ({ accountId, installContext });
const DEMO = { kind: 'demo', scenarioId: authBackupRetiredScenario.id } as const;

function setup() {
  const storage = new InMemoryStorage();
  const history = new InMemoryStorage();
  let clock = Date.parse('2026-11-11T10:00:00.000Z');
  let n = 0;
  const resolvers = createCrisisResolvers({
    crisisStorage: () => storage,
    historyStorage: () => history,
    trustedScenario: async () => ({
      ok: true,
      trusted: {
        scenario: authBackupRetiredScenario,
        remediation: authBackupRetiredRemediation,
        provenance: null,
      },
    }),
    now: () => new Date((clock += 1000)),
    random: (bytes) => `r${String(++n).padStart(4, '0')}`.padEnd(Math.ceil((bytes * 4) / 3), 'x'),
  });
  return { resolvers, storage, history };
}

function ok<T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`call failed: ${JSON.stringify(r.error)}`);
  return r.data;
}
function snap(r: CrisisRoomResponse | CrisisViewResponse): CrisisRoomSnapshot {
  if (r.status !== 'OK') throw new Error(`expected OK, got ${JSON.stringify(r)}`);
  return r.room;
}

async function fullRoom() {
  const env = setup();
  const { resolvers } = env;
  const first = snap(
    ok(await resolvers.crisisOpenRoom({ payload: { source: DEMO }, context: ctx(A.owner) })),
  );
  const roomId = first.view.roomId;
  const run = async (who: string, version: number, command: CrisisClientCommand) =>
    ok(
      await resolvers.crisisCommand({
        payload: { roomId, expectedVersion: version, command },
        context: ctx(who),
      }),
    );
  const view = async (who: string) =>
    ok(await resolvers.crisisView({ payload: { roomId }, context: ctx(who) }));
  let version = first.view.version;
  const joins: [string, CrisisRole][] = [
    [A.eng, 'engineering-responder'],
    [A.sec, 'security-responder'],
    [A.comms, 'communications-lead'],
    [A.obs, 'observer'],
  ];
  for (const [who, role] of joins) {
    const inv = ok(
      await resolvers.crisisInviteToken({
        payload: { roomId, expectedVersion: version, role },
        context: ctx(A.owner),
      }),
    );
    if (inv.status !== 'OK') throw new Error(JSON.stringify(inv));
    const joined = snap(await run(who, 0, { type: 'join', token: inv.invite.token }));
    version = joined.view.version;
  }
  return {
    ...env,
    roomId,
    run,
    view,
    version: () => version,
    setVersion: (v: number) => (version = v),
  };
}

describe('crisis lifecycle over the in-memory adapter', () => {
  it('seats all five roles and scopes evidence per role', async () => {
    const t = await fullRoom();
    const roles = new Map<string, CrisisRole>();
    for (const who of Object.values(A)) {
      const s = snap(await t.view(who));
      roles.set(who, s.view.role);
      const allowed = new Set<string>(ROLE_EVIDENCE[s.view.role]);
      expect(s.view.evidence.every((e) => allowed.has(e.kind))).toBe(true);
    }
    expect([...roles.values()].sort()).toEqual(
      [
        'communications-lead',
        'engineering-responder',
        'incident-commander',
        'observer',
        'security-responder',
      ].sort(),
    );
    const obs = snap(await t.view(A.obs));
    expect(obs.view.evidence).toEqual([]);
    expect(obs.view.can).toEqual({ propose: false, commit: false, communicate: [], manage: false });
  });

  it('never serves invite hashes, tokens or the raw log to any participant', async () => {
    const t = await fullRoom();
    for (const who of Object.values(A)) {
      const text = JSON.stringify(await t.view(who));
      expect(text).not.toMatch(/inviteHash|tokenHash|sf-crisis-invite|"events"|"payload"/);
    }
  });

  it('runs proposals, commander approval, messages, hand-off, then debrief and history', async () => {
    const t = await fullRoom();
    let v = snap(await t.run(A.owner, t.version(), { type: 'start' })).view.version;
    const first = snap(await t.view(A.eng)).view.options[0]!.id;
    // comms lead cannot see decision options as a proposer-less role? They may propose; observer may not.
    const proposed = snap(
      await t.run(A.eng, v, { type: 'propose', decisionId: first, rationale: 'Fastest path' }),
    );
    expect(snap(await t.view(A.obs)).view.openProposals).toHaveLength(1);
    v = proposed.view.version;
    const stakeholder = snap(
      await t.run(A.comms, v, {
        type: 'communicate',
        kind: 'stakeholder-notice',
        text: 'Sign-in is degraded; update in 15 minutes.',
      }),
    );
    expect(stakeholder.view.communications.at(-1)?.kind).toBe('stakeholder-notice');
    expect(
      await t.run(A.sec, stakeholder.view.version, {
        type: 'communicate',
        kind: 'stakeholder-notice',
        text: 'x',
      }),
    ).toMatchObject({ status: 'REJECTED', reason: 'FORBIDDEN' });
    const proposalId = proposed.view.openProposals[0]!.proposalId;
    const committed = snap(
      await t.run(A.owner, stakeholder.view.version, {
        type: 'commit-decision',
        decisionId: first,
        proposalId,
      }),
    );
    expect(committed.view.openProposals).toHaveLength(0);
    // Hand-off to the engineering responder, who then commits to completion.
    let cur = snap(
      await t.run(A.owner, committed.view.version, {
        type: 'hand-off-command',
        toParticipantId: snap(await t.view(A.eng)).view.viewer,
      }),
    );
    expect(cur.view.commander).toBe(snap(await t.view(A.eng)).view.viewer);
    while (cur.view.status === 'running') {
      const viewer = A.eng; // commander since the hand-off
      const mine = snap(await t.view(viewer));
      cur = snap(
        await t.run(viewer, mine.view.version, {
          type: 'commit-decision',
          decisionId: mine.view.options[0]!.id,
        }),
      );
    }
    expect(cur.view.status).toBe('debrief');
    const owners = new Set(cur.debrief?.contributions.map((c) => c.participantId));
    expect(owners.has(snap(await t.view(A.owner)).view.viewer)).toBe(true);
    expect(owners.has(snap(await t.view(A.eng)).view.viewer)).toBe(true);
    // Reconnect: a fresh read equals what the last writer saw, and an unchanged version is cheap.
    const again = snap(await t.view(A.sec));
    expect(again.view.version).toBe(cur.view.version);
    expect(again.timeline).toEqual(cur.timeline);
    // History integration: only the owner saves, and the run is listed for them.
    const saved = ok(
      await t.resolvers.crisisSaveDebrief({
        payload: { roomId: t.roomId },
        context: ctx(A.owner),
      }),
    );
    expect(saved.status).toBe('SAVED');
    const list = await new HistoryStore({ storage: t.history }).listRuns({
      installation: INSTALL,
      accountId: A.owner,
    });
    expect(list.status).toBe('OK');
  });

  it('isolates rooms by installation and room id', async () => {
    const t = await fullRoom();
    const other = ok(
      await t.resolvers.crisisView({
        payload: { roomId: t.roomId },
        context: ctx(A.eng, 'ari:cloud:ecosystem::installation/other'),
      }),
    );
    expect(other.status).not.toBe('OK');
  });

  it('is deterministic: replaying the same commands on a fresh adapter gives the same timeline', async () => {
    const a = await fullRoom();
    const b = await fullRoom();
    const sa = snap(await a.view(A.owner));
    const sb = snap(await b.view(A.owner));
    expect(sa.timeline.map((e) => e.summary)).toEqual(sb.timeline.map((e) => e.summary));
  });

  describe('participant identifiers', () => {
    const ids = Object.values(A);
    const leaks = (value: unknown) => {
      const text = JSON.stringify(value);
      return ids.filter((id) => text.includes(id));
    };

    it('no account id appears in any client payload, for any role, through the whole run', async () => {
      const t = await fullRoom();
      const seen: unknown[] = [];
      const everyone = async () => {
        for (const who of ids) seen.push(await t.view(who));
      };
      await everyone();
      const engPid = snap(await t.view(A.eng)).view.viewer;
      const secPid = snap(await t.view(A.sec)).view.viewer;
      seen.push(
        await t.run(A.owner, t.version(), {
          type: 'assign-role',
          participantId: secPid,
          role: 'observer',
        }),
      );
      let cur = snap(await t.view(A.owner));
      seen.push(await t.run(A.owner, cur.view.version, { type: 'start' }));
      cur = snap(await t.view(A.owner));
      const first = snap(await t.view(A.eng)).view.options[0]!.id;
      seen.push(
        await t.run(A.eng, cur.view.version, {
          type: 'propose',
          decisionId: first,
          rationale: 'r',
        }),
      );
      cur = snap(await t.view(A.owner));
      seen.push(
        await t.run(A.owner, cur.view.version, {
          type: 'hand-off-command',
          toParticipantId: engPid,
        }),
      );
      await everyone();
      for (let guard = 0; guard < 20; guard++) {
        const c = snap(await t.view(A.eng));
        if (c.view.status !== 'running') break;
        seen.push(
          await t.run(A.eng, c.view.version, {
            type: 'commit-decision',
            decisionId: c.view.options[0]!.id,
          }),
        );
      }
      await everyone();
      const last = snap(await t.view(A.obs));
      expect(last.debrief).not.toBeNull();
      expect(leaks(seen)).toEqual([]);
      expect(JSON.stringify(seen)).not.toMatch(/acc-/);
    });

    it('opaque ids are stable in a room, differ between rooms, and show you/roles/proposer', async () => {
      const a = await fullRoom();
      const va = snap(await a.view(A.eng)).view;
      expect(snap(await a.view(A.eng)).view.viewer).toBe(va.viewer);
      // A second room with the same people gets different ids (unlinkable across rooms).
      const other = snap(
        ok(await a.resolvers.crisisOpenRoom({ payload: { source: DEMO }, context: ctx(A.eng) })),
      );
      expect(other.view.viewer).not.toBe(va.viewer);
      expect(va.viewer).toMatch(/^p_[A-Za-z0-9_-]{16}$/);
      expect(va.participants.find((p) => p.participantId === va.viewer)?.role).toBe(
        'engineering-responder',
      );
      expect(va.participants.find((p) => p.participantId === va.commander)?.role).toBe(
        'incident-commander',
      );
    });

    it('refuses a raw account id or unknown participant as a command target', async () => {
      const t = await fullRoom();
      const parsed = parseClientCommand({
        type: 'assign-role',
        participantId: A.eng,
        role: 'observer',
      });
      expect(parsed.ok).toBe(false);
      const unknown = await t.run(A.owner, t.version(), {
        type: 'assign-role',
        participantId: 'p_AAAAAAAAAAAAAAAA',
        role: 'observer',
      });
      expect(unknown).toMatchObject({ status: 'REJECTED', reason: 'INVALID_INPUT' });
    });

    it('rooms stored before aliasKey existed still serve opaque ids', async () => {
      const t = await fullRoom();
      const key = roomKey(INSTALL, t.roomId);
      const stored = await t.storage.get<{ aliasKey?: string }>(key);
      delete stored!.value.aliasKey;
      await t.storage.set(key, stored!.value, stored!.version);
      const v = snap(await t.view(A.eng));
      expect(leaks(v)).toEqual([]);
      expect(v.view.viewer).toMatch(/^p_/);
    });
  });
});
