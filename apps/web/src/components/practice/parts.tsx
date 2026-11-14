import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, Flame } from "lucide-react";
import { cn } from "@readaloud/ui";
import { BANDS, bandInfo, type Band } from "../../lib/practice/bands";

/** The page title with one chip on the right of the same row. */
export function TitleRow({ chip }: { chip?: ReactNode }) {
  return <header className="flex items-center justify-between gap-3">
    <h1 className="m-0 font-serif text-[26px] font-medium">Practice</h1>
    {chip}
  </header>;
}

export function StreakChip({ days }: { days: number }) {
  if (!days) return null;
  return <span className="inline-flex h-[30px] items-center gap-1.5 rounded-pill border border-line bg-bg2 pl-[9px] pr-3 text-[13px]">
    <Flame size={15} className="text-accent" aria-hidden />{days}-day streak
  </span>;
}

/** The level, as a button back to Start while reading, or as plain text once the take is in. */
export function LevelChip({ band, onClick }: { band: Band; onClick?: () => void }) {
  const title = bandInfo(band).title;
  if (!onClick) return <span className="inline-flex h-[34px] items-center rounded-pill border border-line bg-bg2 px-3.5 text-[13px]">{title}</span>;
  return <button type="button" onClick={onClick} aria-label={`Level: ${title}. Change level`} className="inline-flex h-[34px] items-center gap-1 rounded-pill border border-line bg-bg2 pl-3.5 pr-2.5 text-[13px] hover:bg-bg3">
    {title}<ChevronDown size={14} className="text-fg2" aria-hidden />
  </button>;
}

export function LevelPicker({ band, onChange }: { band: Band; onChange: (band: Band) => void }) {
  return <div role="radiogroup" aria-label="Level" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
    {BANDS.map((b) => {
      const selected = b.id === band;
      return <button key={b.id} type="button" role="radio" aria-checked={selected} onClick={() => onChange(b.id)}
        className={cn("flex h-[60px] flex-col justify-center rounded-panel border bg-bg2 px-3.5 text-left transition-colors duration-fast", selected ? "border-accent" : "border-line hover:bg-bg3")}>
        <span className="text-[15px] leading-tight">{b.title}</span>
        <span className="text-[12px] text-fg2">{b.min}–{b.max} words</span>
      </button>;
    })}
  </div>;
}

/** The arrow box in the trailing slot of the big primary buttons. */
export const ArrowBox = () => <span aria-hidden className="grid size-8 place-items-center rounded-control bg-black/15"><ArrowRight size={18} /></span>;

/** Filled segments for a level: phrasing (of 4) or expression (of 3). */
export function Meter({ value, of }: { value: number; of: number }) {
  return <span role="img" aria-label={`${value} of ${of}`} className="flex shrink-0 gap-1">
    {Array.from({ length: of }, (_, i) => <span key={i} className={cn("h-1.5 w-4 rounded-[3px]", i < value ? "bg-accent" : "bg-line")} />)}
  </span>;
}

const PACE_LABEL = ["much too slow", "a little slow", "steady", "a little fast", "much too fast"];
export function PaceDots({ pace }: { pace: number }) {
  return <span role="img" aria-label={`Pace: ${PACE_LABEL[pace - 1] ?? "steady"}`} className="flex shrink-0 items-center gap-1.5">
    {Array.from({ length: 5 }, (_, i) => <span key={i} className={cn("rounded-full", i === pace - 1 ? "size-3 bg-accent" : "size-1.5 bg-line")} />)}
  </span>;
}

/** Shown when /api/decide has no OpenCode key. */
export function KeyNotice() {
  return <p role="alert" className="rounded-control border border-line bg-bg3 p-3 text-sm text-danger">
    Add your OpenCode key in <Link to="/settings" className="underline">Settings</Link> to check readings.
  </p>;
}
