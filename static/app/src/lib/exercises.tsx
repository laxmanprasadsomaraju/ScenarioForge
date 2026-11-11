import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { ExerciseEvaluation, ExerciseSession, SimulationScenario } from '@shared/domain/types';
import type { RetestComparison, ScenarioRemediationModel } from '@shared/simulation/types';
import { FixApprovalProvider } from './fixApprovals';

export interface CompletedExercise {
  /** The exact scenario version played; a retest runs a remediated version. */
  scenario: SimulationScenario;
  /** Remediation model of the scenario played, used for retests and verdicts. */
  remediation: ScenarioRemediationModel;
  session: ExerciseSession;
  evaluation: ExerciseEvaluation;
  completedAt: string;
  /** Present when this run was a targeted retest of an earlier one. */
  retest?: {
    comparison: RetestComparison;
    appliedRemediationIds: string[];
    original: CompletedExercise;
  };
}

interface ExerciseLog {
  completed: CompletedExercise[];
  record: (exercise: CompletedExercise) => void;
}

const ExerciseContext = createContext<ExerciseLog>({ completed: [], record: () => {} });

/**
 * Exercise results for this browser tab only, with the fixes approved
 * (simulated) for them. Saved, verifiable records live in History.
 */
export function ExerciseProvider({ children }: { children: ReactNode }) {
  const [completed, setCompleted] = useState<CompletedExercise[]>([]);
  const record = useCallback(
    (exercise: CompletedExercise) => setCompleted((list) => [exercise, ...list]),
    [],
  );
  return (
    <ExerciseContext.Provider value={{ completed, record }}>
      <FixApprovalProvider>{children}</FixApprovalProvider>
    </ExerciseContext.Provider>
  );
}

export const useExercises = () => useContext(ExerciseContext);
