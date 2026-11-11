import type { ApiResult } from '@shared/api';
import { InMemoryStorage } from '@shared/agents/storage';
import type { CrisisClientCommand, CrisisRole, CrisisRoomResponse } from '@shared/crisis';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import { createCrisisResolvers } from '../../../../src/crisis/resolvers';
import type { PreviewMode } from '../lib/preview';

// DEV PREVIEW ONLY. The real crisis resolvers running in the browser over an
// in-memory store, so the Crisis room can be reviewed on the Vite dev server.
// Imported only behind `import.meta.env.DEV && previewMode`, so it is never in
// the Forge bundle. Nothing here is shared between tabs: it is not a team room.
//
//   ?preview=fixtures                         working rooms, you are the owner
//   &as=preview-eng|preview-obs|…             act as another seeded participant
//   &room=previewlobby00001|previewrunning001|previewdebrief001   seeded rooms
//   &crisis=unavailable                       storage not enabled (the real default)

const INSTALL = 'preview-installation';
const OWNER = 'preview-owner';
const PEOPLE: Record<string, string> = {
  'preview-eng': 'preview-eng',
  'preview-sec': 'preview-sec',
  'preview-comms': 'preview-comms',
  'preview-obs': 'preview-obs',
};

const queued: string[] = [];
function random(bytes: number): string {
  const next = queued.shift();
  if (next) return next;
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const storage = new InMemoryStorage();
const resolvers = createCrisisResolvers({
  crisisStorage: () =>
    new URLSearchParams(window.location.search).get('crisis') === 'unavailable' ? null : storage,
  historyStorage: () => null,
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
      : {
          ok: false,
          result: {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Generated rehearsals need Jira; use the demo.' },
          },
        },
  random,
});

type Fn = keyof typeof resolvers;
const ctx = (accountId: string) => ({ accountId, installContext: INSTALL });

async function as(accountId: string, fn: Fn, payload: object) {
  const r = await (resolvers[fn] as (q: object) => Promise<ApiResult<unknown>>)({
    payload,
    context: ctx(accountId),
  });
  if (!r.ok) throw new Error(`seed ${fn} failed`);
  return r.data as CrisisRoomResponse & { invite?: { token: string } };
}

async function seedRoom(roomId: string, stage: 'lobby' | 'running' | 'debrief') {
  queued.push(roomId);
  let r = await as(OWNER, 'crisisOpenRoom', {
    source: { kind: 'demo', scenarioId: authBackupRetiredScenario.id },
  });
  const version = () => (r.status === 'OK' ? r.room.view.version : 0);
  const join = async (who: string, role: CrisisRole) => {
    const inv = await as(OWNER, 'crisisInviteToken', { roomId, expectedVersion: version(), role });
    r = await as(who, 'crisisCommand', {
      roomId,
      expectedVersion: 0,
      command: { type: 'join', token: inv.invite!.token },
    });
  };
  const cmd = async (who: string, command: CrisisClientCommand) => {
    r = await as(who, 'crisisCommand', { roomId, expectedVersion: version(), command });
  };
  await join('preview-eng', 'engineering-responder');
  await join('preview-comms', 'communications-lead');
  await join('preview-obs', 'observer');
  if (stage === 'lobby') {
    await as(OWNER, 'crisisInviteToken', {
      roomId,
      expectedVersion: version(),
      role: 'security-responder',
    });
    return;
  }
  await cmd(OWNER, { type: 'start' });
  const options = () => (r.status === 'OK' ? r.room.view.options : []);
  const engView = await as('preview-eng', 'crisisView', { roomId });
  const first = engView.status === 'OK' ? engView.room.view.options : [];
  await cmd('preview-eng', {
    type: 'propose',
    decisionId: first[0]!.id,
    rationale: 'The runbook still points at the retired tenant; check the replacement first.',
  });
  await cmd('preview-comms', {
    type: 'communicate',
    kind: 'status-update',
    text: 'Investigating sign-in failures; next update in 15 minutes.',
  });
  if (stage === 'running') {
    await cmd('preview-comms', {
      type: 'propose',
      decisionId: first[1]?.id ?? first[0]!.id,
      rationale: 'Tell customers early while engineering checks the tenant.',
    });
    return;
  }
  const proposal = r.status === 'OK' ? r.room.view.openProposals[0] : undefined;
  await cmd(OWNER, {
    type: 'commit-decision',
    decisionId: proposal!.decisionId,
    proposalId: proposal!.proposalId,
  });
  while (r.status === 'OK' && r.room.view.status === 'running') {
    await cmd(OWNER, { type: 'commit-decision', decisionId: options()[0]!.id });
  }
}

let seeded: Promise<void> | null = null;
function seed() {
  seeded ??= (async () => {
    await seedRoom('previewlobby00001', 'lobby');
    await seedRoom('previewrunning001', 'running');
    await seedRoom('previewdebrief001', 'debrief');
  })();
  return seeded;
}

export async function crisisPreviewCall(
  functionKey: string,
  mode: PreviewMode,
  payload?: object,
): Promise<ApiResult<unknown>> {
  await new Promise((r) => setTimeout(r, 250));
  if (mode === 'error') {
    return {
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'Could not reach the ScenarioForge backend.' },
    };
  }
  if (new URLSearchParams(window.location.search).get('crisis') !== 'unavailable') await seed();
  const who = new URLSearchParams(window.location.search).get('as') ?? '';
  const accountId = PEOPLE[who] ?? OWNER;
  const fn = resolvers[functionKey as Fn] as
    ((q: object) => Promise<ApiResult<unknown>>) | undefined;
  if (!fn) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Unknown call.' } };
  return fn({ payload, context: ctx(accountId) });
}
