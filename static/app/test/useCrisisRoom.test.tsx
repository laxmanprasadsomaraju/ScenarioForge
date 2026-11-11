import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrisisRoomSnapshot } from '@shared/crisis/api';
import { useCrisisRoom } from '../src/lib/useCrisisRoom';
import { api } from '../src/lib/api';

vi.mock('../src/lib/api', () => ({ api: { crisisView: vi.fn(), crisisCommand: vi.fn() } }));

const room = (version: number) =>
  ({ view: { version, roomId: 'r1' }, timeline: [] }) as unknown as CrisisRoomSnapshot;
const ok = (version: number) =>
  ({ ok: true, data: { status: 'OK', room: room(version) } }) as never;
const POLL = 1000;

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const tick = (ms = POLL) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useCrisisRoom polling', () => {
  it('polls with the known version while visible, and treats UNCHANGED as fresh', async () => {
    vi.mocked(api.crisisView).mockResolvedValueOnce(ok(3));
    const { result } = renderHook(() => useCrisisRoom('r1', POLL));
    await flush();
    expect(result.current.state.kind).toBe('ready');
    vi.mocked(api.crisisView).mockResolvedValue({
      ok: true,
      data: { status: 'UNCHANGED' },
    } as never);
    await tick();
    expect(vi.mocked(api.crisisView).mock.calls.at(-1)![0]).toMatchObject({ knownVersion: 3 });
    expect(result.current.offline).toBe(false);
  });

  it('does not poll while the tab is hidden, and catches up when it becomes visible', async () => {
    vi.mocked(api.crisisView).mockResolvedValue(ok(1));
    renderHook(() => useCrisisRoom('r1', POLL));
    await flush();
    const before = vi.mocked(api.crisisView).mock.calls.length;
    act(() => setVisibility('hidden'));
    await tick(POLL * 5);
    expect(vi.mocked(api.crisisView).mock.calls.length).toBe(before);
    vi.mocked(api.crisisView).mockResolvedValue(ok(4));
    act(() => setVisibility('visible'));
    await flush();
    expect(vi.mocked(api.crisisView).mock.calls.length).toBe(before + 1);
  });

  it('keeps the last room on screen when offline, then recovers on the next good poll', async () => {
    vi.mocked(api.crisisView).mockResolvedValueOnce(ok(2));
    const { result } = renderHook(() => useCrisisRoom('r1', POLL));
    await flush();
    vi.mocked(api.crisisView).mockResolvedValue({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'Could not reach the ScenarioForge backend.' },
    });
    await tick();
    expect(result.current.offline).toBe(true);
    expect(result.current.state.kind).toBe('ready');
    vi.mocked(api.crisisView).mockResolvedValue(ok(5));
    await tick();
    expect(result.current.offline).toBe(false);
    expect(result.current.state.kind === 'ready' && result.current.state.room.view.version).toBe(5);
  });

  it('shows an error, not a blank room, when the first load fails', async () => {
    vi.mocked(api.crisisView).mockResolvedValue({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'down' },
    });
    const { result } = renderHook(() => useCrisisRoom('r1', POLL));
    await flush();
    expect(result.current.state.kind).toBe('error');
  });

  it('stops polling after unmount', async () => {
    vi.mocked(api.crisisView).mockResolvedValue(ok(1));
    const { unmount } = renderHook(() => useCrisisRoom('r1', POLL));
    await flush();
    unmount();
    const n = vi.mocked(api.crisisView).mock.calls.length;
    await tick(POLL * 5);
    expect(vi.mocked(api.crisisView).mock.calls.length).toBe(n);
  });

  it('on a stale write it says so and re-reads the room instead of overwriting', async () => {
    vi.mocked(api.crisisView).mockResolvedValue(ok(2));
    const { result } = renderHook(() => useCrisisRoom('r1', POLL));
    await flush();
    vi.mocked(api.crisisCommand).mockResolvedValue({
      ok: true,
      data: { status: 'REJECTED', reason: 'STALE_VERSION', message: 'stale', version: 2 },
    } as never);
    const before = vi.mocked(api.crisisView).mock.calls.length;
    await act(async () => void (await result.current.run({ type: 'start' })));
    await flush();
    expect(result.current.notice).toBeTruthy();
    expect(vi.mocked(api.crisisView).mock.calls.length).toBe(before + 1);
  });
});
