import { Fragment, useState } from "react";
import { ArrowRight, Play, Square, Volume2 } from "lucide-react";
import { EXPRESSION, PHRASING, type WordResult } from "@readaloud/practice/judge";
import { MARK_TEXT, isMarked, markLine, type Marked } from "@readaloud/practice/marks";
import { playClip, speakPassage } from "@readaloud/practice/speak";
import { useListen } from "@readaloud/practice/useListen";
import { sentenceAround } from "@readaloud/practice/wordInfo";
import { headline, plural, tap } from "../text";
import { CloseButton, Meter } from "../ui";
import type { Result } from "./Reading";
import { WordSheet, toneOf, type PracticeWord } from "./Word";

const PACE = ["Much too slow", "A little slow", "Steady", "A little fast", "Much too fast"];
const MARK_CLASS: Record<Marked, string> = { mispronounced: "hl hl-warm", substituted: "mark-substituted", skipped: "mark-skipped", unsure: "mark-unsure" };
const RING = 2 * Math.PI * 56;

/** A marked word as something to practise, with the sentence it was read in. */
export const practiceWord = (words: WordResult[], w: WordResult): PracticeWord => {
  const verdict = w.verdict as Marked;
  return { word: w.word, label: MARK_TEXT[verdict].label, tone: toneOf(verdict), line: markLine(verdict, w.heard), sentence: sentenceAround(words, w.index) };
};

function AccuracyRing({ accuracy }: { accuracy: number }) {
  return <div className="ring">
    <svg role="img" aria-label={`${accuracy}% accuracy`} width="132" height="132" viewBox="0 0 132 132">
      <circle className="ring-track" cx="66" cy="66" r="56" fill="none" strokeWidth="12" />
      {accuracy > 0 && <circle className="ring-value" cx="66" cy="66" r="56" fill="none" strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(RING * accuracy) / 100} ${RING}`} transform="rotate(-90 66 66)" />}
    </svg>
    <div className="ring-label" aria-hidden><span className="ring-number tabular">{accuracy}%</span><span className="ring-caption">accuracy</span></div>
  </div>;
}

export function Results({ result, onClose, onNext, onAgain, onPractise }: {
  result: Result; onClose: () => void; onNext: () => void; onAgain: () => void; onPractise: (words: PracticeWord[]) => void;
}) {
  const { judgement, score, passage } = result;
  const words = judgement.words;
  const [open, setOpen] = useState<number | null>(null);
  const listen = useListen();
  const mine = listen.playing?.kind === "mine";
  const voice = listen.playing?.kind === "voice";
  const { head, rest } = headline(result.phrase);
  const prosody = judgement.prosody;
  const marked = words.some((w) => isMarked(w.verdict));
  const unclear = score.unsure === 1 ? "One word was unclear, so it isn't counted." : score.unsure > 1 ? `${score.unsure} words were unclear, so they aren't counted.` : "";
  const note = [unclear, marked ? `${tap()} a marked word to hear it and try again.` : ""].filter(Boolean).join(" ");
  const current = open === null ? undefined : words[open];
  const missed = score.missed.length;
  const stopIcon = <Square size={11} fill="currentColor" aria-hidden />;

  return <div className="screen screen-gap" data-screen="results">
    <header className="topbar"><CloseButton onClick={onClose} /><span className="topbar-title">Results</span><span className="topbar-spacer" /></header>

    <main className="screen-main results-main">
    <div className="results-head">
      <h1 className="results-title">{head}</h1>
      <p className="results-sub">{[rest, `+${plural(score.points, "point")}`].filter(Boolean).join(" · ")}</p>
    </div>

    <section aria-label="Score" className="card score">
      <AccuracyRing accuracy={score.accuracy} />
      <div className="score-side">
        <div><span className="score-big tabular">{score.wcpm}</span><span className="score-cap">words correct / min</span></div>
        <span className="rule" />
        <div><span className="score-mid tabular">{score.correct} of {score.counted}</span><span className="score-cap">words read correctly</span></div>
      </div>
    </section>

    <section aria-label="Fluency" className="list fluency">
      {prosody ? <>
        <div className="fluency-row"><span className="fluency-name">Phrasing</span><span className="fluency-value">{prosody.phrasing} of {PHRASING.length}</span>
          <Meter value={prosody.phrasing} of={PHRASING.length} label={`Phrasing: ${PHRASING[prosody.phrasing - 1]}`} /></div>
        <div className="fluency-row"><span className="fluency-name">Expression</span><span className="fluency-value">{prosody.expression} of {EXPRESSION.length}</span>
          <Meter value={prosody.expression} of={EXPRESSION.length} label={`Expression: ${EXPRESSION[prosody.expression - 1]}`} /></div>
        <div className="fluency-row"><span className="fluency-name">Pace</span><span className="fluency-value">{PACE[prosody.pace - 1]}</span>
          <span role="img" aria-label={`Pace: ${PACE[prosody.pace - 1]}`} className="dots">{PACE.map((_, i) => <span key={i} className={i === prosody.pace - 1 ? "on" : undefined} />)}</span></div>
      </> : <p role="status" className="fluency-note">
        Phrasing, expression and pace weren't checked this time.{" "}
        {judgement.prosodyIssue === "no-key" ? "The reading judge needs a Gemini key, which is added in ReadAloud's Settings." : judgement.prosodyIssue}
      </p>}
    </section>

    <section aria-label="Your reading, word by word" className="card take">
      <div className="take-head">
        <h2>Your reading</h2>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="pill" aria-pressed={mine}
            onClick={() => void listen.toggle("mine", async (signal, begun) => { begun(); await playClip(result.recording, signal); })}>
            {mine ? stopIcon : <Play size={13} aria-hidden />}<span>{mine ? "Stop" : "Yours"}</span>
          </button>
          <button type="button" className="pill" aria-pressed={voice}
            onClick={() => void listen.toggle("voice", (signal, begun) => speakPassage(passage.text, signal, begun))}>
            {voice ? stopIcon : <Volume2 size={13} aria-hidden />}<span>{voice ? (listen.playing?.ready ? "Stop" : "Preparing…") : "Voice"}</span>
          </button>
        </div>
      </div>
      {listen.error && <p role="alert" className="small">{listen.error}</p>}
      <div className="take-text">
        {words.map((w, i) => {
          const space = i && w.space ? " " : "";
          if (!isMarked(w.verdict)) return <Fragment key={w.index}>{space}{w.pre}{w.word}{w.post}</Fragment>;
          // Kept with its punctuation on one line: a button is a place the line may otherwise break.
          return <Fragment key={w.index}>{space}<span style={{ whiteSpace: "nowrap" }}>{w.pre}<button type="button"
            className={`mark ${MARK_CLASS[w.verdict]}`} aria-label={`${w.word}: ${MARK_TEXT[w.verdict].key.toLowerCase()}`}
            aria-haspopup="dialog" aria-expanded={open === i} onClick={() => { listen.stop(); setOpen(i); }}>{w.word}</button>{w.post}</span></Fragment>;
        })}
      </div>
      <div aria-label="Key" className="key">
        {(["mispronounced", "substituted", "skipped", "unsure"] as const).map((v) => <div key={v}>
          <span aria-hidden className={MARK_CLASS[v]}>word</span><span>{MARK_TEXT[v].key}</span>
        </div>)}
      </div>
      {note && <p className="small">{note}</p>}
    </section>

    <div className="stack results-actions">
      <button type="button" className="btn btn-primary" onClick={onNext}><span>Next passage</span><ArrowRight size={20} aria-hidden /></button>
      <div className={missed ? "grid2" : undefined}>
        <button type="button" className="btn btn-soft" onClick={onAgain}>Read again</button>
        {missed > 0 && <button type="button" className="btn btn-soft" onClick={() => onPractise(score.missed.map((w) => practiceWord(words, w)))}>Practise {plural(missed, "word")}</button>}
      </div>
    </div>
    </main>

    {current && isMarked(current.verdict) && <WordSheet key={current.index} word={practiceWord(words, current)} onClose={() => setOpen(null)} />}
  </div>;
}
