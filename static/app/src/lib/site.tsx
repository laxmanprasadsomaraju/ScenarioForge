import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { router, view } from '@forge/bridge';
import { bridgeCall } from './preview';

interface SiteContextValue {
  siteUrl: string | null;
  openInJira: (path: string) => void;
}

const SiteContext = createContext<SiteContextValue>({ siteUrl: null, openInJira: () => {} });

export function SiteProvider({ children }: { children: ReactNode }) {
  const [siteUrl, setSiteUrl] = useState<string | null>(null);

  useEffect(() => {
    bridgeCall(() => view.getContext())
      .then((context) => setSiteUrl(typeof context.siteUrl === 'string' ? context.siteUrl : null))
      .catch(() => setSiteUrl(null));
  }, []);

  const openInJira = (path: string) => {
    // Forge confirms external navigation; same-site Jira paths open directly.
    bridgeCall(() => router.open(siteUrl ? `${siteUrl}${path}` : path)).catch(() => undefined);
  };

  return <SiteContext.Provider value={{ siteUrl, openInJira }}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext);
