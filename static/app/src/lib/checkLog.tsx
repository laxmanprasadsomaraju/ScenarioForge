import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AnalysisStatus, ChangeAnalysis } from '@shared/analysis/types';

/** One finding as the Command center needs it: no evidence, only what it ranks by. */
export interface CheckedFinding {
  id: string;
  confidence: 'confirmed' | 'suspected';
  pageTitle: string;
  stepOrder: number;
}

/** The latest readiness check of one change in this browser tab. */
export interface CheckRecord {
  changeKey: string;
  summary: string;
  analyzedAt: string;
  status: AnalysisStatus;
  findings: CheckedFinding[];
}

interface CheckLog {
  /** Newest first, one record per change (a re-check replaces the earlier one). */
  checks: CheckRecord[];
  record: (analysis: ChangeAnalysis) => void;
}

const CheckLogContext = createContext<CheckLog>({ checks: [], record: () => {} });

export function toCheckRecord(analysis: ChangeAnalysis): CheckRecord {
  return {
    changeKey: analysis.changeKey,
    summary: analysis.change.summary,
    analyzedAt: analysis.analyzedAt,
    status: analysis.status,
    findings: analysis.findings.map((f) => ({
      id: f.id,
      confidence: f.confidence,
      pageTitle: f.pageTitle,
      stepOrder: f.stepOrder,
    })),
  };
}

/**
 * Readiness checks the user ran in this tab. Not persisted: the Command center
 * labels every figure read from it "this session".
 */
export function CheckLogProvider({ children }: { children: ReactNode }) {
  const [checks, setChecks] = useState<CheckRecord[]>([]);
  const record = useCallback((analysis: ChangeAnalysis) => {
    const next = toCheckRecord(analysis);
    setChecks((list) => {
      const same = list.find((c) => c.changeKey === next.changeKey);
      if (same && same.analyzedAt === next.analyzedAt) return list;
      return [next, ...list.filter((c) => c.changeKey !== next.changeKey)];
    });
  }, []);
  const value = useMemo(() => ({ checks, record }), [checks, record]);
  return <CheckLogContext.Provider value={value}>{children}</CheckLogContext.Provider>;
}

export const useCheckLog = () => useContext(CheckLogContext);
