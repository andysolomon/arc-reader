import { NavLink } from "react-router-dom";
import { cn } from "@readaloud/ui";
import { NAV } from "./Rail";

/** Bottom tab bar for < 640px. */
export function TabBar() {
  return (
    <nav aria-label="Primary" className="flex h-14 shrink-0 items-stretch border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
      {NAV.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cn("flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]", isActive ? "text-fg" : "text-fg2")}
        >
          {({ isActive }) => (
            <>
              <span className={cn("grid h-7 w-11 place-items-center rounded-control", isActive && "bg-bg3")}>
                <Icon size={20} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="truncate">{label === "Linux client" ? "Linux" : label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
