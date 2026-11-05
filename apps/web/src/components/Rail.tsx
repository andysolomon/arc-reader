import { NavLink, useNavigate } from "react-router-dom";
import { PenLine, Library, Mic, SlidersHorizontal, Terminal, PanelLeft } from "lucide-react";
import { THEMES, getTheme } from "@readaloud/tokens";
import { ThemeIcon, cn } from "@readaloud/ui";
import { useSettings, useThemeId } from "../state/settings";

export const NAV = [
  { to: "/", label: "Compose", Icon: PenLine, end: true },
  { to: "/library", label: "Library", Icon: Library },
  { to: "/voices", label: "Voices", Icon: Mic },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
  { to: "/linux", label: "Linux client", Icon: Terminal },
];

export function useCycleTheme() {
  const theme = useThemeId();
  const set = useSettings((s) => s.set);
  return () => {
    const i = THEMES.findIndex((t) => t.id === theme);
    set("theme", THEMES[(i + 1) % THEMES.length].id);
  };
}

export function Rail() {
  const open = useSettings((s) => s.railOpen);
  const set = useSettings((s) => s.set);
  const theme = getTheme(useThemeId());
  const cycle = useCycleTheme();
  const navigate = useNavigate();
  const email = useSettings((s) => s.email);
  const item = "flex h-10 w-full items-center gap-2.5 overflow-hidden rounded-control border-0 px-2.5 text-[14px] transition-colors duration-fast";
  return (
    <nav
      aria-label="Primary"
      className="flex shrink-0 flex-col gap-0.5 overflow-hidden border-r border-line bg-bg p-3 transition-[width] duration-base ease-out"
      style={{ width: open ? 216 : 64 }}
      data-open={open}
    >
      <div className="mb-3 flex h-10 items-center gap-2.5 overflow-hidden px-1.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-control bg-accent font-serif text-[15px] font-semibold text-accent-fg" aria-hidden>
          R
        </span>
        {open && <span className="whitespace-nowrap font-serif text-[17px] font-medium">ReadAloud</span>}
      </div>
      {NAV.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          className={({ isActive }) => cn(item, isActive ? "bg-bg3 text-fg" : "bg-transparent text-fg2 hover:bg-bg3 hover:text-fg")}
          aria-label={open ? undefined : label}
        >
          <span className="grid size-5 shrink-0 place-items-center">
            <Icon size={20} strokeWidth={1.5} aria-hidden />
          </span>
          {open && <span className="whitespace-nowrap">{label}</span>}
        </NavLink>
      ))}
      <div className="flex-1" />
      <button type="button" onClick={cycle} title="Switch theme" aria-label={`Switch theme (current: ${theme.name})`} className={cn(item, "bg-transparent text-fg2 hover:bg-bg3 hover:text-fg")}>
        <span className="grid size-5 shrink-0 place-items-center">
          <ThemeIcon scheme={theme.scheme} />
        </span>
        {open && <span className="whitespace-nowrap">{theme.name}</span>}
      </button>
      <button type="button" onClick={() => navigate("/auth")} className={cn(item, "px-1.5 bg-transparent text-fg2 hover:bg-bg3 hover:text-fg")} aria-label={email ? `Account: ${email}` : "Sign in"}>
        <span className={cn("size-7 shrink-0 rounded-full", email ? "bg-accent" : "border border-dashed border-fg3")} aria-hidden />
        {open && <span className="truncate whitespace-nowrap">{email ?? "Sign in"}</span>}
      </button>
      <button
        type="button"
        onClick={() => set("railOpen", !open)}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={open}
        className={cn(item, "bg-transparent text-fg3 hover:bg-bg3 hover:text-fg")}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          <PanelLeft size={20} strokeWidth={1.5} aria-hidden />
        </span>
      </button>
    </nav>
  );
}
