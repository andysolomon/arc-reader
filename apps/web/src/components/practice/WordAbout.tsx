import { useEffect, useState } from "react";
import { lookUpWord, storedWordInfo, syllables, type WordInfo } from "../../lib/practice/wordInfo";

type Lookup = { state: "loading" } | { state: "done"; info: WordInfo } | { state: "error"; message: string };

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

/** "an·uh·MOS·i·tee", the stressed syllable in bold, then the IPA and the part of speech. */
export function Pronunciation({ lookup }: { lookup: Lookup }) {
  if (lookup.state === "loading") return <span aria-hidden className="block h-4 w-40 animate-pulse rounded-[4px] bg-line motion-reduce:animate-none" />;
  if (lookup.state === "error") return null;
  const { respelling, ipa, partOfSpeech } = lookup.info;
  if (!respelling && !ipa && !partOfSpeech) return null;
  const parts = respelling ? syllables(respelling) : [];
  return <p className="m-0 text-[13px] text-fg2">
    {parts.length > 0 && <>
      <span className="sr-only">Say it: {respelling}</span>
      <span aria-hidden className="text-fg">
        {parts.map((s, i) => <span key={i}>{i > 0 && <span className="text-fg3">·</span>}{s.stressed ? <b className="font-semibold">{s.text}</b> : s.text}</span>)}
      </span>
    </>}
    {[ipa, partOfSpeech].filter(Boolean).map((t, i) => <span key={t}>{parts.length > 0 || i > 0 ? " · " : ""}{t}</span>)}
  </p>;
}

const HEADING = "m-0 text-[11px] uppercase tracking-[.08em] text-fg3";

/** What the word means here, and where it comes from. */
export function WordMeaning({ lookup }: { lookup: Lookup }) {
  if (lookup.state === "loading") return <div className="flex flex-col gap-1.5 border-t border-line pt-3">
    <p className="m-0 text-[13px] text-fg2">Looking up the word…</p>
  </div>;
  if (lookup.state === "error") return <p className="m-0 border-t border-line pt-3 text-[13px] text-fg2">{lookup.message}</p>;
  const { meaning, root, rootMeaning, etymology } = lookup.info;
  if (!meaning && !root && !etymology) return null;
  return <div className="flex flex-col gap-2.5 border-t border-line pt-3 text-[13px]">
    {meaning && <div className="flex flex-col gap-0.5">
      <h3 className={HEADING}>Meaning</h3>
      <p className="m-0 text-fg">{meaning}</p>
    </div>}
    {(root || etymology) && <div className="flex flex-col gap-0.5">
      <h3 className={HEADING}>Comes from</h3>
      {root && <p className="m-0 text-fg">{root}{rootMeaning && <span className="text-fg2">, “{rootMeaning}”</span>}</p>}
      {etymology && <p className="m-0 text-fg2">{etymology}</p>}
    </div>}
  </div>;
}
