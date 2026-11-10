import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { ChangeAnalysis } from '@shared/analysis/types';
import type { SimulationScenario } from '@shared/domain/types';
import type { GeneratedRehearsal } from '@shared/rehearsal/types';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import type { ScenarioRemediationModel } from '@shared/simulation/types';

/** A scenario together with the remediation model its retests use. */
export interface RehearsalSource {
  scenario: SimulationScenario;
  remediation: ScenarioRemediationModel;
  /** Present only for rehearsals generated from a real M3 finding. */
  provenance?: GeneratedRehearsal['provenance'];
  /** The analysis the finding came from, so a work item can quote it (M8 preview). */
  analysis?: ChangeAnalysis;
}

export const DEMO_SOURCE: RehearsalSource = {
  scenario: authBackupRetiredScenario,
  remediation: authBackupRetiredRemediation,
};

interface RehearsalSourceValue {
  source: RehearsalSource;
  selectGenerated: (rehearsal: GeneratedRehearsal, analysis?: ChangeAnalysis) => void;
  selectDemo: () => void;
}

const RehearsalSourceContext = createContext<RehearsalSourceValue>({
  source: DEMO_SOURCE,
  selectGenerated: () => {},
  selectDemo: () => {},
});

/** In-memory for this tab, like the exercise log; persistence arrives with storage (M6). */
export function RehearsalSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<RehearsalSource>(DEMO_SOURCE);
  const selectGenerated = useCallback(
    (rehearsal: GeneratedRehearsal, analysis?: ChangeAnalysis) =>
      setSource({
        scenario: rehearsal.scenario,
        remediation: rehearsal.remediation,
        provenance: rehearsal.provenance,
        analysis,
      }),
    [],
  );
  const selectDemo = useCallback(() => setSource(DEMO_SOURCE), []);
  return (
    <RehearsalSourceContext.Provider value={{ source, selectGenerated, selectDemo }}>
      {children}
    </RehearsalSourceContext.Provider>
  );
}

export const useRehearsalSource = () => useContext(RehearsalSourceContext);
