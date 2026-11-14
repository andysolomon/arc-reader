import type { ReactNode } from "react";
import type { Passage } from "../../lib/practice/passages";

/** The passage card, built like ReadingScriptCard: a head row, the passage, the attribution. */
export function PassageCard({ head, action, children, passage, footer }: { head: ReactNode; action?: ReactNode; children: ReactNode; passage: Passage | null; footer?: ReactNode }) {
  return <section aria-label="Passage" className="flex flex-col gap-3 rounded-control bg-bg3 p-4">
    <div className="flex min-h-[34px] flex-wrap items-center justify-between gap-2">
      <h2 className="m-0 text-sm font-normal text-fg2">{head}</h2>
      {action}
    </div>
    {children}
    {footer}
    {passage && <Attribution passage={passage} />}
  </section>;
}

export function Attribution({ passage }: { passage: Passage }) {
  return <p className="m-0 text-xs text-fg2">
    {passage.source === "npr" ? "From NPR · " : "Public domain · "}
    <a className="underline" href={passage.url} target="_blank" rel="noreferrer">{passage.title}</a>
  </p>;
}
