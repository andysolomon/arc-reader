import { Mic, Play, SkipBack, SkipForward } from "lucide-react";
import { Kbd, PlayPauseIcon, SectionLabel, fmtTime, formatSpeed, cn } from "@readaloud/ui";
import { HYPR_BINDS } from "../data/shortcuts";
import { usePlayer } from "../state/player";
import { useSettings } from "../state/settings";

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export function LinuxPage() {
  const p = usePlayer();
  const hl = useSettings((s) => s.highlightStyle);
  const doc = p.doc;
  const cur = doc ? doc.sentences[p.index]?.text ?? "" : "Nothing playing. Open a document in the Reader first.";
  const prev = doc && p.index > 0 ? doc.sentences[p.index - 1].text : "";
  const speaking = p.playing;
  const elapsed = fmtTime(p.elapsed / p.speed);
  const pct = p.fraction * 100;
  const localVoice = p.offline || p.voiceId === "piper";

  return (
    <section data-screen="linux" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: doc ? 160 : 64 }}>
      <div className="mx-auto flex max-w-[960px] flex-col gap-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-serif text-[26px] font-medium">Linux client · Omarchy surfaces</h1>
          <div className="text-fg2">Live mockups bound to the current document. Everything below works without a mouse.</div>
        </div>

        <div className="flex flex-col gap-2.5">
          <SectionLabel>Waybar module</SectionLabel>
          <div className="flex h-[34px] items-center gap-3.5 rounded-control border border-line bg-bg2 px-3 font-mono text-[12px]">
            <div className="flex gap-2.5 text-fg2" aria-hidden>
              <span className="text-accent">1</span><span>2</span><span>3</span><span>4</span><span>5</span>
            </div>
            <span className="flex-1" />
            <span className="hidden text-fg2 sm:inline">{new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}  {new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={p.toggle}
              onWheel={(e) => {
                e.preventDefault();
                p.nudgeSpeed(e.deltaY < 0 ? 0.25 : -0.25);
              }}
              title="Click: toggle · Scroll: speed"
              aria-label={`ReadAloud: ${!doc ? "idle" : speaking ? `speaking, ${elapsed}` : "paused"}`}
              className={cn("inline-flex h-6 items-center gap-1.5 rounded-[4px] border-0 px-2 font-mono text-[12px] tabular-nums transition-colors duration-base", speaking ? "bg-hl text-accent" : "bg-transparent text-fg2")}
            >
              {speaking ? <Mic size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />}
              <span>{!doc ? "idle" : speaking ? elapsed : "paused"}</span>
            </button>
            <span className="text-fg2" aria-hidden>󰕾 42%</span>
            <span className="text-fg2" aria-hidden>󰁹 87%</span>
          </div>
          <div className="max-w-[360px] self-end rounded-control border border-line bg-bg3 px-2.5 py-2 text-[12px] leading-[1.4] text-fg animate-rise sm:mr-[120px]">
            <span className="font-mono text-[11px]">tooltip · </span>
            {trunc(cur, 90)}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-6">
          <div className="flex flex-col gap-2.5">
            <SectionLabel>Notification · mako</SectionLabel>
            <div className="flex flex-col gap-2.5 rounded-panel border border-line bg-bg2 px-4 py-3.5 shadow-overlay" role="group" aria-label="mako notification">
              <div className="flex items-center gap-2 text-[12px] text-fg2">
                <span className="inline-block size-3.5 rounded-[4px] bg-accent" aria-hidden />
                ReadAloud
                <span className="flex-1" />
                {speaking ? "now · speaking" : doc ? "paused" : "idle"}
              </div>
              <div className="text-[14px] font-semibold">ReadAloud</div>
              <div className="font-serif text-[14px] leading-[1.5] text-fg2">{trunc(cur, 80)}</div>
              <div className="h-[2px] overflow-hidden rounded-[2px] bg-bg3">
                <div className="h-full bg-accent transition-[width] duration-100 ease-linear" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={p.toggle} className="h-[30px] rounded-[6px] border border-line bg-bg3 px-3 text-[12px] hover:border-fg3">
                  {speaking ? "Pause" : "Resume"}
                </button>
                <button type="button" onClick={p.stop} className="h-[30px] rounded-[6px] border border-line bg-transparent px-3 text-[12px] hover:border-fg3">
                  Stop
                </button>
              </div>
            </div>
            <div className="text-[12px] text-fg2">Progress updates replace the notification in place; it never stacks.</div>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionLabel>Mini-window · Tauri/GTK</SectionLabel>
            <div className="flex min-h-[220px] flex-col gap-3.5 rounded-[14px] border border-line bg-bg px-[22px] pb-3.5 pt-[22px] shadow-overlay">
              <div className="flex-1 font-serif text-[17px] leading-[1.55]">
                <span className="text-fg3">{prev.length > 70 ? "…" + prev.slice(-70) : prev} </span>
                <span
                  className={cn(
                    hl === "underline" ? "underline decoration-accent underline-offset-[5px]" : "-mx-1 -my-0.5 rounded-[6px] bg-hl px-1 py-0.5 [-webkit-box-decoration-break:clone] [box-decoration-break:clone]",
                  )}
                >
                  {cur}
                </span>
              </div>
              <div className="flex items-center gap-1.5 self-start rounded-pill border border-line bg-bg2 p-1.5">
                <button type="button" onClick={p.prev} aria-label="Previous sentence" className="grid size-8 place-items-center rounded-full border-0 bg-transparent text-fg2 hover:text-fg">
                  <SkipBack size={16} strokeWidth={1.5} />
                </button>
                <button type="button" onClick={p.toggle} aria-label={speaking ? "Pause" : "Play"} className="grid size-[34px] place-items-center rounded-full border-0 bg-accent text-accent-fg">
                  <PlayPauseIcon playing={speaking} size={16} />
                </button>
                <button type="button" onClick={p.next} aria-label="Next sentence" className="grid size-8 place-items-center rounded-full border-0 bg-transparent text-fg2 hover:text-fg">
                  <SkipForward size={16} strokeWidth={1.5} />
                </button>
                <span className="px-2 font-mono text-[11px] tabular-nums text-fg2">
                  {elapsed} · {formatSpeed(p.speed)}
                </span>
              </div>
            </div>
            <div className="text-[12px] text-fg2">
              Borderless, floating. Colors read from <code className="font-mono">~/.config/omarchy/current/theme</code>.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <SectionLabel>Hyprland binds</SectionLabel>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-8 gap-y-1">
            {HYPR_BINDS.map(([what, key]) => (
              <div key={what} className="flex items-center justify-between border-b border-line py-2">
                <span className="text-fg2">{what}</span>
                <Kbd>{key}</Kbd>
              </div>
            ))}
          </div>
          <div className="mt-1.5 inline-flex items-center gap-2 self-start rounded-pill border border-line bg-bg2 px-2.5 py-1.5 text-[12px] text-fg2" role="status">
            <span className={cn("size-2 rounded-full", localVoice ? "bg-danger" : "bg-fg3")} aria-hidden />
            {localVoice ? "API unreachable → fell back to Piper, showing “local voice”" : "API unreachable → falls back to Piper and shows “local voice”"}
          </div>
        </div>
      </div>
    </section>
  );
}
