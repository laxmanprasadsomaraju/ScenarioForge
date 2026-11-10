export type RouteId =
  | 'overview'
  | 'changes'
  | 'plans'
  | 'readiness'
  | 'simulations'
  | 'crisis-room'
  | 'reports'
  | 'settings';

export interface RouteDef {
  id: RouteId;
  path: string;
  label: string;
  /** Milestone that makes the screen functional; absent when it works today. */
  plannedFor?: string;
}

export const ROUTES: RouteDef[] = [
  { id: 'overview', path: '/', label: 'Overview' },
  { id: 'changes', path: '/changes', label: 'Changes' },
  { id: 'plans', path: '/recovery-plans', label: 'Recovery plans' },
  { id: 'readiness', path: '/readiness-checks', label: 'Readiness checks' },
  { id: 'simulations', path: '/simulations', label: 'Simulations' },
  { id: 'crisis-room', path: '/crisis-room', label: 'Crisis room', plannedFor: 'M7' },
  { id: 'reports', path: '/reports', label: 'History' },
  { id: 'settings', path: '/settings', label: 'Settings' },
];

export function routeForPath(pathname: string): RouteDef {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean) ?? ROUTES[0]!;
}
