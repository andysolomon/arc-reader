import { useEffect } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { SquarePen, Library, Mic, SlidersHorizontal, PanelLeft, AudioLines, BookOpenCheck, type LucideIcon } from "lucide-react";
import { THEMES, getTheme } from "@readaloud/tokens";
import { ThemeIcon, cn } from "@readaloud/ui";
import { useSettings, useThemeId } from "../state/settings";
import { useLibrary } from "../state/library";
import { audioCache } from "../lib/db";
import { SidebarLibrary } from "./SidebarLibrary";

interface Screen {
  to: string;
  label: string;
  Icon: LucideIcon;
}

/** Adding a document. A wide screen keeps it at the front door; a phone opens on the Library instead. */
export const COMPOSE: Screen = { to: "/compose", label: "Compose", Icon: SquarePen };
export const LIBRARY: Screen = { to: "/library", label: "Library", Icon: Library };
/** Everything that is not the library: reached by an icon, on the sidebar's foot or a phone's bottom bar. */
export const SCREENS: Screen[] = [
  { to: "/voices", label: "Voices", Icon: Mic },
  { to: "/studio", label: "Studio", Icon: AudioLines },
  { to: "/practice", label: "Practice", Icon: BookOpenCheck },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
];

/** The front door is Compose on a screen wide enough to show the sidebar, and the Library on a phone. */
export const isCurrent = (screen: Screen, pathname: string, phone: boolean) =>
  pathname === screen.to || pathname.startsWith(`${screen.to}/`) || (pathname === "/" && screen === (phone ? LIBRARY : COMPOSE));

export function useCycleTheme() {
  const theme = useThemeId();
  const set = useSettings((s) => s.set);
  return () => {
    const i = THEMES.findIndex((t) => t.id === theme);
    set("theme", THEMES[(i + 1) % THEMES.length].id);
  };
}

/** Wide enough for a title and when it was added, the way a list of documents reads. */
export const RAIL_WIDTH = 300;

const ICON = "grid size-9 shrink-0 place-items-center rounded-control border-0 transition-colors duration-fast";
const IDLE = "bg-transparent text-fg2 hover:bg-bg3 hover:text-fg";

/** Sidebar for screens from 640px. Open, it is the library; closed, a column of icons. */
export function Rail() {
  const open = useSettings((s) => s.railOpen);
  const set = useSettings((s) => s.set);
  const theme = getTheme(useThemeId());
  const cycle = useCycleTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const email = useSettings((s) => s.email);
  const count = useLibrary((s) => s.items.length);

  // What the list shows of each document (how far through, whether finished) moves while you read: catch up between screens.
  useEffect(() => { if (open) void useLibrary.getState().refresh(); }, [open, pathname]);
  // Audio saved for a document shows on its row. Passages arrive in bursts while one is prepared, so catch up at most once a second.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = audioCache.subscribe(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void useLibrary.getState().refresh(); }, 1000);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [open]);

  const link = (screen: Screen) => {
    const active = isCurrent(screen, pathname, false);
    return (
      <Link key={screen.to} to={screen === COMPOSE ? "/" : screen.to} title={screen.label} aria-label={screen.label} aria-current={active ? "page" : undefined} className={cn(ICON, active ? "bg-bg3 text-fg" : IDLE)}>
        <screen.Icon size={20} strokeWidth={1.5} aria-hidden />
      </Link>
    );
  };
  const themeButton = (
    <button type="button" onClick={cycle} title={`Switch theme (current: ${theme.name})`} aria-label={`Switch theme (current: ${theme.name})`} className={cn(ICON, IDLE)}>
      <ThemeIcon scheme={theme.scheme} />
    </button>
  );
  const account = (
    <button type="button" onClick={() => navigate("/auth")} title={email ?? "Sign in"} aria-label={email ? `Account: ${email}` : "Sign in"} className={cn(ICON, IDLE)}>
      <span className={cn("size-6 rounded-full", email ? "bg-accent" : "border border-dashed border-fg3")} aria-hidden />
    </button>
  );
  const collapse = (
    <button type="button" onClick={() => set("railOpen", !open)} title={open ? "Collapse sidebar" : "Expand sidebar"} aria-label={open ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={open} className={cn(ICON, "bg-transparent text-fg3 hover:bg-bg3 hover:text-fg")}>
      <PanelLeft size={20} strokeWidth={1.5} aria-hidden />
    </button>
  );
  const mark = (
    <span className="grid size-7 shrink-0 place-items-center rounded-control bg-accent font-serif text-[15px] font-semibold text-accent-fg" aria-hidden>
      R
    </span>
  );

  return (
    <nav
      aria-label="Primary"
      className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-bg transition-[width] duration-base ease-out"
      style={{ width: open ? RAIL_WIDTH : 64 }}
      data-open={open}
    >
      {open ? (
        <>
          <div className="flex h-16 shrink-0 items-center gap-2.5 pl-[18px] pr-3">
            {mark}
            <span className="min-w-0 flex-1 truncate whitespace-nowrap font-serif text-[17px] font-medium">ReadAloud</span>
            {link(COMPOSE)}
          </div>
          <NavLink
            to={LIBRARY.to}
            className={({ isActive }) => cn("mx-2 mb-2 flex h-9 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-[14px] no-underline transition-colors duration-fast", isActive ? "bg-bg3 text-fg" : IDLE)}
          >
            <Library size={18} strokeWidth={1.5} aria-hidden />
            <span className="flex-1">Library</span>
            <span aria-hidden className="text-[12px] tabular-nums">{count || ""}</span>
          </NavLink>
          <SidebarLibrary />
          <div className="flex shrink-0 items-center gap-0.5 border-t border-line p-2">
            {SCREENS.map((screen) => link(screen))}
            <span className="flex-1" />
            {themeButton}
            {account}
            {collapse}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
          <div className="mb-3 grid h-10 place-items-center">{mark}</div>
          {link(COMPOSE)}
          {link(LIBRARY)}
          {SCREENS.map((screen) => link(screen))}
          <span className="flex-1" />
          {themeButton}
          {account}
          {collapse}
        </div>
      )}
    </nav>
  );
}
