import { useState } from "react";
import { Check, Plus, UserRound } from "lucide-react";
import { Button, Dialog, Input, cn } from "@readaloud/ui";
import { NAME_MAX, readerList, usePractice } from "../../state/practice";
import { dayOf } from "../../lib/practice/score";
import { currentStreak } from "../../state/practice";

/** "Reading as …" with a dialog to switch, add, rename or remove readers sharing this browser. */
export function ReaderPicker() {
  const name = usePractice((s) => s.readerName);
  const [open, setOpen] = useState(false);
  return <div className="flex items-center justify-between gap-3 rounded-panel border border-line bg-bg2 py-1.5 pl-4 pr-1.5">
    <span className="flex min-w-0 items-center gap-2 text-[14px]">
      <UserRound size={16} className="shrink-0 text-fg2" aria-hidden />
      <span className="truncate">Reading as <span className="font-semibold">{name}</span></span>
    </span>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Change reader</Button>
    <ReaderDialog open={open} onClose={() => setOpen(false)} />
  </div>;
}

function ReaderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = usePractice();
  const readers = readerList(state);
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const today = dayOf(Date.now());
  const close = () => { setAdding(""); setRenaming(null); setConfirming(null); onClose(); };

  return <Dialog open={open} onClose={close} title="Readers" hint="">
    <p className="m-0 text-[13px] text-fg2">Each reader keeps their own level, streak, points and words to practise in this browser.</p>
    <div role="radiogroup" aria-label="Reader" className="flex flex-col rounded-panel border border-line">
      {readers.map((r, i) => {
        const current = r.id === state.readerId;
        const days = currentStreak({ streak: r.streak }, today);
        return <div key={r.id} className={cn("flex items-center gap-2 px-3 py-2", i < readers.length - 1 && "border-b border-line")}>
          <button type="button" role="radio" aria-checked={current} onClick={() => { state.switchReader(r.id); close(); }}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
            <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", current ? "border-accent bg-accent text-accent-fg" : "border-line")}>{current && <Check size={12} aria-hidden />}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px]">{r.name}</span>
              <span className="text-[12px] text-fg2">{days ? `${days}-day streak · ` : ""}{r.points} points</span>
            </span>
          </button>
          {current
            ? <Button size="sm" variant="ghost" onClick={() => setRenaming(r.name)}>Rename</Button>
            : <Button size="sm" variant={confirming === r.id ? "danger" : "ghost"} onClick={() => { if (confirming === r.id) { state.removeReader(r.id); setConfirming(null); } else setConfirming(r.id); }}>
              {confirming === r.id ? "Remove?" : "Remove"}
            </Button>}
        </div>;
      })}
    </div>
    {renaming !== null && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); state.renameReader(renaming); setRenaming(null); }}>
      <Input aria-label="Reader's name" className="min-w-0 flex-1 text-base" maxLength={NAME_MAX} value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
      <Button type="submit" size="md" disabled={!renaming.trim()}>Save</Button>
    </form>}
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!adding.trim()) return; state.addReader(adding); close(); }}>
      <Input aria-label="New reader's name" placeholder="Add a reader" className="min-w-0 flex-1 text-base" maxLength={NAME_MAX} value={adding} onChange={(e) => setAdding(e.target.value)} />
      <Button type="submit" size="md" leading={<Plus size={16} aria-hidden />} disabled={!adding.trim()}>Add</Button>
    </form>
  </Dialog>;
}
