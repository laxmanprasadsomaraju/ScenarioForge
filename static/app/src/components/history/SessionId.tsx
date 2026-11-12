import { useRef, useState } from 'react';
import { Button } from '../Button';

/** The id shape the Exercise Facilitator's explain-outcome action accepts. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

type CopyState = 'idle' | 'copied' | 'manual';

/**
 * The rehearsal session id with a Copy button. If the clipboard is blocked the
 * text is selected so the user can copy it by hand. The id is never logged.
 */
export function SessionId({ id }: { id: string | undefined }) {
  const text = useRef<HTMLElement>(null);
  const [result, setResult] = useState<{ id: string; state: CopyState }>({
    id: '',
    state: 'idle',
  });
  // A result belongs to the id it was made for, so a reused component never shows a stale 'Copied'.
  const copy: CopyState = result.id === id ? result.state : 'idle';
  if (!id || !SESSION_ID_PATTERN.test(id)) return null;

  const select = () => {
    const node = text.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setResult({ id, state: 'copied' });
    } catch {
      select();
      setResult({ id, state: 'manual' });
    }
  };

  return (
    <>
      <dt>Session ID</dt>
      <dd className="session-id">
        <span className="session-id-row">
          <code className="session-id-value" ref={text}>
            {id}
          </code>
          <Button spacing="compact" onClick={onCopy} aria-label="Copy session ID">
            Copy
          </Button>
          <span role="status" aria-live="polite" className="session-id-status">
            {copy === 'copied'
              ? 'Copied'
              : copy === 'manual'
                ? 'Press Ctrl+C or Cmd+C to copy'
                : ''}
          </span>
        </span>
        <span className="session-id-help">
          Use this ID when asking the Exercise Facilitator to explain this rehearsal.
        </span>
      </dd>
    </>
  );
}
