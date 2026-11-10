import { lazy, Suspense } from 'react';
import { ExerciseProvider } from './lib/exercises';
import { RouterProvider, useRouter } from './lib/router';
import { SiteProvider } from './lib/site';
import { Shell } from './components/Shell';
import { ScreenErrorBoundary, ScreenSkeleton } from './components/States';
import { ChangesPage } from './pages/Changes';
import { OverviewPage } from './pages/Overview';

// Overview and Changes are the screens people land on, so they ship in the
// entry chunk. The rest load on first visit, each as its own chunk.
const SimulationsPage = lazy(() =>
  import('./pages/Simulations').then((m) => ({ default: m.SimulationsPage })),
);
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const RecoveryPlansPage = lazy(() =>
  import('./pages/RecoveryPlans').then((m) => ({ default: m.RecoveryPlansPage })),
);
const PlannedPage = lazy(() => import('./pages/Planned').then((m) => ({ default: m.PlannedPage })));

function Screen() {
  const { route } = useRouter();
  switch (route.id) {
    case 'overview':
      return <OverviewPage />;
    case 'changes':
      return <ChangesPage />;
    case 'plans':
      return <RecoveryPlansPage />;
    case 'readiness':
    case 'crisis-room':
      return <PlannedPage id={route.id} />;
    case 'simulations':
      return <SimulationsPage />;
    case 'reports':
      return <ReportsPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

export function App() {
  return (
    <SiteProvider>
      <RouterProvider>
        <ExerciseProvider>
          <Shell>
            <RoutedScreen />
          </Shell>
        </ExerciseProvider>
      </RouterProvider>
    </SiteProvider>
  );
}

function RoutedScreen() {
  const { route } = useRouter();
  // Keyed by route so a failed chunk load on one screen does not stick to the next.
  return (
    <ScreenErrorBoundary key={route.id}>
      <Suspense fallback={<ScreenSkeleton label={`Loading ${route.label}`} />}>
        <Screen />
      </Suspense>
    </ScreenErrorBoundary>
  );
}
