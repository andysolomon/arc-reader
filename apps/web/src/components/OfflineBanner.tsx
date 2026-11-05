import { WifiOff, X } from "lucide-react";
import { IconButton } from "@readaloud/ui";
import { usePlayer } from "../state/player";
import { hasApi } from "../engine/providers";

/** Shown when the TTS API is unreachable (or not configured) and the local voice is in use. */
export function OfflineBanner() {
  const offline = usePlayer((s) => s.offline);
  const clear = usePlayer((s) => s.clearOffline);
  const doc = usePlayer((s) => s.doc);
  if (!offline || !doc) return null;
  return (
    <div role="status" className="flex items-center gap-2.5 border-b border-line bg-bg2 px-4 py-2 text-[13px] text-fg2 animate-fadein">
      <WifiOff size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1">
        {hasApi() ? "API unreachable — reading with the local voice. Cached documents still play." : "No cloud API configured — reading with the local voice."}
      </span>
      <IconButton label="Dismiss" size={32} onClick={clear}>
        <X size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}
