import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { JiraIssueSummary } from '@shared/api';
import { readinessLinkPath } from '@shared/links/deepLink';
import { useRouter } from './router';

/** The change being checked: its key always, its Jira row when it was picked from a list. */
export interface SelectedChange {
  key: string;
  /** Absent when the check was opened from a link; the analysis supplies it once read. */
  summary: JiraIssueSummary | null;
  /** Finding id from a link, to scroll to once the user's own result has loaded. */
  focusFinding: string | null;
}

interface ChangeSelectionValue {
  /** The change whose recovery impact is being checked, if any. */
  selected: SelectedChange | null;
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
 * The change being checked lives in the URL (`/readiness-checks?change=KEY`),
 * so a check can be linked and back/forward move between checks. Leaving
 * Readiness checks drops it, and returning through the navigation shows the
 * list again rather than silently re-running a check. Only the key comes from
 * the URL; everything shown is read again by the user's own check.
 */
export function ChangeSelectionProvider({ children }: { children: ReactNode }) {
  const { route, link, navigate, navigatePath } = useRouter();
  // Rows the user picked in this tab, so the header can show the summary while the check runs.
  const [picked, setPicked] = useState<Record<string, JiraIssueSummary>>({});

  const checkChange = useCallback(
    (issue: JiraIssueSummary) => {
      setPicked((rows) => ({ ...rows, [issue.key]: issue }));
      navigatePath(readinessLinkPath(issue.key));
    },
    [navigatePath],
  );
  const clear = useCallback(() => navigate('readiness'), [navigate]);

  const selected: SelectedChange | null =
    route.id === 'readiness' && link.kind === 'link' && link.link.route === 'readiness'
      ? {
          key: link.link.change,
          summary: picked[link.link.change] ?? null,
          focusFinding: link.link.finding ?? null,
        }
      : null;

  return (
    <ChangeSelectionContext.Provider value={{ selected, checkChange, clear }}>
      {children}
    </ChangeSelectionContext.Provider>
  );
}

export const useChangeSelection = () => useContext(ChangeSelectionContext);
