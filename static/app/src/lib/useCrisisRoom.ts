import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '@shared/api';
import type {
  CrisisClientCommand,
  CrisisRoomResponse,
  CrisisRoomSnapshot,
} from '@shared/crisis/api';
import { CRISIS_POLL_MS, CRISIS_REJECT_TEXT } from '@shared/crisis/api';
import type { CrisisRole } from '@shared/crisis/types';
import { api } from './api';

/** A token issued in this tab. It is shown once and never fetched again. */
export interface IssuedInvite {
  inviteId: string;
  role: CrisisRole;
  expiresAt: string;
  token: string;
}

export type RoomState =
  | { kind: 'loading' }
  | { kind: 'ready'; room: CrisisRoomSnapshot }
  /** Storage or identity is missing here: say so plainly, no room is shown. */
  | { kind: 'gate'; detail: string }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; error: ApiError };

export interface CrisisRoomHandle {
  state: RoomState;
  /** Set when the last poll failed while a room was shown; the room stays on screen. */
  offline: boolean;
  updatedAt: number | null;
  busy: boolean;
  /** A refused action, in words. Cleared by the next successful action. */
  notice: string | null;
  refresh: () => void;
  run: (command: CrisisClientCommand) => Promise<boolean>;
  invite: (role: CrisisRole) => Promise<IssuedInvite | null>;
  dismissNotice: () => void;
}

/**
 * One room, kept fresh by polling crisisView every few seconds while the tab
 * is visible. There is no realtime channel. Each answer is the server's
 * rebuild of the stored log, so reconnecting after a gap is just the next
 * successful poll.
 */
export function useCrisisRoom(roomId: string, pollMs = CRISIS_POLL_MS): CrisisRoomHandle {
  const [state, setState] = useState<RoomState>({ kind: 'loading' });
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const version = useRef<number | null>(null);
  const alive = useRef(true);

  const accept = useCallback((response: CrisisRoomResponse): boolean => {
    if (!alive.current) return false;
    switch (response.status) {
      case 'OK':
        version.current = response.room.view.version;
        setState({ kind: 'ready', room: response.room });
        setOffline(false);
        setUpdatedAt(Date.now());
        return true;
      case 'UNAVAILABLE':
      case 'IDENTITY_UNAVAILABLE':
        version.current = null;
        setState({ kind: 'gate', detail: response.detail });
        return false;
      case 'REJECTED':
        if (response.reason === 'NOT_PARTICIPANT' || response.reason === 'ROOM_INVALID') {
          version.current = null;
          setState({ kind: 'denied', message: response.message });
        }
        return false;
    }
  }, []);

  const load = useCallback(
    async (full: boolean) => {
      const known = full ? undefined : (version.current ?? undefined);
      const result = await api.crisisView({
        roomId,
        ...(known !== undefined ? { knownVersion: known } : {}),
      });
      if (!alive.current) return;
      if (!result.ok) {
        // Keep the last good room on screen; the next poll reconnects.
        if (version.current !== null) setOffline(true);
        else setState({ kind: 'error', error: result.error });
        return;
      }
      if (result.data.status === 'UNCHANGED') {
        setOffline(false);
        setUpdatedAt(Date.now());
        return;
      }
      accept(result.data);
    },
    [roomId, accept],
  );

  const refresh = useCallback(() => void load(true), [load]);

  useEffect(() => {
    // The screen is keyed by room id, so a new room starts from fresh state.
    alive.current = true;
    void load(true);
    return () => {
      alive.current = false;
    };
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const id = window.setInterval(tick, pollMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, pollMs]);

  const refused = useCallback(
    (response: CrisisRoomResponse) => {
      if (response.status !== 'REJECTED') return;
      if (response.reason === 'STALE_VERSION') {
        setNotice(CRISIS_REJECT_TEXT.STALE_VERSION);
        void load(true);
      } else {
        setNotice(response.message);
      }
    },
    [load],
  );

  const run = useCallback(
    async (command: CrisisClientCommand) => {
      setBusy(true);
      try {
        const result = await api.crisisCommand({
          roomId,
          expectedVersion: version.current ?? 1,
          command,
        });
        if (!result.ok) {
          setNotice(result.error.message);
          return false;
        }
        if (accept(result.data)) {
          setNotice(null);
          return true;
        }
        refused(result.data);
        return false;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [roomId, accept, refused],
  );

  const invite = useCallback(
    async (role: CrisisRole) => {
      setBusy(true);
      try {
        const result = await api.crisisInviteToken({
          roomId,
          expectedVersion: version.current ?? 1,
          role,
        });
        if (!result.ok) {
          setNotice(result.error.message);
          return null;
        }
        const data = result.data;
        if (data.status === 'OK') {
          accept({ status: 'OK', room: data.room });
          setNotice(null);
          return data.invite;
        }
        if (data.status === 'REJECTED') refused(data);
        else accept(data);
        return null;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [roomId, accept, refused],
  );

  return {
    state,
    offline,
    updatedAt,
    busy,
    notice,
    refresh,
    run,
    invite,
    dismissNotice: () => setNotice(null),
  };
}
