import { useEffect, useState, type FormEvent } from 'react';
import type { ApiError, RehearsalSourceRef } from '@shared/api';
import type { CrisisRole } from '@shared/crisis/types';
import { Button } from '../Button';
import { ErrorPanel, Notice, SkeletonRows } from '../States';
import { sourceRefFor } from '../history/save';
import { api } from '../../lib/api';
import { DEMO_SOURCE, useRehearsalSource } from '../../lib/rehearsalSource';
import { useRouter } from '../../lib/router';
import type { IssuedInvite } from '../../lib/useCrisisRoom';
import { ROLE_CHOICES, ROLE_NAME } from './parts';

type Availability =
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'gate'; detail: string }
  | { kind: 'error'; error: ApiError };

/** Says plainly when team rooms cannot work here, and offers the solo rehearsal. */
export function Unavailable({ detail }: { detail: string }) {
  const { navigate } = useRouter();
  return (
    <section className="region crisis-unavailable" aria-labelledby="crisis-unavailable">
      <h2 id="crisis-unavailable" className="section-title">
        Team rooms are not available here
      </h2>
      <p className="crisis-unavailable-detail">{detail}</p>
      <p className="region-body">
        A team room keeps one shared record that every participant reads and writes, so it needs app
        storage. Nothing about a room is kept in your browser, and no one can join until storage is
        turned on for this app.
      </p>
      <div>
        <Button onClick={() => navigate('simulations')}>Rehearse solo instead</Button>
      </div>
    </section>
  );
}

export function StartRoom({
  onCreated,
}: {
  onCreated: (roomId: string, invites: IssuedInvite[]) => void;
}) {
  const { source } = useRehearsalSource();
  const [availability, setAvailability] = useState<Availability>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const generated = source.provenance ? sourceRefFor(source) : null;
  const [choice, setChoice] = useState<'generated' | 'demo'>(generated ? 'generated' : 'demo');
  const [roles, setRoles] = useState<Set<CrisisRole>>(
    () => new Set<CrisisRole>(['engineering-responder', 'communications-lead']),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.crisisStatus().then((r) => {
      if (!live) return;
      if (!r.ok) setAvailability({ kind: 'error', error: r.error });
      else if (r.data.status === 'AVAILABLE') setAvailability({ kind: 'available' });
      else setAvailability({ kind: 'gate', detail: r.data.detail });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (availability.kind === 'checking')
    return <SkeletonRows rows={3} label="Checking team rooms" />;
  if (availability.kind === 'error')
    return (
      <ErrorPanel
        error={availability.error}
        onRetry={() => {
          setAvailability({ kind: 'checking' });
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (availability.kind === 'gate') return <Unavailable detail={availability.detail} />;

  const toggle = (role: CrisisRole) =>
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const ref: RehearsalSourceRef =
      choice === 'generated' && generated
        ? generated
        : { kind: 'demo', scenarioId: DEMO_SOURCE.scenario.id };
    try {
      const created = await api.crisisOpenRoom({ source: ref });
      if (!created.ok) return setProblem(created.error.message);
      const data = created.data;
      if (data.status === 'UNAVAILABLE' || data.status === 'IDENTITY_UNAVAILABLE') {
        return setAvailability({ kind: 'gate', detail: data.detail });
      }
      if (data.status !== 'OK') return setProblem(data.message);
      // Invites for the chosen roles, issued one after another at each new version.
      const invites: IssuedInvite[] = [];
      let version = data.room.view.version;
      for (const role of ROLE_CHOICES.filter((r) => roles.has(r))) {
        const r = await api.crisisInviteToken({
          roomId: data.room.view.roomId,
          expectedVersion: version,
          role,
        });
        if (!r.ok || r.data.status !== 'OK') break;
        invites.push(r.data.invite);
        version = r.data.room.view.version;
      }
      onCreated(data.room.view.roomId, invites);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="crisis-start" onSubmit={submit} aria-labelledby="crisis-start-title">
      <h2 id="crisis-start-title" className="section-title">
        Open a team room
      </h2>
      <fieldset className="crisis-options">
        <legend className="field-label">Rehearsal</legend>
        <label className={`crisis-option${generated ? '' : ' crisis-option-off'}`}>
          <input
            type="radio"
            name="crisis-source"
            value="generated"
            disabled={!generated}
            checked={choice === 'generated'}
            onChange={() => setChoice('generated')}
          />
          <span>
            <span className="decision-label">
              {generated ? source.scenario.title : 'A rehearsal generated from a change'}
            </span>
            <span className="decision-detail">
              {generated
                ? `Built from ${source.provenance!.changeKey}. The server rebuilds it from Jira and Confluence as you.`
                : 'Generate one from a finding in Readiness checks first.'}
            </span>
          </span>
        </label>
        <label className="crisis-option">
          <input
            type="radio"
            name="crisis-source"
            value="demo"
            checked={choice === 'demo'}
            onChange={() => setChoice('demo')}
          />
          <span>
            <span className="decision-label">Demo scenario: {DEMO_SOURCE.scenario.title}</span>
            <span className="decision-detail">Synthetic data, labelled as such in the room.</span>
          </span>
        </label>
      </fieldset>
      <fieldset className="crisis-options">
        <legend className="field-label">Invite links to create now</legend>
        <p className="crisis-hint">
          You hold incident command. You can add or change roles in the lobby.
        </p>
        {ROLE_CHOICES.map((role) => (
          <label key={role} className="crisis-check">
            <input type="checkbox" checked={roles.has(role)} onChange={() => toggle(role)} />
            <span>{ROLE_NAME[role]}</span>
          </label>
        ))}
      </fieldset>
      {problem ? (
        <Notice tone="error" title="The room was not opened">
          <p>{problem}</p>
        </Notice>
      ) : null}
      <div>
        <Button type="submit" variant="primary" isDisabled={busy}>
          {busy ? 'Opening…' : 'Open room'}
        </Button>
      </div>
    </form>
  );
}

export function JoinRoom({
  roomId,
  token,
  onJoined,
  onCancel,
}: {
  roomId: string;
  token: string;
  onJoined: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [gate, setGate] = useState<string | null>(null);

  if (gate) return <Unavailable detail={gate} />;

  const join = async () => {
    setBusy(true);
    setProblem(null);
    const r = await api.crisisCommand({
      roomId,
      expectedVersion: 1,
      command: { type: 'join', token },
    });
    setBusy(false);
    if (!r.ok) return setProblem(r.error.message);
    const data = r.data;
    if (data.status === 'OK') return onJoined();
    if (data.status === 'REJECTED') return setProblem(data.message);
    setGate(data.detail);
  };

  return (
    <section className="region crisis-join" aria-labelledby="crisis-join-title">
      <h2 id="crisis-join-title" className="section-title">
        You have been invited to a team room
      </h2>
      <p className="region-body">
        Joining adds you, as your Jira account, with the role the owner chose. The invite works
        once.
      </p>
      {problem ? (
        <Notice tone="error" title="Could not join">
          <p>{problem}</p>
        </Notice>
      ) : null}
      <div className="crisis-save-row">
        <Button variant="primary" isDisabled={busy} onClick={() => void join()}>
          {busy ? 'Joining…' : 'Join room'}
        </Button>
        <Button variant="subtle" onClick={onCancel}>
          Not now
        </Button>
      </div>
    </section>
  );
}
