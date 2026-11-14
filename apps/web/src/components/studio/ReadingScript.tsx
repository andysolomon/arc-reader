import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@readaloud/ui";
import { nprReadingScript, type ReadingScript } from "../../lib/readingScript";

/**
 * Something to read while recording: a short passage from a current NPR story, with a button
 * for another. The parent hears about each passage so a recording can be matched to its words.
 */
export function ReadingScriptCard({ onScript }: { onScript: (script: ReadingScript | null) => void }) {
  const [script, setScript] = useState<ReadingScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController>();
  const report = useRef(onScript);
  report.current = onScript;

  const next = useCallback((avoid?: string) => {
    controller.current?.abort();
    const ac = new AbortController(); controller.current = ac;
    setLoading(true); setFailed(false);
    nprReadingScript({ avoid, signal: ac.signal }).then((s) => {
      if (ac.signal.aborted) return;
      setScript(s); report.current(s);
    }).catch(() => {
      if (ac.signal.aborted) return;
      setFailed(true);
    }).finally(() => { if (!ac.signal.aborted) setLoading(false); });
  }, []);
  useEffect(() => { next(); return () => controller.current?.abort(); }, [next]);

  return <section aria-label="Script to read" className="rounded-control bg-bg3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm text-fg2">Read this aloud as you record</h3>
      <Button size="sm" variant="ghost" loading={loading} onClick={() => next(script?.url)}>Another passage</Button>
    </div>
    {script
      ? <>
        <p className="mt-3 font-serif text-lg leading-relaxed" aria-busy={loading}>{script.text}</p>
        <p className="mt-3 text-xs text-fg2">From NPR · <a className="underline" href={script.url} target="_blank" rel="noreferrer">{script.title}</a></p>
      </>
      : <p role="status" className="mt-3 text-sm text-fg2">{failed ? "Couldn't load a passage from NPR. Try another, or read anything you like." : "Finding a passage from NPR…"}</p>}
    {script && failed && <p role="status" className="mt-2 text-sm text-fg2">Couldn't load another passage. Try again in a moment.</p>}
  </section>;
}

/**
 * Fills "Words spoken in the sample" with the passage a microphone recording was read from, so
 * VoiceStudio needn't transcribe it. Words the user typed are never overwritten, and an uploaded
 * file clears a filled-in passage, since it wasn't read from the script.
 */
export function useScriptedReference(reference: string, setReference: (text: string) => void) {
  const script = useRef<ReadingScript | null>(null);
  const filled = useRef("");
  // The recorder reports a take with the callback from when it started, so read the field fresh.
  const latest = useRef(reference);
  latest.current = reference;
  return {
    onScript: (next: ReadingScript | null) => { script.current = next; },
    recorded: () => {
      const text = script.current?.text;
      const current = latest.current;
      if (text && (current === filled.current || !current.trim())) { setReference(text); filled.current = text; }
    },
    uploaded: () => {
      if (filled.current && latest.current === filled.current) setReference("");
      filled.current = "";
    },
    /** True while the field holds the passage as filled in. */
    fromScript: !!filled.current && reference === filled.current,
  };
}

export function ScriptedReferenceNote({ show }: { show: boolean }) {
  return show ? <p className="-mt-3 text-sm text-fg2">Filled in from the passage you read. Edit it if you strayed from the script.</p> : null;
}
