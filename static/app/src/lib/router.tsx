import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { view } from '@forge/bridge';
import { bridgeCall } from './preview';
import { routeForPath, ROUTES, type RouteDef, type RouteId } from './routes';

interface RouterValue {
  route: RouteDef;
  navigate: (id: RouteId) => void;
}

const RouterContext = createContext<RouterValue>({ route: ROUTES[0]!, navigate: () => {} });

type ForgeHistory = Awaited<ReturnType<typeof view.createHistory>>;

/**
 * Keeps the current screen in Jira's URL through Forge's history bridge so
 * screens can be linked and the browser back button works. Outside Jira (local
 * development) it falls back to in-memory state.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteDef>(ROUTES[0]!);
  const history = useRef<ForgeHistory | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    bridgeCall(() => view.createHistory())
      .then((h) => {
        history.current = h;
        setRoute(routeForPath(h.location.pathname));
        unlisten = h.listen((location) => setRoute(routeForPath(location.pathname)));
      })
      .catch(() => {
        history.current = null;
      });
    return () => unlisten?.();
  }, []);

  const navigate = useCallback((id: RouteId) => {
    const target = ROUTES.find((r) => r.id === id) ?? ROUTES[0]!;
    if (history.current) {
      history.current.push(target.path);
    } else {
      setRoute(target);
    }
  }, []);

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);
