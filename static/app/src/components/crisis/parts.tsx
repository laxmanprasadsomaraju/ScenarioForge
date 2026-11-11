import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommunicationKind, CrisisRole, RoleView, TimelineEntry } from '@shared/crisis/types';
import { ROLE_NAME } from '@shared/crisis/timeline';
import { Button } from '../Button';
import { StatusBadge } from '../Badge';
import { formatRelative } from '../../lib/format';

export { ROLE_NAME };

/**
 * People are shown by role and join order, never by account id: the app has
 * no permission to look up names, and ids are not for display.
 */
export function namer(view: Pick<RoleView, 'participants' | 'viewer'>) {
  const index = new Map(view.participants.map((p, i) => [p.accountId, i + 1]));
  return (accountId: string) =>
    accountId === view.viewer ? 'You' : `Participant ${index.get(accountId) ?? '?'}`;
}

export const KIND_LABEL: Record<CommunicationKind, string> = {
  'status-update': 'Status update',
  'stakeholder-notice': 'Stakeholder notice',
};

/** Polling status, a manual refresh, and the offline note. Never says "live". */
export function SyncLine({
  updatedAt,
  offline,
  onRefresh,
}: {
  updatedAt: number | null;
  offline: boolean;
  onRefresh: () => void;
}) {
  return (
    <span className="crisis-sync">
      {offline ? (
        <StatusBadge tone="warning">Connection lost, retrying</StatusBadge>
      ) : (
        <span className="crisis-sync-note">Updates every few seconds</span>
      )}
      {updatedAt ? (
        <span className="crisis-sync-time">
          Checked {formatRelative(new Date(updatedAt).toISOString())}
        </span>
      ) : null}
      <Button spacing="compact" onClick={onRefresh}>
        Refresh
      </Button>
    </span>
  );
}

/**
 * Announces events that arrived since the last poll, once each. The first
 * load is not announced: it is the page, not news.
 */
export function NewEventsAnnouncer({ timeline }: { timeline: TimelineEntry[] }) {
  const seen = useRef<number | null>(null);
  const [message, setMessage] = useState('');
  const last = timeline.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (seen.current !== null && last > seen.current) {
      const fresh = timeline.filter((e) => e.seq > seen.current!);
      setMessage(
        fresh.length === 1
          ? `New in the room: ${fresh[0]!.summary}`
          : `${fresh.length} new events. Latest: ${fresh.at(-1)!.summary}`,
      );
    }
    seen.current = last;
  }, [last, timeline]);
  return (
    <div className="visually-hidden" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function ParticipantList({ view, isOwnerOf }: { view: RoleView; isOwnerOf: string | null }) {
  const name = namer(view);
  return (
    <ul className="crisis-people" aria-label="Participants and roles">
      {view.participants.map((p) => (
        <li key={p.accountId} className={p.active ? undefined : 'crisis-person-left'}>
          <span className="crisis-person-name">{name(p.accountId)}</span>
          <span className="crisis-person-role">{ROLE_NAME[p.role]}</span>
          <span className="crisis-person-tags">
            {p.accountId === isOwnerOf ? <StatusBadge tone="info">Owner</StatusBadge> : null}
            {p.active ? null : <StatusBadge tone="unknown">Left</StatusBadge>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Timeline({ entries, view }: { entries: TimelineEntry[]; view: RoleView }) {
  const name = namer(view);
  // Room housekeeping (invites) stays out of the shared exercise log.
  const shown = entries.filter((e) => e.type !== 'invite-issued' && e.type !== 'invite-revoked');
  return (
    <ol className="crisis-timeline" aria-label="Incident timeline">
      {shown.map((e) => (
        <li key={e.seq} className={`crisis-event crisis-event-${e.type}`}>
          <span className="crisis-event-time num">
            {e.atMinute === null ? 'Lobby' : `T+${e.atMinute}`}
          </span>
          <span className="crisis-event-body">
            <span className="crisis-event-who">
              {name(e.actor)}
              {e.role ? `, ${ROLE_NAME[e.role]}` : ''}
            </span>
            <span>{e.summary}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Communications({
  view,
  busy,
  onPost,
}: {
  view: RoleView;
  busy: boolean;
  onPost: (kind: CommunicationKind, text: string) => Promise<boolean>;
}) {
  const name = namer(view);
  const kinds = view.can.communicate;
  const [kind, setKind] = useState<CommunicationKind>(kinds[0] ?? 'status-update');
  const [text, setText] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    if (await onPost(kinds.includes(kind) ? kind : kinds[0]!, text.trim())) setText('');
  };
  return (
    <div className="crisis-comms">
      {view.communications.length ? (
        <ol className="crisis-comms-list" aria-label="Messages">
          {view.communications.map((c) => (
            <li key={c.seq}>
              <span className="crisis-comms-meta">
                <span className="num">T+{c.atMinute}</span> {KIND_LABEL[c.kind]} from{' '}
                {name(c.actor)}, {ROLE_NAME[c.role]}
              </span>
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="region-body">No messages yet.</p>
      )}
      {kinds.length ? (
        <form className="crisis-form" onSubmit={submit}>
          {kinds.length > 1 ? (
            <label className="field">
              <span className="field-label">Message type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as CommunicationKind)}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">
              {kinds.length > 1 ? 'Message' : `${KIND_LABEL[kinds[0]!]}`}
            </span>
            <textarea
              value={text}
              maxLength={1000}
              rows={2}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div>
            <Button type="submit" isDisabled={busy || !text.trim()}>
              Post
            </Button>
          </div>
        </form>
      ) : (
        <p className="region-body">Your role reads messages but does not post.</p>
      )}
    </div>
  );
}

export const ROLE_CHOICES: CrisisRole[] = [
  'engineering-responder',
  'security-responder',
  'communications-lead',
  'observer',
];
