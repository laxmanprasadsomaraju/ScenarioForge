import { lazy, Suspense } from 'react';
import { ChangeSelectionProvider } from './lib/changeSelection';
import { RehearsalSourceProvider } from './lib/rehearsalSource';
import { CheckLogProvider } from './lib/checkLog';
import { ExerciseProvider } from './lib/exercises';
import { RouterProvider, useRouter } from './lib/router';
import { SiteProvider } from './lib/site';
import { AppearanceProvider, subtreeAttributes } from './lib/appearance';
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
const ReadinessPage = lazy(() =>
  import('./pages/Readiness').then((m) => ({ default: m.ReadinessPage })),
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
      return <ReadinessPage />;
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

export function App({
  hostTheming,
  initialHostThemed = null,
}: {
  /** Jira's theming call, started in main.tsx before the first render. */
  hostTheming?: Promise<boolean>;
  initialHostThemed?: boolean | null;
} = {}) {
  return (
    <AppearanceProvider hostTheming={hostTheming} initialHostThemed={initialHostThemed}>
      {(mode) => (
        // The app root: an ADS subtree theme when Light or Dark overrides Jira's choice.
        <div className="app-root" {...subtreeAttributes(mode)}>
          <AppContent />
        </div>
      )}
    </AppearanceProvider>
  );
}

function AppContent() {
  return (
    <SiteProvider>
      <RouterProvider>
        <ChangeSelectionProvider>
          <RehearsalSourceProvider>
            <ExerciseProvider>
              <CheckLogProvider>
                <Shell>
                  <RoutedScreen />
                </Shell>
              </CheckLogProvider>
            </ExerciseProvider>
          </RehearsalSourceProvider>
        </ChangeSelectionProvider>
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
