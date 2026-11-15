import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Mic, Square, Volume2 } from "lucide-react";
import { prepareTake } from "@readaloud/practice/audio";
import { BANDS, type Band } from "@readaloud/practice/bands";
import { judgeReading, type Judgement } from "@readaloud/practice/judge";
import type { LiveState } from "@readaloud/practice/live";
import type { Passage } from "@readaloud/practice/passages";
import { feedback, scoreReading, type Score } from "@readaloud/practice/score";
import { speakPassage, stopPlayback } from "@readaloud/practice/speak";
import { useListen } from "@readaloud/practice/useListen";
import { useLiveCoach } from "@readaloud/practice/useLiveCoach";
import { useMicRecorder } from "@readaloud/practice/useMicRecorder";
import { displayText, tokens } from "@readaloud/practice/words";
import { usePractice } from "../store";
import { authorOf, bandTitle, byline, clock, plural, tap } from "../text";
import { CloseButton, RoundButton, Sheet } from "../ui";
import type { PassageDeck } from "../usePassageDeck";

const WAVE_BARS = 42;

/** A scored reading, kept only while its results are open. */
export interface Result {
  passage: Passage;
  judgement: Judgement;
  score: Score;
  /** Seconds of speech. */
  speech: number;
  phrase: string;
  recording: File;
}

/** The passage while it is read: words dim as the reader gets to them, the next one is picked out, and misses are marked. */
function LivePassage({ text, live }: { text: string; live: LiveState }) {
  const all = useMemo(() => tokens(text), [text]);
  const here = useRef<HTMLSpanElement>(null);
  // Keep the reader's place on screen as the passage scrolls under the recorder.
  useEffect(() => { if (live.cursor > 0) here.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [live.cursor]);
  return <p className="passage" data-live-cursor={live.cursor}>
    {all.map((t, i) => {
      const space = i && t.space ? " " : "";
      const verdict = live.words[i]?.verdict;
      const read = i < live.cursor;
      const edge = read ? "read" : undefined;
      if (verdict === "mispronounced" || verdict === "substituted" || verdict === "skipped") {
        return <Fragment key={t.index}>{space}<span className={edge}>{t.pre}</span>
          <span data-live-mark={verdict} className={verdict === "mispronounced" ? "hl hl-warm" : `mark-${verdict}`}>{t.word}</span>
          <span className={edge}>{t.post}</span></Fragment>;
      }
      if (i === live.cursor && live.cursor > 0) return <Fragment key={t.index}>{space}{t.pre}<span ref={here} className="hl hl-here">{t.word}</span>{t.post}</Fragment>;
      return <Fragment key={t.index}>{space}<span data-read={read || undefined} className={edge}>{t.pre}{t.word}{t.post}</span></Fragment>;
    })}
  </p>;
}

function LevelSheet({ band, onPick, onClose }: { band: Band; onPick: (band: Band) => void; onClose: () => void }) {
  return <Sheet label="Level" onClose={onClose}>
    <div className="sheet-head"><h1 className="sheet-title">Level</h1><CloseButton onClick={onClose} /></div>
    <p className="sheet-text">Choosing a level brings a new passage at that level.</p>
    <div role="radiogroup" aria-label="Level" className="readers">
      {BANDS.map((b) => <div key={b.id} className="reader">
        <button type="button" role="radio" aria-checked={b.id === band} className="reader-pick" onClick={() => onPick(b.id)}>
          <span className="radio">{b.id === band && <Check size={13} aria-hidden />}</span>
          <span className="list-main"><span className="reader-name">{b.title}</span><span className="list-sub">{b.min}–{b.max} words</span></span>
        </button>
      </div>)}
    </div>
  </Sheet>;
}

/**
 * One reading, from "ready" through recording to the judge. The passage is the deck's; a take
 * that scores hands its result to `onResult`.
 */
export function Reading({ deck, onClose, onResult }: { deck: PassageDeck; onClose: () => void; onResult: (result: Result) => void }) {
  const band = usePractice((s) => s.band);
  const setBand = usePractice((s) => s.setBand);
  const [judging, setJudging] = useState(false);
  const [takeSeconds, setTakeSeconds] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [choosingLevel, setChoosingLevel] = useState(false);
  const judge = useRef<AbortController>();
  useEffect(() => () => { judge.current?.abort(); stopPlayback(); }, []);
  const { loading, failed } = deck;
  const passage = deck.passage && !loading ? deck.passage : null;
  const clearMessages = () => { setError(""); setNotice(""); };

  const check = async (file: File, seconds: number) => {
    if (!passage) return;
    judge.current?.abort();
    const ac = new AbortController(); judge.current = ac;
    clearMessages(); setTakeSeconds(seconds); setJudging(true);
    try {
      const take = await prepareTake(file);
      if (ac.signal.aborted) return;
      setTakeSeconds(Math.round(take.duration));
      const judgement = await judgeReading(passage.text, take, ac.signal);
      if (ac.signal.aborted) return;
      if (judgement.offScript) {
        setNotice("That recording didn't match the passage, so it wasn't scored. Read the passage aloud, then stop.");
        setJudging(false);
        return;
      }
      const score = scoreReading(judgement, take.speech);
      usePractice.getState().finishRound({
        passageId: passage.id, title: passage.title, author: authorOf(passage) || undefined,
        accuracy: score.accuracy, wcpm: score.wcpm, phrasing: judgement.prosody?.phrasing ?? 0, points: score.points,
        missed: score.missed.map((w) => w.word), clean: judgement.words.filter((w) => w.verdict === "correct").map((w) => w.word),
      });
      onResult({ passage, judgement, score, speech: take.speech, phrase: feedback(score, judgement.prosody?.pace ?? 3), recording: file });
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Checking the reading failed. Please retry.");
      setJudging(false);
    }
  };

  const seconds = useRef(0);
  const mic = useMicRecorder({ meterBars: WAVE_BARS, capture: true, onRecorded: (file) => void check(file, seconds.current) });
  seconds.current = mic.seconds;
  const live = useLiveCoach(!judging && passage ? passage.text : null, mic.recording, mic.samplesSince);
  const listen = useListen();
  const hearing = !!listen.playing;
  const total = useMemo(() => (passage ? tokens(passage.text).length : 0), [passage]);

  const close = () => { mic.discard(); onClose(); };
  const another = () => { clearMessages(); listen.stop(); void deck.load(band); };
  const pickLevel = (next: Band) => { setChoosingLevel(false); if (next === band) return; clearMessages(); listen.stop(); setBand(next); void deck.load(next); };
  const record = () => { clearMessages(); listen.stop(); stopPlayback(); void mic.start(); };
  const cancelJudging = () => { judge.current?.abort(); setJudging(false); };
  const problem = error || mic.error || listen.error;

  return <div className="screen" data-screen="reading">
    <header className="topbar">
      <CloseButton onClick={close} />
      {mic.recording || judging
        ? <span className="level-label">{bandTitle(band)}</span>
        : <button type="button" className="level-button" aria-label={`Level: ${bandTitle(band)}. Change level`} onClick={() => setChoosingLevel(true)}>
          <span>{bandTitle(band)}</span><ChevronDown size={16} aria-hidden />
        </button>}
      {mic.recording
        ? <div role="status" aria-label={`Recording, ${plural(mic.seconds, "second")}`} className="chip chip-fill tabular"><span className="rec-dot" /><span>{clock(mic.seconds)}</span></div>
        : judging || !passage ? <span className="topbar-spacer" />
        : <RoundButton label={hearing ? "Stop the voice" : "Hear it read first"} pressed={hearing}
            onClick={() => void listen.toggle("voice", (signal, begun) => speakPassage(passage.text, signal, begun))}>
            {hearing ? <Square size={14} fill="currentColor" aria-hidden /> : <Volume2 size={18} aria-hidden />}
          </RoundButton>}
    </header>

    <main className="reading-main" style={mic.recording ? { gap: 10 } : undefined}>
      <h1 className="sr-only">{judging ? "Checking your reading" : mic.recording ? "Recording your reading" : "Read aloud"}</h1>
      {judging && passage ? <>
        <span className="reading-head"><span>Your reading · {plural(takeSeconds, "second")}</span></span>
        <p className="passage passage-dim">{displayText(passage.text)}</p>
      </> : passage ? <>
        <div className="reading-head">
          <span>{byline(passage)}</span>
          {mic.recording ? <span className="tabular">{live.cursor} of {total}</span>
            : <button type="button" className="link" onClick={another}>Another</button>}
        </div>
        {mic.recording && <div role="img" aria-label={`${live.cursor} of ${plural(total, "word")} read`} className="progress">
          <span style={{ width: `${total ? (live.cursor / total) * 100 : 0}%` }} />
        </div>}
        {mic.recording ? <LivePassage text={passage.text} live={live} /> : <p className="passage">{displayText(passage.text)}</p>}
      </> : <p role="status" className="passage passage-dim">{failed ? "Couldn't load a passage." : "Finding a passage…"}</p>}
      {failed && !passage && <button type="button" className="btn btn-soft" onClick={another}>Try another passage</button>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {problem && <p role="alert" className="notice">{problem}</p>}
    </main>

    {judging ? <footer role="status" className="dock dock-judging">
      <div className="row" style={{ gap: 16 }}>
        <span className="listening" aria-hidden>
          {[[12, -0.2], [28, -0.6], [18, -0.9], [10, -0.4]].map(([height, delay], i) => <span key={i} style={{ height, animationDelay: `${delay}s` }} />)}
        </span>
        <div className="dock-text"><span className="dock-title">Listening to your reading…</span><span className="dock-sub">Checking each word, then pace, phrasing and expression.</span></div>
      </div>
      <button type="button" className="btn btn-text" onClick={cancelJudging}>Cancel</button>
    </footer> : mic.recording ? <footer className="dock dock-live">
      <div className="wave" aria-hidden>
        {mic.levels.map((level, i) => level > 0.02
          ? <span key={i} style={{ height: Math.max(4, Math.round(level * 30)) }} />
          : <span key={i} className="quiet" />)}
      </div>
      <div className="row" style={{ justifyContent: "space-between", gap: 16 }}>
        <div className="dock-text"><span className="dock-title">Recording</span><span className="dock-sub">{tap()} when you reach the end</span></div>
        <button type="button" className="fab fab-stop" aria-label="Stop recording" onClick={mic.stop}><span /></button>
      </div>
    </footer> : <footer className="dock dock-ready">
      <div className="dock-text"><span className="dock-title">Ready when you are</span><span className="dock-sub">{tap()} to record, then read aloud</span></div>
      <button type="button" className="fab" aria-label="Start recording" disabled={!passage || mic.starting} onClick={record}><Mic size={24} aria-hidden /></button>
    </footer>}

    {choosingLevel && <LevelSheet band={band} onPick={pickLevel} onClose={() => setChoosingLevel(false)} />}
  </div>;
}
