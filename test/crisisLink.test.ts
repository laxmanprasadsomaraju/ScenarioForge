import { describe, expect, it } from 'vitest';
import { crisisInvitePath, crisisRoomPath, parseCrisisLink } from '../shared/links/crisisLink';

const ROOM = 'AbCdEfGhIjKlMnOpQrStUv';
const TOKEN = 'T'.repeat(43);

describe('crisis links', () => {
  it('round-trips room and invite links', () => {
    expect(parseCrisisLink(crisisRoomPath(ROOM).split('?')[1]!)).toEqual({
      kind: 'room',
      roomId: ROOM,
    });
    expect(parseCrisisLink(`?${crisisInvitePath(ROOM, TOKEN).split('?')[1]}`)).toEqual({
      kind: 'invite',
      roomId: ROOM,
      token: TOKEN,
    });
    expect(parseCrisisLink('')).toEqual({ kind: 'none' });
  });

  it('rejects the whole link on any problem', () => {
    for (const bad of [
      `?room=${ROOM}&room=${ROOM}`,
      `?room=${ROOM}&x=1`,
      '?room=short',
      `?room=${ROOM}&invite=short`,
      `?invite=${TOKEN}`,
      `?room=${ROOM}&invite=${'a'.repeat(300)}`,
    ]) {
      expect(parseCrisisLink(bad).kind).toBe('rejected');
    }
    expect(() => crisisRoomPath('../x')).toThrow();
    expect(() => crisisInvitePath(ROOM, 'short')).toThrow();
  });
});
