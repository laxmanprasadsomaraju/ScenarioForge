import { useState } from 'react';
import { CRISIS_PATH, crisisRoomPath, parseCrisisLink } from '@shared/links/crisisLink';
import { OriginBadge, StatusBadge } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';
import { ErrorPanel, Notice, SkeletonRows } from '../components/States';
import { Lobby } from '../components/crisis/Lobby';
import { Running } from '../components/crisis/Running';
import { JoinRoom, StartRoom, Unavailable } from '../components/crisis/StartRoom';
import { TeamDebrief } from '../components/crisis/TeamDebrief';
import { NewEventsAnnouncer, ROLE_NAME, SyncLine } from '../components/crisis/parts';
import { useRouter } from '../lib/router';
import { useCrisisRoom, type IssuedInvite } from '../lib/useCrisisRoom';
import '../styles/screens/crisis.css';

const LEAD = 'A shared rehearsal: one clock, one incident commander, everyone in a role.';

/** Crisis room: start or join a team room, then lobby, running exercise and debrief. */
export function CrisisRoomPage() {
  const { search, navigatePath } = useRouter();
  const link = parseCrisisLink(search);
  // Invite tokens issued in this tab, shown once in the lobby.
  const [issued, setIssued] = useState<{ roomId: string; invites: IssuedInvite[] }>({
    roomId: '',
    invites: [],
  });

  if (link.kind === 'room') {
    return (
      <RoomScreen
        key={link.roomId}
        roomId={link.roomId}
        issued={issued.roomId === link.roomId ? issued.invites : []}
        onIssued={(invite) =>
          setIssued((prev) => ({
            roomId: link.roomId,
            invites: [...(prev.roomId === link.roomId ? prev.invites : []), invite],
          }))
        }
      />
    );
  }

  return (
    <>
      <PageHeader title="Crisis room" lead={LEAD} />
      {link.kind === 'rejected' ? (
        <Notice tone="warning" title="This room link was not opened">
          <p>{link.reason}</p>
        </Notice>
      ) : null}
      {link.kind === 'invite' ? (
        <JoinRoom
          roomId={link.roomId}
          token={link.token}
          // The token leaves the URL as soon as it is used.
          onJoined={() => navigatePath(crisisRoomPath(link.roomId))}
          onCancel={() => navigatePath(CRISIS_PATH)}
        />
      ) : (
        <StartRoom
          onCreated={(roomId, invites) => {
            setIssued({ roomId, invites });
            navigatePath(crisisRoomPath(roomId));
          }}
        />
      )}
    </>
  );
}

const STATUS_LABEL = {
  lobby: 'In the lobby',
  running: 'Exercise running',
  debrief: 'Debrief',
  closed: 'Closed',
} as const;

function RoomScreen({
  roomId,
  issued,
  onIssued,
}: {
  roomId: string;
  issued: IssuedInvite[];
  onIssued: (invite: IssuedInvite) => void;
}) {
  const handle = useCrisisRoom(roomId);
  const { navigatePath } = useRouter();
  const { state } = handle;

  if (state.kind !== 'ready') {
    return (
      <>
        <PageHeader title="Crisis room" lead={LEAD} />
        {state.kind === 'loading' ? <SkeletonRows rows={4} label="Opening the room" /> : null}
        {state.kind === 'gate' ? <Unavailable detail={state.detail} /> : null}
        {state.kind === 'error' ? (
          <ErrorPanel error={state.error} onRetry={handle.refresh} />
        ) : null}
        {state.kind === 'denied' ? (
          <Notice
            tone="warning"
            title="You are not in this room"
            action={{ label: 'Open a new room', onClick: () => navigatePath(CRISIS_PATH) }}
          >
            <p>{state.message}</p>
          </Notice>
        ) : null}
      </>
    );
  }

  const { room } = state;
  const { view } = room;
  return (
    <>
      <PageHeader
        title={room.scenarioTitle}
        lead={`Crisis room. You are ${ROLE_NAME[view.role]}${room.isOwner ? ' and the room owner' : ''}.`}
        aside={
          <span className="crisis-header-badges">
            <StatusBadge tone={view.status === 'running' ? 'info' : 'unknown'}>
              {STATUS_LABEL[view.status]}
            </StatusBadge>
            {room.synthetic ? <OriginBadge origin="synthetic">Synthetic demo</OriginBadge> : null}
          </span>
        }
      />
      <NewEventsAnnouncer timeline={room.timeline} />
      <div className="rehearsal-bar crisis-bar">
        {view.status === 'running' || view.status === 'debrief' ? (
          <span className="clock">
            <span className="clock-label">Simulated time</span>
            <span className="clock-value num">T+{view.elapsedMinutes} min</span>
          </span>
        ) : null}
        <span className="crisis-bar-role">
          Your role <strong>{ROLE_NAME[view.role]}</strong>
        </span>
        <SyncLine
          updatedAt={handle.updatedAt}
          offline={handle.offline}
          onRefresh={handle.refresh}
        />
      </div>
      {handle.notice ? (
        <Notice
          tone="warning"
          title="Not done"
          action={{ label: 'Dismiss', onClick: handle.dismissNotice }}
        >
          <p>{handle.notice}</p>
        </Notice>
      ) : null}
      {view.status === 'lobby' ? (
        <Lobby room={room} handle={handle} issued={issued} onIssued={onIssued} />
      ) : view.status === 'running' ? (
        <Running room={room} handle={handle} />
      ) : room.debrief ? (
        <TeamDebrief room={room} handle={handle} />
      ) : (
        <Notice tone="information" title="This room is closed">
          <p>It was closed before the exercise finished, so there is no debrief.</p>
        </Notice>
      )}
    </>
  );
}
