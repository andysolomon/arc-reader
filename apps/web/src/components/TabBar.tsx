import { Link, useLocation } from "react-router-dom";
import { cn } from "@readaloud/ui";
import { COMPOSE, LIBRARY, SCREENS, isCurrent } from "./Rail";

const SURFACE = "border border-line bg-bg2 shadow-[0_6px_20px_-12px_rgba(0,0,0,.6)]";

/**
 * Bottom bar for < 640px: the Library and the other screens as icons in one capsule, with
 * Compose on its own beside it, the one thing here that makes something new.
 */
export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Primary" className="flex shrink-0 items-center gap-3 bg-bg px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2">
      <div className={cn("flex h-14 min-w-0 flex-1 items-center justify-between rounded-full px-1.5", SURFACE)}>
        {[LIBRARY, ...SCREENS].map((screen) => {
          const active = isCurrent(screen, pathname, true);
          return (
            <Link
              key={screen.to}
              to={screen.to}
              aria-label={screen.label}
              aria-current={active ? "page" : undefined}
              className={cn("grid h-11 min-w-11 flex-1 place-items-center rounded-full transition-colors duration-fast", active ? "bg-bg3 text-accent" : "text-fg2 active:bg-bg3")}
            >
              <screen.Icon size={22} strokeWidth={active ? 2 : 1.5} aria-hidden />
            </Link>
          );
        })}
      </div>
      <Link to={COMPOSE.to} aria-label={COMPOSE.label} aria-current={pathname === COMPOSE.to ? "page" : undefined} className={cn("grid size-14 shrink-0 place-items-center rounded-full transition-colors duration-fast active:bg-bg3", SURFACE, pathname === COMPOSE.to ? "text-accent" : "text-fg")}>
        <COMPOSE.Icon size={22} strokeWidth={1.5} aria-hidden />
      </Link>
    </nav>
  );
}
