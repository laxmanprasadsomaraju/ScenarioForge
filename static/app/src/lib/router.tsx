import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { view } from '@forge/bridge';
import { parseDeepLink, type ParsedLink } from '@shared/links/deepLink';
import { bridgeCall, previewMode } from './preview';
import { routeForPath, ROUTES, type RouteDef, type RouteId } from './routes';

/** The part of the global page URL after `/scenarioforge`. */
export interface AppLocation {
  pathname: string;
  search: string;
}

interface RouterValue {
  route: RouteDef;
  /**
   * The link in the current URL, parsed strictly. It names identifiers only;
   * screens still load every record through the user's own resolvers.
   */
  link: ParsedLink;
  /** The raw query of the current location; screens with their own links parse it strictly. */
  search: string;
  navigate: (id: RouteId) => void;
  /** Pushes an app path that may carry a query, such as a canonical deep link. */
  navigatePath: (path: string) => void;
}

const RouterContext = createContext<RouterValue>({
  route: ROUTES[0]!,
  link: { kind: 'none' },
  search: '',
  navigate: () => {},
  navigatePath: () => {},
});

type ForgeHistory = Awaited<ReturnType<typeof view.createHistory>>;

function splitPath(path: string): AppLocation {
  const q = path.indexOf('?');
  return q < 0
    ? { pathname: path, search: '' }
    : { pathname: path.slice(0, q), search: path.slice(q) };
}

function toLocation(location: { pathname?: unknown; search?: unknown }): AppLocation {
  return {
    pathname: typeof location.pathname === 'string' ? location.pathname : '/',
    search: typeof location.search === 'string' ? location.search : '',
  };
}

/**
 * Keeps the current screen, and any deep link, in Jira's URL through Forge's
 * history bridge so screens can be linked and back/forward work. Outside Jira
 * (local development, tests without a history) it falls back to in-memory
 * state.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<AppLocation>({ pathname: '/', search: '' });
  const history = useRef<ForgeHistory | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    bridgeCall(() => view.createHistory())
      .then((h) => {
        history.current = h;
        setLocation(toLocation(h.location));
        unlisten = h.listen((next) => setLocation(toLocation(next)));
      })
      .catch(() => {
        history.current = null;
        // Dev preview only: `&path=/crisis-room?room=…` opens an app path directly.
        if (import.meta.env.DEV && previewMode) {
          const path = new URLSearchParams(window.location.search).get('path');
          if (path?.startsWith('/')) setLocation(splitPath(path));
        }
      });
    return () => unlisten?.();
  }, []);

  const navigatePath = useCallback((path: string) => {
    if (history.current) {
      history.current.push(path);
    } else {
      setLocation(splitPath(path));
    }
  }, []);

  const navigate = useCallback(
    (id: RouteId) => navigatePath((ROUTES.find((r) => r.id === id) ?? ROUTES[0]!).path),
    [navigatePath],
  );

  const value = useMemo<RouterValue>(
    () => ({
      route: routeForPath(location.pathname),
      // Only Readiness checks and Simulations take links; elsewhere the query is ignored.
      link: parseDeepLink(location.pathname, location.search),
      search: location.search,
      navigate,
      navigatePath,
    }),
    [location, navigate, navigatePath],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);
