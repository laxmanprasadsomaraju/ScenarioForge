export type RouteId =
  | 'overview'
  | 'changes'
  | 'plans'
  | 'readiness'
  | 'simulations'
  | 'crisis-room'
  | 'reports'
  | 'settings';

/** Where a destination sits in the journey: Detect, Understand, Rehearse, Verify. */
export type NavGroup = 'home' | 'detect' | 'understand' | 'rehearse' | 'verify' | 'footer';

export interface RouteDef {
  id: RouteId;
  path: string;
  /** The destination's name in the navigation. Plain words, no milestone codes. */
  label: string;
  group: NavGroup;
  /** Shown but not working yet; the nav says "coming later" instead of a milestone. */
  upcoming?: boolean;
}

// Paths never change, so existing Jira URLs and deep links stay valid; only labels do.
export const ROUTES: RouteDef[] = [
  { id: 'overview', path: '/', label: 'Command center', group: 'home' },
  { id: 'changes', path: '/changes', label: 'Changes', group: 'detect' },
  { id: 'readiness', path: '/readiness-checks', label: 'Readiness checks', group: 'understand' },
  { id: 'plans', path: '/recovery-plans', label: 'Runbooks', group: 'understand' },
  { id: 'simulations', path: '/simulations', label: 'Rehearsals', group: 'rehearse' },
  {
    id: 'crisis-room',
    path: '/crisis-room',
    label: 'Crisis room',
    group: 'rehearse',
    upcoming: true,
  },
  { id: 'reports', path: '/reports', label: 'History', group: 'verify' },
  { id: 'settings', path: '/settings', label: 'Settings', group: 'footer' },
];

export function routeForPath(pathname: string): RouteDef {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean) ?? ROUTES[0]!;
}
