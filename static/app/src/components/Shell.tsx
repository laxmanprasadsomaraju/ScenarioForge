import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ROUTES } from '../lib/routes';
import { useRouter } from '../lib/router';
import { previewMode } from '../lib/preview';

function Mark() {
  // An anvil face reduced to two strokes: the forge in ScenarioForge.
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" className="brand-mark-ground" />
      <path d="M6 9.5h12l-3 3.5H9.5z M10 13v4.5 M14 13v4.5" className="brand-mark-stroke" />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { route, navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // After navigation (not on first load), move focus to the new screen so
  // keyboard and screen reader users land on it.
  const shownRoute = useRef(route.id);
  useEffect(() => {
    if (route.id !== shownRoute.current) {
      shownRoute.current = route.id;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [route.id]);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <Mark />
          <span className="brand-name">ScenarioForge</span>
        </span>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close menu' : 'Menu'}
        </button>
      </header>

      <nav id="primary-nav" className="sidebar" data-open={menuOpen} aria-label="ScenarioForge">
        <span className="brand brand-sidebar">
          <Mark />
          <span className="brand-name">ScenarioForge</span>
          <span className="brand-suffix">AI</span>
        </span>
        <ul className="nav-list">
          {ROUTES.map((r) => (
            <li key={r.id}>
              <a
                href={r.path}
                className="nav-link"
                aria-current={r.id === route.id ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  navigate(r.id);
                }}
              >
                <span>{r.label}</span>
                {r.plannedFor ? <span className="nav-planned">{r.plannedFor}</span> : null}
              </a>
            </li>
          ))}
        </ul>
        <p className="sidebar-note">When things change, prove you’re still prepared.</p>
      </nav>

      <main ref={mainRef} className="main" tabIndex={-1}>
        {import.meta.env.DEV && previewMode ? (
          <p className="preview-banner" role="note">
            Development preview with fixture data ({previewMode}). Nothing here comes from Jira.
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}

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
