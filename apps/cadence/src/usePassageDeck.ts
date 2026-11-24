import { useCallback, useEffect, useRef, useState } from "react";
import type { Band } from "@readaloud/practice/bands";
import { nextPassage, type Passage } from "@readaloud/practice/passages";

const RECENT = 12;

export interface PassageDeck {
  passage: Passage | null;
  loading: boolean;
  failed: boolean;
  load: (band: Band) => Promise<void>;
  /** Put a particular passage up, to read it again. */
  show: (passage: Passage) => void;
}

/**
 * The passage on the table and the one after it. The next is fetched while this one is read,
 * since finding a news passage that fits can take a while.
 */
export function usePassageDeck(): PassageDeck {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const recent = useRef<string[]>([]);
  const loader = useRef<AbortController>();
  const upcoming = useRef<{ band: Band; promise: Promise<Passage>; ac: AbortController } | null>(null);
  useEffect(() => () => { loader.current?.abort(); upcoming.current?.ac.abort(); }, []);

  const remember = (p: Passage) => { recent.current = [...recent.current.filter((id) => id !== p.id), p.id].slice(-RECENT); };
  const prefetch = (band: Band) => {
    upcoming.current?.ac.abort();
    const ac = new AbortController();
    const promise = nextPassage(band, { avoid: recent.current, signal: ac.signal });
    promise.catch(() => undefined);
    upcoming.current = { band, promise, ac };
  };

  const load = useCallback(async (band: Band) => {
    loader.current?.abort();
    const ready = upcoming.current?.band === band ? upcoming.current : null;
    if (!ready) upcoming.current?.ac.abort();
    upcoming.current = null;
    const ac = ready?.ac ?? new AbortController(); loader.current = ac;
    setLoading(true); setFailed(false);
    try {
      const next = await (ready?.promise ?? nextPassage(band, { avoid: recent.current, signal: ac.signal }));
      if (ac.signal.aborted) return;
      remember(next);
      setPassage(next);
      prefetch(band);
    } catch { if (!ac.signal.aborted) setFailed(true); }
    finally { if (!ac.signal.aborted) setLoading(false); }
  }, []);

  const show = useCallback((p: Passage) => {
    loader.current?.abort();
    remember(p);
    setLoading(false); setFailed(false); setPassage(p);
  }, []);

  return { passage, loading, failed, load, show };
}
