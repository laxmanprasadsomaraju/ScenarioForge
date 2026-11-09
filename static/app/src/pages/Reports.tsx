import Button from '@atlaskit/button/new';
import { useEffect, useRef, useState } from 'react';
import { useExercises, type CompletedExercise } from '../lib/exercises';
import { formatAbsolute } from '../lib/format';
import { useRouter } from '../lib/router';
import { OriginTag } from '../components/OriginTag';
import { PageHeader } from '../components/Shell';
import { EmptyState } from '../components/States';
import { Debrief } from '../components/simulation/Debrief';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';

export function ReportsPage() {
  const { completed } = useExercises();
  const { navigate } = useRouter();
  const [open, setOpen] = useState<CompletedExercise | null>(null);
  // After "Back to reports", return focus to the row the report was opened from.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open && returnTo) returnButton.current?.focus();
  }, [open, returnTo]);

  if (open) {
    return (
      <>
        <PageHeader
          title="After-action report"
          lead={authBackupRetiredScenario.title}
          aside={
            <Button
              onClick={() => {
                setReturnTo(open.session.id);
                setOpen(null);
              }}
            >
              Back to reports
            </Button>
          }
        />
        <Debrief scenario={authBackupRetiredScenario} exercise={open} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        lead="After-action reports from rehearsals in this browser session."
        aside={<OriginTag origin="demo" />}
      />
      <section className="region" aria-labelledby="reports-title">
        <h2 id="reports-title" className="visually-hidden">
          Completed rehearsals
        </h2>
        {completed.length === 0 ? (
          <EmptyState
            title="No reports yet"
            action={{ label: 'Run the demo rehearsal', onClick: () => navigate('simulations') }}
          >
            Finish a rehearsal and its report appears here. Saved, shareable reports arrive with M5.
          </EmptyState>
        ) : (
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Finished</th>
                <th scope="col">Scenario</th>
                <th scope="col" className="num">
                  Objectives met
                </th>
                <th scope="col" className="num">
                  Simulated time
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {completed.map((ex) => (
                <tr key={ex.session.id}>
                  <td>{formatAbsolute(ex.completedAt)}</td>
                  <th scope="row">{authBackupRetiredScenario.title}</th>
                  <td className="num">
                    {ex.evaluation.metCount} of {ex.evaluation.totalCount}
                  </td>
                  <td className="num">{ex.evaluation.elapsedMinutes} min</td>
                  <td>
                    <Button
                      appearance="subtle"
                      ref={ex.session.id === returnTo ? returnButton : undefined}
                      aria-label={`Open report from ${formatAbsolute(ex.completedAt)}`}
                      onClick={() => setOpen(ex)}
                    >
                      Open report
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
