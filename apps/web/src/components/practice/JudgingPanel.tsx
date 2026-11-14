/** Waiting for the judge, with a way out. */
export function JudgingPanel({ onCancel }: { onCancel: () => void }) {
  return <div role="status" className="flex items-center gap-3.5 rounded-panel border border-line bg-bg2 py-3.5 pl-4 pr-2">
    <span className="listening-bars shrink-0" data-active="true" aria-hidden><i /><i /><i /><i /></span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="text-[15px]">Listening to your reading…</span>
      <span className="summary-processing-track !ml-0 !w-full" aria-hidden><i /></span>
      <span className="text-[13px] text-fg2">Checking each word, then pace, phrasing and expression.</span>
    </div>
    <button type="button" onClick={onCancel} className="h-11 shrink-0 rounded-control px-3 text-[13px] text-fg2 hover:bg-bg3 hover:text-fg">Cancel</button>
  </div>;
}
