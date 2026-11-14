import { Mic, Square } from "lucide-react";
import { Button } from "@readaloud/ui";

/** The status row and the big record / stop button under the passage. */
export function RecorderControls({ recording, starting, seconds, levels, disabled, onStart, onStop }: {
  recording: boolean; starting: boolean; seconds: number; levels: number[]; disabled?: boolean; onStart: () => void; onStop: () => void;
}) {
  return <div className="flex flex-col gap-3">
    {recording && <div className="flex h-6 items-center gap-3">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" />
      <span role="status" className="tabular text-sm text-fg2">Recording · {seconds}s</span>
      <span aria-hidden className="ml-auto flex h-[22px] items-center gap-[3px] text-accent">
        {levels.map((level, i) => <i key={i} className="block w-[3px] rounded-[4px] bg-current" style={{ height: `${Math.round(5 + level * 17)}px` }} />)}
      </span>
    </div>}
    <Button variant="primary" size="xl" className="w-full !pr-[22px]" loading={starting} disabled={disabled && !recording}
      leading={recording ? <Square size={16} fill="currentColor" aria-hidden /> : <Mic size={18} aria-hidden />}
      onClick={recording ? onStop : onStart}>
      {recording ? "Stop recording" : "Record"}
    </Button>
  </div>;
}
