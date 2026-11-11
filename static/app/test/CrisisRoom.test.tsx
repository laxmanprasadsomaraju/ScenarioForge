import { useEffect, type ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '@shared/agents/storage';
import type { ApiResult } from '@shared/api';
import { CRISIS_NOT_ENABLED } from '@shared/crisis/api';
import type { CrisisClientCommand, CrisisRoomSnapshot } from '@shared/crisis/api';
import type { CrisisRole } from '@shared/crisis/types';
import { crisisInvitePath, crisisRoomPath } from '@shared/links/crisisLink';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import { createCrisisResolvers } from '../../../src/crisis/resolvers';
import { CrisisRoomPage } from '../src/pages/CrisisRoom';
import { useRouter } from '../src/lib/router';
import { renderInApp } from './helpers';

// The real crisis resolvers over in-memory storage stand in for the backend,
// so every state below is one the server can actually produce.
const OWNER = 'acc-owner';
const ENG = 'acc-eng';
const OBS = 'acc-obs';
const INSTALL = 'install-1';

const env = vi.hoisted(() => ({
  me: 'acc-owner',
  storage: null as unknown,
  enabled: true,
}));

let n = 0;
function makeResolvers() {
  return createCrisisResolvers({
    crisisStorage: () => (env.enabled ? (env.storage as InMemoryStorage) : null),
    historyStorage: () => null,
    trustedScenario: async () => ({
      ok: true,
      trusted: {
        scenario: authBackupRetiredScenario,
        remediation: authBackupRetiredRemediation,
        provenance: null,
      },
    }),
    random: (bytes) => `id${String(++n).padStart(6, '0')}`.padEnd(Math.ceil((bytes * 4) / 3), 'x'),
  });
}
let resolvers = makeResolvers();

const call =
  (fn: keyof ReturnType<typeof makeResolvers>) =>
  (payload?: object): Promise<ApiResult<unknown>> =>
    (resolvers[fn] as (q: object) => Promise<ApiResult<unknown>>)({
      payload,
      context: { accountId: env.me, installContext: INSTALL },
    });

vi.mock('../src/lib/api', () => ({
  api: {
    crisisStatus: (...a: [object?]) => call('crisisStatus')(...a),
    crisisOpenRoom: (p: object) => call('crisisOpenRoom')(p),
    crisisView: (p: object) => call('crisisView')(p),
    crisisCommand: (p: object) => call('crisisCommand')(p),
    crisisInviteToken: (p: object) => call('crisisInviteToken')(p),
    crisisSaveDebrief: (p: object) => call('crisisSaveDebrief')(p),
  },
}));

// Direct backend calls as another participant (a second browser).
async function as(accountId: string, fn: keyof ReturnType<typeof makeResolvers>, payload: object) {
  const r = await (resolvers[fn] as (q: object) => Promise<ApiResult<unknown>>)({
    payload,
    context: { accountId, installContext: INSTALL },
  });
  if (!r.ok) throw new Error('call failed');
  return r.data as { status: string; room: CrisisRoomSnapshot; invite?: { token: string } };
}

async function makeRoom(stage: 'lobby' | 'running' | 'debrief') {
  let r = await as(OWNER, 'crisisOpenRoom', {
    source: { kind: 'demo', scenarioId: authBackupRetiredScenario.id },
  });
  const roomId = r.room.view.roomId;
  const cmd = async (who: string, command: CrisisClientCommand) => {
    r = await as(who, 'crisisCommand', { roomId, expectedVersion: r.room.view.version, command });
    if (r.status !== 'OK') throw new Error(JSON.stringify(r));
  };
  const join = async (who: string, role: CrisisRole) => {
    const inv = await as(OWNER, 'crisisInviteToken', {
      roomId,
      expectedVersion: r.room.view.version,
      role,
    });
    r = await as(who, 'crisisCommand', {
      roomId,
      expectedVersion: 0,
      command: { type: 'join', token: inv.invite!.token },
    });
  };
  await join(ENG, 'engineering-responder');
  await join(OBS, 'observer');
  if (stage !== 'lobby') await cmd(OWNER, { type: 'start' });
  if (stage === 'debrief') {
    while (r.room.view.status === 'running') {
      const owner = await as(OWNER, 'crisisView', { roomId });
      r = owner;
      await cmd(OWNER, { type: 'commit-decision', decisionId: owner.room.view.options[0]!.id });
    }
  }
  return { roomId, version: () => r.room.view.version, cmd };
}

function At({ path, children }: { path: string; children: ReactNode }) {
  const { navigatePath, search } = useRouter();
  useEffect(() => navigatePath(path), [navigatePath, path]);
  return search ? <>{children}</> : null;
}

function renderAt(path: string, me = OWNER) {
  env.me = me;
  return renderInApp(
    <At path={path}>
      <CrisisRoomPage />
    </At>,
  );
}

beforeEach(() => {
  env.storage = new InMemoryStorage();
  env.enabled = true;
  env.me = OWNER;
  resolvers = makeResolvers();
});

describe('Crisis room: availability and creation', () => {
  it('says plainly that storage is not enabled, and offers nothing operable', async () => {
    env.enabled = false;
    env.me = OWNER;
    renderInApp(<CrisisRoomPage />);
    expect(await screen.findByText(CRISIS_NOT_ENABLED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open room' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rehearse solo instead' })).toBeInTheDocument();
  });

  it('opens a room from the demo scenario and shows each invite link once', async () => {
    const user = userEvent.setup();
    renderInApp(<CrisisRoomPage />);
    expect(await screen.findByRole('heading', { name: 'Open a team room' })).toBeInTheDocument();
    // No generated rehearsal is selected, so only the demo can be chosen.
    expect(screen.getByRole('radio', { name: /generated from a change/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Demo scenario/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Observer' }));
    await user.click(screen.getByRole('button', { name: 'Open room' }));

    expect(await screen.findByRole('heading', { name: 'Participants' })).toBeInTheDocument();
    const links = within(screen.getByRole('list', { name: 'New invite links' }));
    expect(links.getAllByRole('textbox')).toHaveLength(3);
    expect(links.getAllByText(/Shown once/)).toHaveLength(3);
    expect((links.getAllByRole('textbox')[0] as HTMLInputElement).value).toMatch(
      /^\/crisis-room\?room=[\w-]+&invite=[\w-]{32,}$/,
    );
    expect(screen.getByText('Synthetic demo')).toBeInTheDocument();
    expect(screen.getByText('Updates every few seconds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start exercise' })).toBeInTheDocument();
  });

  it('joins from an invite link, then drops the token from the URL', async () => {
    const user = userEvent.setup();
    const created = await as(OWNER, 'crisisOpenRoom', {
      source: { kind: 'demo', scenarioId: authBackupRetiredScenario.id },
    });
    const roomId = created.room.view.roomId;
    const inv = await as(OWNER, 'crisisInviteToken', {
      roomId,
      expectedVersion: 1,
      role: 'engineering-responder',
    });
    renderAt(crisisInvitePath(roomId, inv.invite!.token), ENG);
    await user.click(await screen.findByRole('button', { name: 'Join room' }));
    expect(await screen.findByRole('heading', { name: 'Waiting to start' })).toBeInTheDocument();
    expect(screen.getByText(/You are in as Engineering responder/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start exercise' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(inv.invite!.token);
  });

  it('refuses a reused invite with one plain message', async () => {
    const user = userEvent.setup();
    const created = await as(OWNER, 'crisisOpenRoom', {
      source: { kind: 'demo', scenarioId: authBackupRetiredScenario.id },
    });
    const roomId = created.room.view.roomId;
    const inv = await as(OWNER, 'crisisInviteToken', {
      roomId,
      expectedVersion: 1,
      role: 'observer',
    });
    await as(ENG, 'crisisCommand', {
      roomId,
      expectedVersion: 0,
      command: { type: 'join', token: inv.invite!.token },
    });
    renderAt(crisisInvitePath(roomId, inv.invite!.token), OBS);
    await user.click(await screen.findByRole('button', { name: 'Join room' }));
    expect(await screen.findByText(/This invite is not valid/)).toBeInTheDocument();
  });

  it('tells a non-participant they are not in the room', async () => {
    const { roomId } = await makeRoom('lobby');
    renderAt(crisisRoomPath(roomId), 'acc-stranger');
    expect(await screen.findByText('You are not in this room')).toBeInTheDocument();
  });
});

describe('Crisis room: running', () => {
  it('lets only the incident commander commit', async () => {
    const { roomId } = await makeRoom('running');
    renderAt(crisisRoomPath(roomId), ENG);
    expect(await screen.findByRole('heading', { name: 'Propose a decision' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Commit a decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Adopt and commit/ })).not.toBeInTheDocument();
  });

  it('keeps observers read-only', async () => {
    const { roomId } = await makeRoom('running');
    renderAt(crisisRoomPath(roomId), OBS);
    expect(await screen.findByText(/You are observing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Commit a decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    expect(screen.getByText(/Your role reads messages but does not post/)).toBeInTheDocument();
  });

  it('a responder proposes; the commander adopts the proposal', async () => {
    const user = userEvent.setup();
    const { roomId } = await makeRoom('running');
    const view = renderAt(crisisRoomPath(roomId), ENG);
    const option = await screen.findAllByRole('radio');
    await user.click(option[0]!);
    await user.type(screen.getByRole('textbox', { name: 'Why (optional)' }), 'Check the tenant');
    await user.click(screen.getByRole('button', { name: 'Propose' }));
    expect(await screen.findByText('Check the tenant')).toBeInTheDocument();
    view.unmount();

    renderAt(crisisRoomPath(roomId), OWNER);
    expect(await screen.findByRole('heading', { name: 'Commit a decision' })).toBeInTheDocument();
    expect(screen.getByText(/from Participant 2, Engineering responder/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adopt and commit' }));
    const log = within(screen.getByRole('region', { name: 'Shared timeline' }));
    await waitFor(() => expect(log.getByText(/\(adopted proposal\)/)).toBeInTheDocument());
  });

  it('explains a stale version and refreshes instead of overwriting', async () => {
    const user = userEvent.setup();
    const { roomId, version } = await makeRoom('running');
    renderAt(crisisRoomPath(roomId), OWNER);
    const decisions = within(await screen.findByRole('list', { name: 'Your options' }));
    // Another participant writes first.
    await as(ENG, 'crisisCommand', {
      roomId,
      expectedVersion: version(),
      command: { type: 'communicate', kind: 'status-update', text: 'Paging the IdP team' },
    });
    await user.click(decisions.getAllByRole('button')[0]!);
    expect(await screen.findByText(/Someone else changed the room first/)).toBeInTheDocument();
    expect(await screen.findByText('Paging the IdP team')).toBeInTheDocument();
    // Nothing was committed by the refused click.
    expect(screen.queryByText(/^Committed/)).not.toBeInTheDocument();
  });

  it('announces new events once, after a refresh', async () => {
    const user = userEvent.setup();
    const { roomId, version } = await makeRoom('running');
    renderAt(crisisRoomPath(roomId), OBS);
    await screen.findByText(/You are observing/);
    const live = () =>
      screen.getAllByRole('status').find((el) => el.className.includes('visually-hidden'))!;
    expect(live()).toHaveTextContent('');
    await as(ENG, 'crisisCommand', {
      roomId,
      expectedVersion: version(),
      command: { type: 'communicate', kind: 'status-update', text: 'Rollback started' },
    });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(live()).toHaveTextContent(/New in the room: Status update: Rollback started/),
    );
  });
});

describe('Crisis room: debrief', () => {
  it('shows who decided what and says plainly when history is not enabled', async () => {
    const user = userEvent.setup();
    const { roomId } = await makeRoom('debrief');
    renderAt(crisisRoomPath(roomId), OWNER);
    expect(await screen.findByRole('heading', { name: 'Who decided what' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contributions by role' })).toBeInTheDocument();
    expect(screen.getAllByText(/Committed by You/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Save to history' }));
    expect(
      await screen.findByText('Not saved: history is not enabled in this environment.'),
    ).toBeInTheDocument();
  });

  it('participants other than the owner see the debrief without the save action', async () => {
    const { roomId } = await makeRoom('debrief');
    renderAt(crisisRoomPath(roomId), ENG);
    expect(await screen.findByRole('heading', { name: 'Who decided what' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to history' })).not.toBeInTheDocument();
  });
});
