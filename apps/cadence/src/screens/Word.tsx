import { Check, Mic, Square, Volume2 } from "lucide-react";
import type { Marked } from "@readaloud/practice/marks";
import { CLEAN_TO_MASTER } from "@readaloud/practice/store";
import { useWordAttempt } from "@readaloud/practice/useWordAttempt";
import { useWordInfo, type Lookup } from "@readaloud/practice/useWordInfo";
import { syllables } from "@readaloud/practice/wordInfo";
import { wordKey } from "@readaloud/practice/words";
import { usePractice } from "../store";
import { CloseButton, Meter, Sheet } from "../ui";

/** A word to practise: what it's called out for, the help under it, and the sentence it was read in. */
export interface PracticeWord {
  word: string;
  label: string;
  /** The label's colour: a mark's own, or plain for a word from the bank. */
  tone: "warm" | "accent" | "plain";
  line: string;
  sentence?: string;
}

export const toneOf = (verdict: Marked): PracticeWord["tone"] => verdict === "mispronounced" ? "warm" : verdict === "substituted" ? "accent" : "plain";
const TAG = { warm: "tag tag-warm", accent: "tag tag-accent", plain: "tag" };

export const Tag = ({ word }: { word: PracticeWord }) => <span className={TAG[word.tone]}>{word.label}</span>;

/** Clean reads toward mastering a word, out of three. */
export function CleanReads({ word }: { word: string }) {
  const clean = usePractice((s) => s.words[wordKey(word)]?.clean ?? 0);
  return <Meter value={clean} of={CLEAN_TO_MASTER} label={`${clean} of ${CLEAN_TO_MASTER} clean reads`} />;
}

/** "an·uh·MOS·i·tee", the stressed syllable in bold, then the IPA and the part of speech. */
function Pronunciation({ lookup }: { lookup: Lookup }) {
  if (lookup.state === "loading") return <p className="pron"><span className="skeleton" aria-hidden /></p>;
  if (lookup.state === "error") return null;
  const { respelling, ipa, partOfSpeech } = lookup.info;
  if (!respelling && !ipa && !partOfSpeech) return null;
  const parts = respelling ? syllables(respelling) : [];
  return <p className="pron">
    {parts.length > 0 && <>
      <span className="sr-only">Say it: {respelling}</span>
      <span aria-hidden className="say">{parts.map((s, i) => <span key={i}>{i > 0 && "·"}{s.stressed ? <strong>{s.text.toUpperCase()}</strong> : s.text}</span>)}</span>
    </>}
    {[ipa, partOfSpeech].filter(Boolean).map((t, i) => <span key={t}>{parts.length > 0 || i > 0 ? " · " : ""}{t}</span>)}
  </p>;
}

/** What the word means here, and where it comes from. */
function About({ lookup }: { lookup: Lookup }) {
  if (lookup.state === "loading") return <div className="about"><p className="soft">Looking up the word…</p></div>;
  if (lookup.state === "error") return <div className="about"><p className="soft">{lookup.message}</p></div>;
  const { meaning, root, rootMeaning, etymology } = lookup.info;
  if (!meaning && !root && !etymology) return null;
  return <div className="about">
    {meaning && <div><h2>Meaning here</h2><p>{meaning}</p></div>}
    {(root || etymology) && <div>
      <h2>Comes from</h2>
      {root && <p><em>{root}</em>{rootMeaning && <span className="soft">, “{rootMeaning}”</span>}</p>}
      {etymology && <p>{etymology}</p>}
    </div>}
  </div>;
}

/** The word, how to say it, Hear it and Try this word, then what it means. The body of the sheet and of the drill's card. */
export function WordBody({ word }: { word: PracticeWord }) {
  const tryWord = usePractice((s) => s.tryWord);
  const { attempt, status, speaking, hear, recording, busy, toggle, action } = useWordAttempt(word.word, word.line, (w) => tryWord(w, true));
  const lookup = useWordInfo(word.word, word.sentence);
  const ok = attempt.state === "done" && attempt.ok;
  const tried = attempt.state === "done" || attempt.state === "error";
  return <>
    <div className="word-head">
      <h1 className="word">{word.word}</h1>
      <Pronunciation lookup={lookup} />
    </div>
    <p role="status" className={ok ? "status status-ok" : "status"}>
      {ok && <Check size={18} aria-hidden />}<span>{status}</span>
    </p>
    <div className="grid2 btn-pair">
      <button type="button" className="btn btn-soft" disabled={speaking} onClick={() => void hear()}><Volume2 size={18} aria-hidden /><span>Hear it</span></button>
      <button type="button" className={tried && !recording ? "btn btn-soft" : "btn btn-primary"} disabled={busy} onClick={toggle}>
        {recording ? <Square size={15} fill="currentColor" aria-hidden /> : <Mic size={18} aria-hidden />}<span>{attempt.state === "checking" ? "Checking…" : action}</span>
      </button>
    </div>
    <About lookup={lookup} />
  </>;
}

/** A word's details in a sheet, from a marked word in the results or a row in Words. */
export function WordSheet({ word, onClose }: { word: PracticeWord; onClose: () => void }) {
  return <Sheet label={`Practise ${word.word}`} onClose={onClose}>
    <div className="sheet-head"><Tag word={word} /><CloseButton onClick={onClose} /></div>
    <WordBody word={word} />
  </Sheet>;
}
