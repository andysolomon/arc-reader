import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Square, Zap } from "lucide-react";
import { PlayerPill, PlayerBar, Popover, Sheet, type PlayerProps } from "@readaloud/ui";
import { VoicePicker } from "./VoicePicker";
import { getVoice } from "../state/voices";
import { LOCAL_VOICE } from "../data/voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "../state/settings";
import { usePlayer, engine } from "../state/player";
import { unavailableMessage } from "../engine/engine";
import { isPaidEngine } from "../engine/providers";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { writeClipboardText } from "../lib/clipboard";
import { useBreakpoint } from "../hooks/useMedia";

function safeName(s: string) {
  return s.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "readaloud";
}

export function PlayerHost() {
  const bp = useBreakpoint();
  const style = useSettings((s) => s.playerStyle);
  const browserOnly = useSettings((s) => s.engine === LOCAL_ENGINE);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const p = usePlayer();
  const focus = usePlayer((s) => s.focus);
  const voice = getVoice(p.voiceId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const docId = p.record?.id ?? p.doc?.id;
  // A different document (or none) closes the picker: its choices belonged to the old one.
  useEffect(() => setPickerOpen(false), [docId, pathname]);

  const onDownload = useCallback(async () => {
    const d = p.doc;
    if (!d) return;
    toast("Preparing audio…");
    let blobs: (Blob | null)[];
    try {
      blobs = await engine.collectAudio();
    } catch (e) {
      toast(`Download failed: ${unavailableMessage(e)}`);
      return;
    }
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
      await writeClipboardText(url);
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

  // Slow engines (cloning on CPU) can't keep up with playback: render the whole document ahead.
  // Paid engines keep up and would bill the whole document up front, so they don't offer it.
  const prerender = p.prerendering;
  const extraMenu: PlayerProps["extraMenu"] = !prerender && (voice.engine === LOCAL_ENGINE || isPaidEngine(voice.engine) || p.offline) ? [] : [
    prerender
      ? { id: "prerender", label: `Stop preparing (${prerender.done}/${prerender.total})`, icon: <Square size={16} strokeWidth={1.5} />, onSelect: p.cancelPrerender }
      : { id: "prerender", label: "Prepare audio", icon: <Zap size={16} strokeWidth={1.5} />, onSelect: () => void p.prerender() },
  ];

  const props: PlayerProps = {
    title: p.doc.title,
    voice: p.offline || browserOnly ? LOCAL_VOICE : voice,
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
    onVoice: () => { p.setMenuOpen(false); setPickerOpen((o) => !o); },
    onDownload,
    onShare,
    onAddToLibrary,
    // The same in-place picker as the avatar; voices with audio saved for this document come first.
    onChangeVoice: () => setPickerOpen(true),
    menuOpen: p.menuOpen,
    onMenuOpenChange: p.setMenuOpen,
    // A passage still being generated: say so, so a wait mid-reading doesn't read as a stop.
    status: prerender ? `${prerender.unreachable ? "Can't reach server" : "Preparing"} ${prerender.done}/${prerender.total}` : p.loading ? "Generating…" : undefined,
    extraMenu,
    voicePickerOpen: pickerOpen,
  };

  const picker = (
    <VoicePicker
      docId={docId!}
      title={p.doc.title}
      onDone={closePicker}
      onBrowse={() => { closePicker(); navigate(`/voices?for=${docId}`); }}
      className={bp === "sm" ? "max-h-[60dvh]" : "max-h-[min(420px,60dvh)]"}
    />
  );

  // The tab bar owns the home-indicator inset. In focus it is hidden, so the player takes it.
  // Phones get a bottom sheet, rendered outside the player: its backdrop blur would trap a fixed overlay.
  if (bp === "sm") return (
    <>
      <PlayerBar {...props} compact safeBottom={focus || pathname === "/auth"} />
      <Sheet open={pickerOpen} onClose={closePicker} title="Voice for this document">{picker}</Sheet>
    </>
  );
  props.voicePicker = (
    <Popover open={pickerOpen} onClose={closePicker} align="start" offset={52} role="dialog" aria-label="Voice for this document" className="flex w-[300px] flex-col p-2">
      {picker}
    </Popover>
  );
  if (style === "bar") return <PlayerBar {...props} />;
  return <PlayerPill {...props} />;
}
