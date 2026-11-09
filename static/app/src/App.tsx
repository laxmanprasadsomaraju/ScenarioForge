import { ExerciseProvider } from './lib/exercises';
import { RouterProvider, useRouter } from './lib/router';
import { SiteProvider } from './lib/site';
import { Shell } from './components/Shell';
import { ChangesPage } from './pages/Changes';
import { OverviewPage } from './pages/Overview';
import { PLANNED, PlannedPage } from './pages/Planned';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SimulationsPage } from './pages/Simulations';

function Screen() {
  const { route } = useRouter();
  switch (route.id) {
    case 'overview':
      return <OverviewPage />;
    case 'changes':
      return <ChangesPage />;
    case 'plans':
    case 'readiness':
    case 'crisis-room':
      return <PlannedPage screen={PLANNED[route.id]} />;
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
            <Screen />
          </Shell>
        </ExerciseProvider>
      </RouterProvider>
    </SiteProvider>
  );
}
