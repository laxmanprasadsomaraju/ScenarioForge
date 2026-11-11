import {
  BookWithBookmarkIcon,
  ChangesIcon,
  ClockIcon,
  CrossIcon,
  HomeIcon,
  ListBulletedIcon,
  MenuIcon,
  PeopleGroupIcon,
  SearchIcon,
  SettingsIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  ThemeIcon,
} from './icons';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { ROUTES, type NavGroup, type RouteDef, type RouteId } from '../lib/routes';
import { useRouter } from '../lib/router';
import { previewMode } from '../lib/preview';
import { useMedia } from '../lib/useMedia';
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
/** Matches the CSS: under 60rem the sidebar becomes a modal drawer. */
const DRAWER = '(max-width: 60rem)';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The drawer's focus ring. Its head (rail toggle) and the rail's theme menu are not shown in the drawer. */
function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden], .sidebar-head, .theme-menu'),
  );
}

/** Rail only: the appearance choice behind one button, so the rail stays icons. */
function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return (
    <div className="theme-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="rail-toggle theme-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        title="Appearance"
        onClick={() => setOpen((value) => !value)}
      >
        <ThemeIcon label="" />
        <span className="visually-hidden">Appearance</span>
      </button>
      <div id={panelId} className="theme-menu-panel" hidden={!open}>
        <AppearanceControl compact />
      </div>
    </div>
  );
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
  const drawerLayout = useMedia(DRAWER);
  const rail = navPreference === 'rail' || (navPreference === null && narrowDesktop);
  const drawerOpen = menuOpen && drawerLayout;
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
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

  // The drawer is modal: the screen behind is inert, Tab cycles between the
  // toggle and the drawer, Escape closes it and hands focus back to the toggle.
  useEffect(() => {
    const main = mainRef.current;
    if (!drawerOpen || !main) return;
    main.setAttribute('inert', '');
    const first = focusables(navRef.current)[0];
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const ring = [toggleRef.current, ...focusables(navRef.current)].filter(
        (el): el is HTMLElement => el !== null,
      );
      const index = ring.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? index <= 0
          ? ring.length - 1
          : index - 1
        : index === -1 || index === ring.length - 1
          ? 0
          : index + 1;
      event.preventDefault();
      ring[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      main.removeAttribute('inert');
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

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

      <div className="scrim" hidden={!drawerOpen} onClick={() => setMenuOpen(false)} />

      <nav
        ref={navRef}
        id="primary-nav"
        className="sidebar"
        data-open={menuOpen}
        aria-label="ScenarioForge"
      >
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
        <div className="sidebar-nav">
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
        </div>
        <div className="sidebar-foot">
          <ul className="nav-list">
            <NavItem
              route={settings}
              current={settings.id === route.id}
              rail={rail}
              onNavigate={go}
            />
          </ul>
          {rail ? <ThemeMenu /> : null}
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
