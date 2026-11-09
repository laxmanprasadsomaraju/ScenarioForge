import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { ExerciseEvaluation, ExerciseSession, SimulationScenario } from '@shared/domain/types';
import type { RetestComparison } from '@shared/simulation/types';

export interface CompletedExercise {
  /** The exact scenario version played; a retest runs a remediated version. */
  scenario: SimulationScenario;
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
 * Demo exercise results for this browser session only. They are not persisted
 * and are always presented as demo data. Persistent, auditable exercise
 * records arrive with Forge Storage in M5.
 */
export function ExerciseProvider({ children }: { children: ReactNode }) {
  const [completed, setCompleted] = useState<CompletedExercise[]>([]);
  const record = useCallback(
    (exercise: CompletedExercise) => setCompleted((list) => [exercise, ...list]),
    [],
  );
  return (
    <ExerciseContext.Provider value={{ completed, record }}>{children}</ExerciseContext.Provider>
  );
}

export const useExercises = () => useContext(ExerciseContext);
