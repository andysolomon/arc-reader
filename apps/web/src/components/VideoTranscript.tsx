import { useEffect } from "react";
import { Captions } from "lucide-react";
import { Button } from "@readaloud/ui";
import type { DocRecord } from "../lib/db";
import { isXPost, videoLength } from "../lib/videoTranscript";
import { transcribing, useTranscripts } from "../state/transcripts";

const STAGE = { waiting: "Waiting for another video to finish", fetching: "Getting the video's sound", transcribing: "Transcribing the video" } as const;

/**
 * Shown on a post from X that has a video: offers to add what is said in it to the document,
 * then reports the transcription as it goes. Gone once the transcript is in the text.
 */
export function VideoTranscript({ record }: { record: DocRecord }) {
  const offered = !record.transcript && isXPost(record.meta?.url);
  const status = useTranscripts((s) => s.videos[record.id]);
  const dismissed = useTranscripts((s) => !!s.dismissed[record.id]);
  useEffect(() => {
    if (offered) void useTranscripts.getState().look(record);
    // Asked once per document: the record itself changes whenever it is filed, summarized or renamed.
  }, [offered, record.id]);

  if (!offered || !status?.seconds) return null;
  const { seconds, state } = status;
  const request = () => void useTranscripts.getState().request(record);

  if (transcribing(status)) {
    const done = Math.min(seconds, status.done ?? 0);
    return (
      <div role="status" data-transcript-progress className="mb-8 rounded-card border border-line bg-bg2 px-5 py-4 font-sans text-[14px] text-fg2">
        <div className="flex items-center gap-3">
          <Captions size={18} strokeWidth={1.5} className="shrink-0 animate-pulse motion-reduce:animate-none" aria-hidden />
          <span className="flex-1">{STAGE[state as keyof typeof STAGE]}</span>
          {state === "transcribing" && seconds >= 120 && <span className="tabular-nums">{Math.floor(done / 60)} of {Math.ceil(seconds / 60)} min</span>}
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg3" aria-hidden>
          <span className="block h-full rounded-full bg-accent transition-[width] duration-base" style={{ width: `${state === "transcribing" ? (done / seconds) * 100 : 0}%` }} />
        </div>
      </div>
    );
  }
  if (dismissed && state !== "failed") return null;

  return (
    <aside aria-label="Video" data-transcript-offer className="mb-8 rounded-card border border-line bg-bg2 px-5 py-4 font-sans">
      <div className="flex items-start gap-3">
        <Captions size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg2" aria-hidden />
        <div className="min-w-0 flex-1">
          {state === "failed" ? (
            <p role="alert" className="m-0 text-[14px] leading-relaxed text-danger">{status.error || "Transcribing the video failed."}</p>
          ) : (
            <>
              <p className="m-0 text-[14px] leading-relaxed text-fg">This post has a video that runs {videoLength(seconds)}.</p>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-fg2">
                {state === "done" ? "It has already been transcribed. Add the transcript to read and listen to what is said." : "Transcribe it to read and listen to what is said."}
              </p>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={request}>{state === "failed" ? "Retry" : state === "done" ? "Add transcript" : "Transcribe"}</Button>
            {state !== "failed" && <Button variant="ghost" onClick={() => useTranscripts.getState().dismiss(record.id)}>Not now</Button>}
          </div>
        </div>
      </div>
    </aside>
  );
}
