import type { ReactNode } from 'react';

/**
 * A screen's title block: the h1, one lead sentence, and an aside for the
 * screen's origin badge, connection line or header actions.
 */
export function PageHeader({
  title,
  lead,
  aside,
}: {
  title: string;
  lead: string;
  aside?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        <p className="page-lead">{lead}</p>
      </div>
      {aside ? <div className="page-aside">{aside}</div> : null}
    </header>
  );
}
