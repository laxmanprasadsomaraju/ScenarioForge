import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { router, view } from '@forge/bridge';
import { bridgeCall } from './preview';

interface SiteContextValue {
  siteUrl: string | null;
  /** The viewer's Atlassian account id from the Forge context, used to record approvals. */
  accountId: string | null;
  openInJira: (path: string) => void;
}

const SiteContext = createContext<SiteContextValue>({
  siteUrl: null,
  accountId: null,
  openInJira: () => {},
});

export function SiteProvider({ children }: { children: ReactNode }) {
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    bridgeCall(() => view.getContext())
      .then((context) => {
        setSiteUrl(typeof context.siteUrl === 'string' ? context.siteUrl : null);
        setAccountId(typeof context.accountId === 'string' ? context.accountId : null);
      })
      .catch(() => {
        setSiteUrl(null);
        setAccountId(null);
      });
  }, []);

  const openInJira = (path: string) => {
    // Forge confirms external navigation; same-site Jira paths open directly.
    bridgeCall(() => router.open(siteUrl ? `${siteUrl}${path}` : path)).catch(() => undefined);
  };

  return (
    <SiteContext.Provider value={{ siteUrl, accountId, openInJira }}>
      {children}
    </SiteContext.Provider>
  );
}

export const useSite = () => useContext(SiteContext);
