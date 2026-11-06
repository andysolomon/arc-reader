import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, Library, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { Button, IconButton, SentenceText, Sheet, Segmented, ThemeIcon, cn } from "@readaloud/ui";
import { getTheme } from "@readaloud/tokens";
import { docs } from "../lib/db";
import { syncLibrary } from "../lib/librarySync";
import { useSettings, useThemeId } from "../state/settings";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useBreakpoint } from "../hooks/useMedia";
import { useCycleTheme } from "../components/Rail";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { hasSummary, summaryModelLabel } from "../lib/summary";
import { useLlm } from "../state/llm";
import { useSummaries } from "../state/summaries";
import { ArticleSummary } from "../components/ArticleSummary";
import { DocumentDetails } from "../components/DocumentDetails";

export function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const doc = usePlayer((s) => s.doc);
  const index = usePlayer((s) => s.index);
  const wordIndex = usePlayer((s) => s.wordIndex);
  const loading = usePlayer((s) => s.loading);
  const focus = usePlayer((s) => s.focus);
  const setFocus = usePlayer((s) => s.setFocus);
  const seek = usePlayer((s) => s.seek);
  const setShortcuts = usePlayer((s) => s.setShortcutsOpen);
  const record = usePlayer((s) => s.record);
  const readingSummary = usePlayer((s) => s.summary);
  const { fontSize, wide, highlightStyle, showSummary, set } = useSettings();
  const theme = getTheme(useThemeId());
  const cycleTheme = useCycleTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(false);
  const [missing, setMissing] = useState(false);
  const [details, setDetails] = useState(false);

  // Pull the shared library first so deep links also work on a new device.
  useEffect(() => {
    if (!id || id === "new") return;
    if (doc?.id === id) return;
    let alive = true;
    void syncLibrary().then(() => docs.get(id)).then((rec) => {
      if (!alive) return;
      if (!rec) {
        setMissing(true);
        toast("That document is unavailable. Reconnect to sync your library.");
        navigate("/", { replace: true });
        return;
      }
      void usePlayer.getState().open(rec, { autoplay: false });
    });
    return () => {
      alive = false;
    };
  }, [id, doc?.id, navigate]);

  useEffect(() => () => setFocus(false), [setFocus]);

  const ready = doc && doc.id === id;
  const title = ready ? doc.title : "";
  const llmReady = useLlm((s) => !!s.config?.configured);
  useEffect(() => { void useLlm.getState().load(); }, []);
  // Saved summaries stay readable even without a key on this server.
  const summaryRecord = ready && record?.id === id && (llmReady || hasSummary(record)) ? record : null;
  const toggleSummary = () => {
    if (!showSummary && summaryRecord && !hasSummary(summaryRecord)) void useSummaries.getState().request(summaryRecord);
    set("showSummary", !showSummary);
  };
  const detailsRecord = ready && record?.id === id ? record : null;

  const textControls = (
    <>
      <IconButton label="Smaller text" onClick={() => set("fontSize", Math.max(16, fontSize - 1))} className="font-serif text-[13px]" disabled={fontSize <= 16}>
        A
      </IconButton>
      <IconButton label="Larger text" onClick={() => set("fontSize", Math.min(26, fontSize + 1))} className="font-serif text-[19px]" disabled={fontSize >= 26}>
        A
      </IconButton>
      <button
        type="button"
        onClick={() => set("wide", !wide)}
        title="Line width"
        aria-label={`Line width: ${wide ? "72" : "62"} characters. Toggle`}
        className="grid h-9 place-items-center rounded-control border-0 bg-transparent px-2.5 font-mono text-[12px] text-fg2 hover:bg-bg3 hover:text-fg"
      >
        {wide ? "72ch" : "62ch"}
      </button>
      <IconButton label={`Theme: ${theme.name}. Switch`} onClick={cycleTheme}>
        <ThemeIcon scheme={theme.scheme} />
      </IconButton>
    </>
  );

  return (
    <section data-screen="reader" className="flex min-h-0 flex-1 flex-col animate-fadein">
      {!focus && (
        <header className="flex h-header shrink-0 items-center gap-1.5 px-3">
          <IconButton label="Back" onClick={() => navigate("/")}>
            <ChevronLeft size={20} strokeWidth={1.5} />
          </IconButton>
          <h1 className="min-w-0 flex-1 truncate px-1.5 text-[13px] font-normal text-fg2" title={title}>
            {title}
          </h1>
          {detailsRecord && !readingSummary && (
            <IconButton label={details ? "Hide details" : "Details"} active={details} onClick={() => setDetails(!details)}>
              <Library size={20} strokeWidth={1.5} />
            </IconButton>
          )}
          {summaryRecord && !readingSummary && (
            <IconButton label={showSummary ? "Hide summary" : "Summarize"} active={showSummary} onClick={toggleSummary}>
              <Sparkles size={20} strokeWidth={1.5} />
            </IconButton>
          )}
          {bp === "sm" ? (
            <IconButton label="Text settings" onClick={() => setSheet(true)} className="font-serif text-[15px]">
              Aa
            </IconButton>
          ) : (
            textControls
          )}
          <IconButton label={focus ? "Exit focus mode" : "Focus mode"} title="Focus mode (F)" onClick={() => setFocus(!focus)}>
            {focus ? <Minimize2 size={20} strokeWidth={1.5} /> : <Maximize2 size={20} strokeWidth={1.5} />}
          </IconButton>
          {bp !== "sm" && (
            <IconButton label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShortcuts(true)} className="font-mono text-[14px]">
              ?
            </IconButton>
          )}
        </header>
      )}
      <div ref={scrollRef} className={cn("relative min-h-0 flex-1 overflow-y-auto px-6 pb-[200px]", focus ? "pt-16" : "pt-12")}>
        {focus && (
          <IconButton label="Exit focus mode" title="Exit focus (Esc)" onClick={() => setFocus(false)} className="absolute right-3 top-3">
            <Minimize2 size={20} strokeWidth={1.5} />
          </IconButton>
        )}
        <motion.div layoutId="doc-surface" className="mx-auto" style={{ maxWidth: `${wide ? 72 : 62}ch` }}>
          {ready && !readingSummary && doc.voice === JAMAICAN_PATOIS_VOICE_ID && <p className="mb-6 text-sm text-fg2">Jamaican Patois adaptation · Your original is saved. Choose another voice to read the original.</p>}
          {ready && readingSummary && record?.summary && (
            <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg2">
              <span className="flex-1">Summary · {summaryModelLabel(record.summary.model)}</span>
              <Button variant="link" className="underline underline-offset-2" onClick={() => void usePlayer.getState().open(record, { autoplay: usePlayer.getState().playing })}>
                Read the full article
              </Button>
            </div>
          )}
          {detailsRecord && details && !readingSummary && (
            <DocumentDetails
              record={detailsRecord}
              summaryAvailable={!!summaryRecord}
              onShowSummary={() => { if (!showSummary) toggleSummary(); }}
              onClose={() => setDetails(false)}
            />
          )}
          {summaryRecord && showSummary && !readingSummary && <ArticleSummary record={summaryRecord} />}
          {ready ? (
            <SentenceText
              paragraphs={doc.paragraphs}
              activeIndex={index}
              activeWord={wordIndex}
              mode={highlightStyle}
              loading={loading && index === 0}
              fontSize={fontSize}
              wide={wide}
              onSeek={seek}
              scrollRef={scrollRef}
            />
          ) : missing ? null : (
            <div className="flex flex-col gap-3 font-serif" style={{ fontSize }} aria-busy="true" aria-label="Loading document">
              <span className="block h-[1.2em] w-full animate-pulse rounded-[6px] bg-bg3 motion-reduce:animate-none" />
              <span className="block h-[1.2em] w-[85%] animate-pulse rounded-[6px] bg-bg3 motion-reduce:animate-none" />
              <span className="block h-[1.2em] w-[60%] animate-pulse rounded-[6px] bg-bg3 motion-reduce:animate-none" />
            </div>
          )}
        </motion.div>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Text">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-fg2">Size</span>
            <div className="flex items-center gap-1">
              <IconButton label="Smaller text" size={44} onClick={() => set("fontSize", Math.max(16, fontSize - 1))} className="font-serif text-[13px]">A</IconButton>
              <span className="w-10 text-center font-mono text-[12px] tabular-nums">{fontSize}px</span>
              <IconButton label="Larger text" size={44} onClick={() => set("fontSize", Math.min(26, fontSize + 1))} className="font-serif text-[19px]">A</IconButton>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg2">Measure</span>
            <Segmented value={wide ? "72" : "62"} onChange={(v) => set("wide", v === "72")} label="Line width" options={[{ value: "62", label: "62ch" }, { value: "72", label: "72ch" }]} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg2">Highlight</span>
            <Segmented value={highlightStyle} onChange={(v) => set("highlightStyle", v)} label="Highlight style" options={[{ value: "block", label: "Block" }, { value: "dim", label: "Dim" }, { value: "underline", label: "Underline" }]} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg2">Theme</span>
            <button type="button" onClick={cycleTheme} className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-bg px-3 text-[13px]">
              <ThemeIcon scheme={theme.scheme} size={16} />
              {theme.name}
            </button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}
