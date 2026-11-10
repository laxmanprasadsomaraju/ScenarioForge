import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { JiraIssueSummary } from '@shared/api';
import { useRouter } from './router';

interface ChangeSelectionValue {
  /** The change whose recovery impact is being checked, if any. */
  selected: JiraIssueSummary | null;
  /** Opens the readiness check for one change, from any screen. */
  checkChange: (issue: JiraIssueSummary) => void;
  /** Returns the readiness screen to its list of changes. */
  clear: () => void;
}

const ChangeSelectionContext = createContext<ChangeSelectionValue>({
  selected: null,
  checkChange: () => {},
  clear: () => {},
});

/**
 * The router only knows screens, so the change being checked lives here. It is
 * in-app state, not part of Jira's URL: leaving Readiness checks drops it, and
 * returning shows the list again rather than silently re-running a check.
 */
export function ChangeSelectionProvider({ children }: { children: ReactNode }) {
  const { route, navigate } = useRouter();
  const [selected, setSelected] = useState<JiraIssueSummary | null>(null);
  const [seenRoute, setSeenRoute] = useState(route.id);

  // Adjusted during render (not in an effect) so the stale selection never paints.
  if (route.id !== seenRoute) {
    setSeenRoute(route.id);
    if (route.id !== 'readiness') setSelected(null);
  }

  const checkChange = useCallback(
    (issue: JiraIssueSummary) => {
      setSelected(issue);
      navigate('readiness');
    },
    [navigate],
  );
  const clear = useCallback(() => setSelected(null), []);

  return (
    <ChangeSelectionContext.Provider value={{ selected, checkChange, clear }}>
      {children}
    </ChangeSelectionContext.Provider>
  );
}

export const useChangeSelection = () => useContext(ChangeSelectionContext);
