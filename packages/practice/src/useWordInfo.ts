import { useEffect, useState } from "react";
import { lookUpWord, storedWordInfo, type WordInfo } from "./wordInfo";

export type Lookup = { state: "loading" } | { state: "done"; info: WordInfo } | { state: "error"; message: string };

/** Look a word up when it's shown, in the sentence it was read in when that's known. */
export function useWordInfo(word: string, sentence?: string): Lookup {
  const [lookup, setLookup] = useState<Lookup>(() => {
    const stored = storedWordInfo(word, sentence);
    return stored ? { state: "done", info: stored } : { state: "loading" };
  });
  useEffect(() => {
    let live = true;
    lookUpWord(word, sentence).then(
      (info) => { if (live) setLookup({ state: "done", info }); },
      (e: unknown) => { if (live) setLookup({ state: "error", message: e instanceof Error ? e.message : "Couldn't look this word up right now." }); },
    );
    return () => { live = false; };
  }, [word, sentence]);
  return lookup;
}
