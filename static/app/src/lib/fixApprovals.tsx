import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Simulated fix approvals, per browser tab. Approving a fix in a report only
 * marks it for a targeted retest of that run; nothing is sent to Jira and
 * nothing is saved. Keyed by the session id of the run the fix was proposed for.
 */
export type FixApprovals = Readonly<Record<string, readonly string[]>>;

interface FixApprovalStore {
  approvals: FixApprovals;
  /** Replaces the approved fix ids for one run; an empty list clears it. */
  setApproved: (sessionId: string, remediationIds: string[]) => void;
}

const FixApprovalContext = createContext<FixApprovalStore>({
  approvals: {},
  setApproved: () => {},
});

export function FixApprovalProvider({ children }: { children: ReactNode }) {
  const [approvals, setApprovals] = useState<FixApprovals>({});
  const setApproved = useCallback((sessionId: string, remediationIds: string[]) => {
    setApprovals((all) => {
      const next = { ...all };
      if (remediationIds.length === 0) delete next[sessionId];
      else next[sessionId] = [...remediationIds];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ approvals, setApproved }), [approvals, setApproved]);
  return <FixApprovalContext.Provider value={value}>{children}</FixApprovalContext.Provider>;
}

export const useFixApprovals = () => useContext(FixApprovalContext);

/** Fix ids approved (simulated, this tab) for one run. */
export function approvedFor(approvals: FixApprovals, sessionId: string): readonly string[] {
  return approvals[sessionId] ?? [];
}
