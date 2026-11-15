import { useCallback, useEffect, useRef, useState } from "react";

export type ListenKind = "mine" | "voice";
export type Playing = { kind: ListenKind; ready: boolean } | null;

/** One thing playing at a time; pressing what's playing stops it. `ready` turns true when sound begins. */
export function useListen() {
  const [playing, setPlaying] = useState<Playing>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => { controller.current?.abort(); setPlaying(null); }, []);
  const toggle = async (kind: ListenKind, run: (signal: AbortSignal, ready: () => void) => Promise<unknown>) => {
    const wasPlaying = playing?.kind === kind;
    stop();
    if (wasPlaying) return;
    const ac = new AbortController(); controller.current = ac;
    setError(""); setPlaying({ kind, ready: false });
    try { await run(ac.signal, () => { if (!ac.signal.aborted) setPlaying({ kind, ready: true }); }); }
    catch (e) { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Couldn't play that."); }
    finally { if (controller.current === ac) setPlaying(null); }
  };
  return { playing, error, stop, toggle };
}
