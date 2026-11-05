import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PlayerPill, PlayerBar, type PlayerProps } from "@readaloud/ui";
import { getVoice } from "../data/voices";
import { useSettings } from "../state/settings";
import { usePlayer, engine } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { useBreakpoint } from "../hooks/useMedia";

function safeName(s: string) {
  return s.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "readaloud";
}

export function PlayerHost() {
  const bp = useBreakpoint();
  const style = useSettings((s) => s.playerStyle);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const p = usePlayer();
  const voice = getVoice(p.voiceId);

  const onDownload = useCallback(async () => {
    const d = p.doc;
    if (!d) return;
    toast("Preparing audio…");
    const blobs = await engine.collectAudio();
    if (blobs.some((b) => !b)) {
      toast("Download needs a cloud voice — the local voice has no audio file");
      return;
    }
    const out = new Blob(blobs as Blob[], { type: (blobs[0] as Blob).type || "audio/mpeg" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    a.download = `${safeName(d.title)}.mp3`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }, [p.doc]);

  const onShare = useCallback(async () => {
    const d = p.doc;
    if (!d) return;
    const url = `${location.origin}/read/${d.id}`;
    const text = d.sentences[0]?.text ?? d.title;
    if (navigator.share) {
      try {
        await navigator.share({ title: d.title, text, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  }, [p.doc]);

  const onAddToLibrary = useCallback(async () => {
    if (!p.record) return;
    await useLibrary.getState().touch(p.record.id);
    toast("Saved to library");
  }, [p.record]);

  if (!p.doc || pathname === "/auth") return null;

  const props: PlayerProps = {
    voice,
    playing: p.playing,
    loading: p.loading,
    speed: p.speed,
    progress: p.fraction,
    ticks: p.ticks,
    elapsed: p.elapsed / p.speed,
    remaining: Math.max(0, p.total - p.elapsed) / p.speed,
    onToggle: p.toggle,
    onPrev: p.prev,
    onNext: p.next,
    onSeek: p.seekFraction,
    onSpeed: p.setSpeed,
    onVoice: () => navigate("/voices"),
    onDownload,
    onShare,
    onAddToLibrary,
    onChangeVoice: () => navigate(`/voices?for=${p.doc!.id}`),
    menuOpen: p.menuOpen,
    onMenuOpenChange: p.setMenuOpen,
  };

  if (bp === "sm") return <PlayerBar {...props} compact />;
  if (style === "bar") return <PlayerBar {...props} />;
  return <PlayerPill {...props} />;
}
