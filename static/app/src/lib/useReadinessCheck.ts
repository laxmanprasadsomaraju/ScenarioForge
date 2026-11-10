import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '@shared/api';
import type { ChangeAnalysis } from '@shared/analysis/types';
import type { ReadinessGraph } from '@shared/graph/types';
import { api } from './api';
import type { RemoteState } from './useApi';

interface Settled {
  issueKey: string;
  attempt: number;
  analysis: RemoteState<ChangeAnalysis>;
  graph: RemoteState<ReadinessGraph>;
}

const LOADING: { status: 'loading' } = { status: 'loading' };

function toState<T>(result: ApiResult<T>): RemoteState<T> {
  return result.ok
    ? { status: 'ready', data: result.data }
    : { status: 'error', error: result.error };
}

export interface ReadinessCheck {
  analysis: RemoteState<ChangeAnalysis>;
  graph: RemoteState<ReadinessGraph>;
  retry: () => void;
  retryGraph: () => void;
}

/**
 * Loads the readiness check for one change with a single analysis run.
 *
 * The readiness graph already carries the M3 analysis it was built from, so
 * the screen asks for the graph first and shows the findings from it. Only
 * when the graph cannot be built does it fall back to `analyzeChange`, so the
 * findings stay visible while the impact path shows its own error.
 */
export function useReadinessCheck(issueKey: string): ReadinessCheck {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  // Identifies the newest request; answers to older ones are dropped.
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    const current = () => run.current === id;
    const base = { issueKey, attempt };
    void api.getReadinessGraph({ issueKey }).then(async (graph) => {
      if (!current()) return;
      if (graph.ok) {
        setSettled({
          ...base,
          analysis: { status: 'ready', data: graph.data.analysis },
          graph: { status: 'ready', data: graph.data },
        });
        return;
      }
      const graphState = toState<ReadinessGraph>(graph);
      setSettled({ ...base, analysis: LOADING, graph: graphState });
      const analysis = await api.analyzeChange({ issueKey });
      if (!current()) return;
      setSettled({ ...base, analysis: toState(analysis), graph: graphState });
    });
    return () => {
      run.current += 1;
    };
  }, [issueKey, attempt]);

  /** Runs the whole check again (used when the analysis itself failed). */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** Asks for the graph again and keeps the findings on screen meanwhile. */
  const retryGraph = useCallback(() => {
    const id = ++run.current;
    setSettled((s) => (s ? { ...s, graph: LOADING } : s));
    void api.getReadinessGraph({ issueKey }).then((graph) => {
      if (run.current !== id) return;
      setSettled((s) =>
        s && s.issueKey === issueKey
          ? {
              ...s,
              graph: toState(graph),
              // Findings and impact path then come from the same read.
              analysis: graph.ok ? { status: 'ready', data: graph.data.analysis } : s.analysis,
            }
          : s,
      );
    });
  }, [issueKey]);

  const fresh = settled && settled.issueKey === issueKey && settled.attempt === attempt;
  return {
    analysis: fresh ? settled.analysis : LOADING,
    graph: fresh ? settled.graph : LOADING,
    retry,
    retryGraph,
  };
}
