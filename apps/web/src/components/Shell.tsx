import { Outlet, useLocation } from "react-router-dom";
import { Toast } from "@readaloud/ui";
import { Rail } from "./Rail";
import { TabBar } from "./TabBar";
import { PlayerHost } from "./PlayerHost";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { OfflineBanner } from "./OfflineBanner";
import { LiveRegion } from "./LiveRegion";
import { useShortcuts } from "../hooks/useShortcuts";
import { useBreakpoint } from "../hooks/useMedia";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";

export function Shell() {
  useShortcuts();
  const bp = useBreakpoint();
  const focus = usePlayer((s) => s.focus);
  const hasDoc = usePlayer((s) => !!s.doc);
  const toastMsg = useToast((s) => s.message);
  const { pathname } = useLocation();
  const isAuth = pathname === "/auth";
  const showRail = !focus && !isAuth && bp !== "sm";
  const showTabs = !focus && !isAuth && bp === "sm";
  const playerOffset = hasDoc && !isAuth ? (bp === "sm" ? 128 : 112) : 24;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-fg">
      <LiveRegion />
      <div className="flex min-h-0 flex-1">
        {showRail && <Rail />}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-breakpoint={bp}>
          <OfflineBanner />
          <Outlet />
          <PlayerHost />
        </main>
      </div>
      {showTabs && <TabBar />}
      <ShortcutsDialog />
      <Toast message={toastMsg} offset={playerOffset} />
    </div>
  );
}
