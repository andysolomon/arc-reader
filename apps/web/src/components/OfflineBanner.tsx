import { WifiOff, X } from "lucide-react";
import { IconButton } from "@readaloud/ui";
import { usePlayer } from "../state/player";
import { hasApi } from "../engine/providers";
import { useSettings } from "../state/settings";
import { LOCAL_ENGINE } from "../engine/types";

/** Shown when the TTS API is unreachable (or not configured) and the local voice is in use. */
export function OfflineBanner() {
  const offline = usePlayer((s) => s.offline);
  const clear = usePlayer((s) => s.clearOffline);
  const doc = usePlayer((s) => s.doc);
  const engine = useSettings((s) => s.engine);
  if (!offline || !doc || engine === LOCAL_ENGINE) return null;
  return (
    <div role="status" data-testid="offline-banner" className="flex items-center gap-2.5 border-b border-line bg-bg2 px-4 py-2 text-[13px] text-fg2 animate-fadein">
      <WifiOff size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1">
        {hasApi() ? "Speech server unreachable — reading with the browser voice. Cached sentences still play." : "No speech server configured — reading with the browser voice."}
      </span>
      <IconButton label="Dismiss" size={32} onClick={clear}>
        <X size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}
