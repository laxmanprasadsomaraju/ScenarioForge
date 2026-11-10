import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import HomeIcon from '@atlaskit/icon/core/home';
import ChangesIcon from '@atlaskit/icon/core/changes';
import SearchIcon from '@atlaskit/icon/core/search';
import BookWithBookmarkIcon from '@atlaskit/icon/core/book-with-bookmark';
import ClockIcon from '@atlaskit/icon/core/clock';
import PeopleGroupIcon from '@atlaskit/icon/core/people-group';
import ListBulletedIcon from '@atlaskit/icon/core/list-bulleted';
import SettingsIcon from '@atlaskit/icon/core/settings';
import SidebarCollapseIcon from '@atlaskit/icon/core/sidebar-collapse';
import SidebarExpandIcon from '@atlaskit/icon/core/sidebar-expand';
import MenuIcon from '@atlaskit/icon/core/menu';
import CrossIcon from '@atlaskit/icon/core/cross';
import { ROUTES, type NavGroup, type RouteDef, type RouteId } from '../lib/routes';
import { useRouter } from '../lib/router';
import { previewMode } from '../lib/preview';
import { AppearanceControl } from './AppearanceControl';

type IconType = ComponentType<{ label: string; size?: 'small' | 'medium' }>;

const ICONS: Record<RouteId, IconType> = {
  overview: HomeIcon,
  changes: ChangesIcon,
  readiness: SearchIcon,
  plans: BookWithBookmarkIcon,
  simulations: ClockIcon,
  'crisis-room': PeopleGroupIcon,
  reports: ListBulletedIcon,
  settings: SettingsIcon,
};

const GROUPS: { id: NavGroup; label?: string }[] = [
  { id: 'home' },
  { id: 'detect', label: 'Detect' },
  { id: 'understand', label: 'Understand' },
  { id: 'rehearse', label: 'Rehearse' },
  { id: 'verify', label: 'Verify' },
];

/** The user's collapse choice, per browser. Absent means automatic: a rail on narrow desktops. */
export const NAV_KEY = 'sf.nav';
type NavPreference = 'rail' | 'expanded' | null;

function readNavPreference(): NavPreference {
  try {
    const value = window.localStorage.getItem(NAV_KEY);
    return value === 'rail' || value === 'expanded' ? value : null;
  } catch {
    return null;
  }
}

function writeNavPreference(value: Exclude<NavPreference, null>) {
  try {
    window.localStorage.setItem(NAV_KEY, value);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
}

/** Matches the CSS: a rail by default from 60rem to 80rem, the full sidebar above. */
const NARROW_DESKTOP = '(max-width: 80rem)';

function useMedia(query: string): boolean {
  const get = () => {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

function Mark() {
  // An anvil face reduced to two strokes: the forge in ScenarioForge.
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" className="brand-mark-ground" />
      <path d="M6 9.5h12l-3 3.5H9.5z M10 13v4.5 M14 13v4.5" className="brand-mark-stroke" />
    </svg>
  );
}

function NavItem({
  route,
  current,
  rail,
  onNavigate,
}: {
  route: RouteDef;
  current: boolean;
  rail: boolean;
  onNavigate: (id: RouteId) => void;
}) {
  const Icon = ICONS[route.id];
  return (
    <li>
      <a
        href={route.path}
        className="nav-link"
        aria-current={current ? 'page' : undefined}
        // In the rail the label is hidden visually; the title gives sighted pointer users the name.
        title={rail ? route.label : undefined}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(route.id);
        }}
      >
        <span className="nav-icon">
          <Icon label="" />
        </span>
        <span className="nav-label">{route.label}</span>
        {route.upcoming ? (
          <span className="nav-upcoming">
            <span className="visually-hidden">,</span> coming later
          </span>
        ) : null}
      </a>
    </li>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { route, navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navPreference, setNavPreference] = useState<NavPreference>(readNavPreference);
  const narrowDesktop = useMedia(NARROW_DESKTOP);
  const rail = navPreference === 'rail' || (navPreference === null && narrowDesktop);
  const mainRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // After navigation (not on first load), move focus to the new screen so
  // keyboard and screen reader users land on it.
  const shownRoute = useRef(route.id);
  useEffect(() => {
    if (route.id !== shownRoute.current) {
      shownRoute.current = route.id;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [route.id]);

  // The mobile menu closes on Escape and hands focus back to its toggle.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const toggleRail = useCallback(() => {
    const next = rail ? 'expanded' : 'rail';
    setNavPreference(next);
    writeNavPreference(next);
  }, [rail]);

  const go = useCallback(
    (id: RouteId) => {
      setMenuOpen(false);
      navigate(id);
    },
    [navigate],
  );

  const settings = ROUTES.find((r) => r.id === 'settings')!;

  return (
    <div className="shell" data-rail={rail}>
      <header className="topbar">
        <span className="brand">
          <Mark />
          <span className="brand-name">ScenarioForge</span>
        </span>
        <button
          ref={toggleRef}
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <CrossIcon label="" /> : <MenuIcon label="" />}
          <span>{menuOpen ? 'Close menu' : 'Menu'}</span>
        </button>
      </header>

      <nav id="primary-nav" className="sidebar" data-open={menuOpen} aria-label="ScenarioForge">
        <div className="sidebar-head">
          <span className="brand brand-sidebar">
            <Mark />
            <span className="brand-name">ScenarioForge</span>
          </span>
          <button
            type="button"
            className="rail-toggle"
            aria-controls="primary-nav"
            aria-expanded={!rail}
            title={rail ? 'Expand navigation' : 'Collapse navigation'}
            onClick={toggleRail}
          >
            {rail ? <SidebarExpandIcon label="" /> : <SidebarCollapseIcon label="" />}
            <span className="visually-hidden">
              {rail ? 'Expand navigation' : 'Collapse navigation'}
            </span>
          </button>
        </div>
        {GROUPS.map((group) => {
          const items = ROUTES.filter((r) => r.group === group.id);
          const labelId = `nav-group-${group.id}`;
          return (
            <div key={group.id} className="nav-group">
              {group.label ? (
                <span id={labelId} className="nav-group-label">
                  {group.label}
                </span>
              ) : null}
              <ul className="nav-list" aria-labelledby={group.label ? labelId : undefined}>
                {items.map((r) => (
                  <NavItem
                    key={r.id}
                    route={r}
                    current={r.id === route.id}
                    rail={rail}
                    onNavigate={go}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        <div className="sidebar-foot">
          <ul className="nav-list">
            <NavItem
              route={settings}
              current={settings.id === route.id}
              rail={rail}
              onNavigate={go}
            />
          </ul>
          <AppearanceControl compact />
        </div>
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
