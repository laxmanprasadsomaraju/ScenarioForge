import { useId, useState } from 'react';

/** The raw JQL or CQL behind a list, collapsed until asked for. Shown exactly as sent. */
export function ShowQuery({ query, language }: { query: string; language: 'JQL' | 'CQL' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="query-details">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide query' : 'Show query'}
      </button>
      <code id={id} hidden={!open} aria-label={`${language} query`}>
        {query}
      </code>
    </div>
  );
}
