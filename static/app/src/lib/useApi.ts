import { useCallback, useEffect, useState } from 'react';
import type { ApiError, ApiResult } from '@shared/api';

export type RemoteState<T> =
  { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; data: T };

interface Settled<T> {
  load: () => Promise<ApiResult<T>>;
  attempt: number;
  state: RemoteState<T>;
}

/**
 * Runs a resolver call whenever `load` changes and exposes a retry. A result
 * only counts for the request that produced it, so a new request always shows
 * loading rather than the previous answer.
 */
export function useApi<T>(load: () => Promise<ApiResult<T>>) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then((result) => {
      if (cancelled) return;
      setSettled({
        load,
        attempt,
        state: result.ok
          ? { status: 'ready', data: result.data }
          : { status: 'error', error: result.error },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state: RemoteState<T> =
    settled && settled.load === load && settled.attempt === attempt
      ? settled.state
      : { status: 'loading' };
  return { state, retry };
}
