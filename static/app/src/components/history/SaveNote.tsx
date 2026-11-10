import { SAVE_TEXT, type SaveOutcome } from './save';

/** One quiet line under the debrief result; the in-tab report is kept whatever it says. */
export function SaveNote({ outcome }: { outcome: SaveOutcome | null }) {
  if (!outcome) return null;
  const text =
    outcome.kind === 'saving'
      ? SAVE_TEXT.saving
      : outcome.kind === 'saved'
        ? SAVE_TEXT.saved
        : outcome.kind === 'not-enabled'
          ? SAVE_TEXT.notEnabled
          : `Not saved: ${outcome.reason}`;
  return (
    <p className={`save-note save-note-${outcome.kind}`} role="status">
      {text}
    </p>
  );
}
