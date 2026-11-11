import { useState } from 'react';
import type { CrisisRole } from '@shared/crisis/types';
import type { CrisisRoomSnapshot } from '@shared/crisis/api';
import { Button } from '../Button';
import { StatusBadge } from '../Badge';
import { formatAbsolute } from '../../lib/format';
import type { CrisisRoomHandle, IssuedInvite } from '../../lib/useCrisisRoom';
import { InviteLink } from './InviteLink';
import { ParticipantList, ROLE_CHOICES, ROLE_NAME, namer } from './parts';

const INVITE_STATE = {
  open: { tone: 'info', label: 'Open' },
  used: { tone: 'success', label: 'Used' },
  revoked: { tone: 'unknown', label: 'Revoked' },
  expired: { tone: 'unknown', label: 'Expired' },
} as const;

export function Lobby({
  room,
  handle,
  issued,
  onIssued,
}: {
  room: CrisisRoomSnapshot;
  handle: CrisisRoomHandle;
  issued: IssuedInvite[];
  onIssued: (invite: IssuedInvite) => void;
}) {
  const { view } = room;
  const name = namer(view);
  const [role, setRole] = useState<CrisisRole>('engineering-responder');
  const owner = room.isOwner ? view.viewer : null;
  const shownIds = new Set(issued.map((i) => i.inviteId));
  const others = view.participants.filter(
    (p) => p.active && p.accountId !== view.viewer && p.accountId !== view.commander,
  );

  return (
    <div className="crisis-lobby">
      <section className="region" aria-labelledby="lobby-people">
        <div className="region-head">
          <h2 id="lobby-people" className="section-title">
            Participants
          </h2>
          <span className="region-meta">
            {view.participants.filter((p) => p.active).length} in the room
          </span>
        </div>
        <ParticipantList view={view} isOwnerOf={room.isOwner ? view.viewer : null} />
        {room.isOwner && others.length ? (
          <div className="crisis-assign">
            <h3 className="crisis-subtitle">Change a role</h3>
            {others.map((p) => (
              <label key={p.accountId} className="field">
                <span className="field-label">{name(p.accountId)}</span>
                <select
                  value={p.role}
                  disabled={handle.busy}
                  onChange={(e) =>
                    void handle.run({
                      type: 'assign-role',
                      accountId: p.accountId,
                      role: e.target.value as CrisisRole,
                    })
                  }
                >
                  {ROLE_CHOICES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_NAME[r]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      {room.isOwner ? (
        <section className="region" aria-labelledby="lobby-invites">
          <h2 id="lobby-invites" className="section-title">
            Invite people
          </h2>
          <p className="region-body">
            Each invite link works once, for one person, until it expires. Anyone who opens it still
            signs in to Jira as themselves.
          </p>
          <form
            className="crisis-form crisis-invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handle.invite(role).then((inv) => inv && onIssued(inv));
            }}
          >
            <label className="field">
              <span className="field-label">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as CrisisRole)}>
                {ROLE_CHOICES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAME[r]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <Button type="submit" isDisabled={handle.busy}>
                Create invite link
              </Button>
            </div>
          </form>
          {issued.length ? (
            <ul className="crisis-issued" aria-label="New invite links">
              {issued.map((i) => (
                <li key={i.inviteId}>
                  <InviteLink roomId={view.roomId} invite={i} />
                </li>
              ))}
            </ul>
          ) : null}
          {room.invites.some((i) => !shownIds.has(i.inviteId)) ? (
            <>
              <h3 className="crisis-subtitle">Earlier invites</h3>
              <ul className="crisis-invites">
                {room.invites
                  .filter((i) => !shownIds.has(i.inviteId))
                  .map((i) => (
                    <li key={i.inviteId}>
                      <span>{ROLE_NAME[i.role]}</span>
                      <StatusBadge tone={INVITE_STATE[i.state].tone}>
                        {INVITE_STATE[i.state].label}
                      </StatusBadge>
                      <span className="crisis-invite-expiry">
                        Expires {formatAbsolute(i.expiresAt)}
                      </span>
                      {i.state === 'open' ? (
                        <Button
                          spacing="compact"
                          isDisabled={handle.busy}
                          onClick={() =>
                            void handle.run({ type: 'revoke-invite', inviteId: i.inviteId })
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </li>
                  ))}
              </ul>
              <p className="region-body">
                Links are shown only when they are created. To share again, revoke and create a new
                one.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="region crisis-lobby-start" aria-labelledby="lobby-start">
        <h2 id="lobby-start" className="section-title">
          {room.isOwner ? 'When everyone is here' : 'Waiting to start'}
        </h2>
        {room.isOwner ? (
          <>
            <p className="region-body">
              Starting puts the whole room on one simulated clock. You hold incident command and
              commit each decision; responders propose.
            </p>
            <div>
              <Button
                variant="primary"
                isDisabled={handle.busy}
                onClick={() => void handle.run({ type: 'start' })}
              >
                Start exercise
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="region-body">
              You are in as {ROLE_NAME[view.role]}. The room owner starts the exercise; this page
              moves on by itself.
            </p>
            {owner === null && view.viewer !== view.commander ? (
              <div>
                <Button
                  variant="subtle"
                  isDisabled={handle.busy}
                  onClick={() => void handle.run({ type: 'leave' })}
                >
                  Leave room
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
