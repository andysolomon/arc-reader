import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ChevronLeft, Flame } from "lucide-react";
import { IconButton, Popover, cn } from "@readaloud/ui";
import { BANDS, bandInfo, type Band } from "../../lib/practice/bands";
import { MenuOption } from "../IconMenu";

/** The page title with one chip on the right of the same row, and Back to Practice's start when `onBack` is given. */
export function TitleRow({ chip, onBack }: { chip?: ReactNode; onBack?: () => void }) {
  return <header className="flex items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-1">
      {onBack && <IconButton label="Back to Practice home" size={36} className="-ml-2 rounded-control text-fg2 hover:bg-bg3 hover:text-fg" onClick={onBack}>
        <ChevronLeft size={22} aria-hidden />
      </IconButton>}
      <h1 className="m-0 font-serif text-[26px] font-medium">Practice</h1>
    </div>
    {chip}
  </header>;
}

export function StreakChip({ days }: { days: number }) {
  if (!days) return null;
  return <span className="inline-flex h-[30px] items-center gap-1.5 rounded-pill border border-line bg-bg2 pl-[9px] pr-3 text-[13px]">
    <Flame size={15} className="text-accent" aria-hidden />{days}-day streak
  </span>;
}

/** The level as plain text, while a take is checked or words are practised. */
export function LevelChip({ band }: { band: Band }) {
  return <span className="inline-flex h-[34px] items-center rounded-pill border border-line bg-bg2 px-3.5 text-[13px]">{bandInfo(band).title}</span>;
}

/** The level as a pill that opens the levels beneath it; choosing another one starts a passage at that level. */
export function LevelMenu({ band, onChange }: { band: Band; onChange: (band: Band) => void }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const title = bandInfo(band).title;
  useEffect(() => { if (open) list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(); }, [open]);
  return <div className="relative">
    <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Level: ${title}. Change level`}
      className={cn("inline-flex h-[34px] items-center gap-1 rounded-pill border border-line bg-bg2 pl-3.5 pr-2.5 text-[13px] hover:bg-bg3", open && "bg-bg3")}>
      {title}<ChevronDown size={14} className={cn("text-fg2 transition-transform duration-fast", open && "rotate-180")} aria-hidden />
    </button>
    <Popover open={open} onClose={() => setOpen(false)} side="bottom" align="end" offset={40} className="z-30 w-[260px] max-w-[calc(100vw-24px)] p-1.5">
      <div ref={list} role="menu" aria-label="Level" className="flex flex-col">
        {BANDS.map((b) => <MenuOption key={b.id} checked={b.id === band} onSelect={() => { setOpen(false); if (b.id !== band) onChange(b.id); }}>
          {b.title} <span className="font-normal text-fg2">· {b.min}–{b.max} words</span>
        </MenuOption>)}
      </div>
    </Popover>
  </div>;
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
