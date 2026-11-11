import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Clipboard } from "lucide-react";
import { Button, Toast } from "@readaloud/ui";
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
import { useLinkToasts } from "../state/links";
import { ClipboardImportContext, useClipboardImportController } from "../hooks/useClipboardImport";

export function Shell() {
  useShortcuts();
  useLinkToasts();
  const bp = useBreakpoint();
  const focus = usePlayer((s) => s.focus);
  const hasDoc = usePlayer((s) => !!s.doc);
  const preparing = usePlayer((s) => s.preparing);
  const preparationError = usePlayer((s) => s.preparationError);
  const speechError = usePlayer((s) => s.speechError);
  const toastMsg = useToast((s) => s.message);
  const toastHref = useToast((s) => s.href);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isAuth = pathname === "/auth";
  const clipboard = useClipboardImportController(!isAuth);
  const showRail = !focus && !isAuth && bp !== "sm";
  const showTabs = !focus && !isAuth && bp === "sm";
  const playerOffset = hasDoc && !isAuth ? (bp === "sm" ? 160 : 156) : 24;

  return (
    <ClipboardImportContext.Provider value={clipboard}>
    <div className="flex h-full flex-col overflow-hidden bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-fg">
      <LiveRegion />
      <div className="flex min-h-0 flex-1">
        {showRail && <Rail />}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-breakpoint={bp}>
          <OfflineBanner />
          {showTabs && pathname !== "/" && <div className="flex shrink-0 justify-end border-b border-line px-4 py-2">
            <Button leading={<Clipboard size={16} strokeWidth={1.5} aria-hidden />} loading={clipboard.busy} onClick={() => void clipboard.readClipboard()}>Read clipboard</Button>
          </div>}
          {(preparing || preparationError) && <div role={preparationError ? "alert" : "status"} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-bg2 px-5 py-3 text-sm">
            <span className="flex-1">{preparing || preparationError}</span>
            {preparationError && <button className="text-accent underline" onClick={() => { void usePlayer.getState().retryPreparation().then((opened) => { if (opened) navigate(`/read/${usePlayer.getState().doc!.id}`); }); }}>Retry</button>}
            <button className="text-accent underline" onClick={() => usePlayer.getState().cancelPreparation()}>{preparing ? "Cancel" : "Dismiss"}</button>
          </div>}
          {speechError && <div role="alert" data-testid="speech-error" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-bg2 px-5 py-3 text-sm">
            <span className="flex-1">{speechError} Playback is paused.</span>
            <button className="text-accent underline" onClick={() => usePlayer.getState().retrySpeech()}>Retry</button>
            <button className="text-accent underline" onClick={() => usePlayer.getState().useBrowserVoice()}>Use browser voice</button>
            <button className="text-accent underline" onClick={() => usePlayer.getState().dismissSpeechError()}>Dismiss</button>
          </div>}
          <Outlet />
          <PlayerHost />
        </main>
      </div>
      {showTabs && <TabBar />}
      <ShortcutsDialog />
      <Toast message={toastMsg} href={toastHref} offset={playerOffset} />
    </div>
    </ClipboardImportContext.Provider>
  );
}
