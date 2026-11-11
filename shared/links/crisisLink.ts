import { CRISIS_ROOM_ID, CRISIS_TOKEN } from '../crisis/api';

/**
 * Crisis Room links, in the same canonical, all-or-nothing style as
 * deepLink.ts. A room link names a room id; an invite link adds the one-time
 * invite token. Either way the server decides what the visitor may see.
 */

export const CRISIS_PATH = '/crisis-room';
const MAX_QUERY_LENGTH = 256;

export type CrisisLink =
  | { kind: 'none' }
  | { kind: 'room'; roomId: string }
  | { kind: 'invite'; roomId: string; token: string }
  /** Nothing from the link is applied; `reason` is fixed text. */
  | { kind: 'rejected'; reason: string };

export function crisisRoomPath(roomId: string): string {
  if (!CRISIS_ROOM_ID.test(roomId)) throw new TypeError('roomId is malformed.');
  return `${CRISIS_PATH}?room=${roomId}`;
}

export function crisisInvitePath(roomId: string, token: string): string {
  if (!CRISIS_TOKEN.test(token)) throw new TypeError('token is malformed.');
  return `${crisisRoomPath(roomId)}&invite=${token}`;
}

export function parseCrisisLink(search: string): CrisisLink {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (raw === '') return { kind: 'none' };
  const reject = (reason: string): CrisisLink => ({ kind: 'rejected', reason });
  if (raw.length > MAX_QUERY_LENGTH) return reject('The link is too long.');
  const fields = new Map<string, string>();
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return reject('The link is malformed.');
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (name !== 'room' && name !== 'invite') {
      return reject('The link has a parameter ScenarioForge does not use.');
    }
    if (fields.has(name)) return reject(`The link repeats "${name}".`);
    fields.set(name, value);
  }
  const roomId = fields.get('room');
  if (roomId === undefined || !CRISIS_ROOM_ID.test(roomId)) {
    return reject('The link does not name a valid room.');
  }
  const token = fields.get('invite');
  if (token === undefined) return { kind: 'room', roomId };
  if (!CRISIS_TOKEN.test(token)) return reject('The invite in this link is malformed.');
  return { kind: 'invite', roomId, token };
}
