import { useEffect } from "react";
import { Bookmark, ChevronRight, Clock, Flame, Mic, Square, Volume2 } from "lucide-react";
import { BANDS, type Band } from "@readaloud/practice/bands";
import { dayOf } from "@readaloud/practice/score";
import { speakPassage } from "@readaloud/practice/speak";
import { currentStreak, toGo } from "@readaloud/practice/store";
import { useListen } from "@readaloud/practice/useListen";
import { displayText, wordCount } from "@readaloud/practice/words";
import { usePractice } from "../store";
import { SHORT_BAND, authorOf, plural, readingTime } from "../text";
import { Segmented } from "../ui";
import type { PassageDeck } from "../usePassageDeck";

export function Home({ deck, onStart, onReaders, onWords, onHistory }: {
  deck: PassageDeck; onStart: () => void; onReaders: () => void; onWords: () => void; onHistory: () => void;
}) {
  const band = usePractice((s) => s.band);
  const setBand = usePractice((s) => s.setBand);
  const name = usePractice((s) => s.readerName);
  const streak = usePractice((s) => currentStreak(s, dayOf(Date.now())));
  const pending = usePractice((s) => toGo(s.words).length);
  const last = usePractice((s) => s.history.at(-1));
  const { passage, loading, failed } = deck;
  const listen = useListen();
  const hearing = !!listen.playing;
  // A different passage stops the one being heard.
  const stop = listen.stop;
  useEffect(() => stop, [passage?.id, stop]);

  const changeBand = (next: Band) => { setBand(next); void deck.load(next); };
  const ready = passage && !loading ? passage : null;

  return <main className="page home">
    <header className="title-row">
      <div className="page-head" style={{ gap: 2 }}>
        <span className="eyebrow">Cadence</span>
        <h1 className="title">Practice</h1>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="chip chip-surface" role="img" aria-label={streak ? `${plural(streak, "day")} streak` : "No streak yet"}>
          <Flame size={16} className="flame" aria-hidden /><span>{plural(streak, "day")}</span>
        </div>
        <button type="button" className="avatar" aria-label={`Reading as ${name}. Change reader`} onClick={onReaders}>{(name.trim()[0] ?? "R").toUpperCase()}</button>
      </div>
    </header>

    <section aria-label="Next passage" className="card next">
      <div className="next-text">
        <span className="next-label">Next passage</span>
        {ready ? <>
          <div className="page-head">
            <h2 className="next-title">{ready.title}</h2>
            <span className="next-meta">{[authorOf(ready), plural(wordCount(ready.text), "word"), readingTime(ready.text)].filter(Boolean).join(" · ")}</span>
          </div>
          <p className="next-preview">{displayText(ready.text)}</p>
        </> : <p role="status" className="next-meta">{failed ? "Couldn't load a passage. Try another." : "Finding a passage…"}</p>}
      </div>
      <div className="next-actions">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={onStart}><Mic size={20} aria-hidden /><span>Start reading</span></button>
        <div className="grid2">
          <button type="button" className="btn btn-text" disabled={!ready} aria-pressed={hearing}
            onClick={() => ready && void listen.toggle("voice", (signal, begun) => speakPassage(ready.text, signal, begun))}>
            {hearing ? <Square size={14} fill="currentColor" aria-hidden /> : <Volume2 size={17} aria-hidden />}
            <span>{hearing ? (listen.playing?.ready ? "Stop" : "Preparing…") : "Hear it first"}</span>
          </button>
          <button type="button" className="btn btn-text" disabled={loading} onClick={() => void deck.load(band)}>Another passage</button>
        </div>
        {listen.error && <p role="alert" className="small" style={{ paddingBottom: 12 }}>{listen.error}</p>}
      </div>
    </section>

    <div className="home-side">
    <section aria-label="Level" className="section">
      <h2 className="section-label">Level</h2>
      <Segmented label="Level" role="radiogroup" value={band} onChange={changeBand} options={BANDS.map((b) => ({ id: b.id, label: SHORT_BAND[b.id] }))} />
    </section>

    <section aria-label="Progress" className="list">
      <button type="button" className="list-row" style={{ minHeight: 58 }} onClick={onWords}>
        <span className="icon-tile"><Bookmark size={17} aria-hidden /></span>
        <span className="list-body" style={{ gap: 8, padding: "0 14px 0 0" }}>
          <span className="list-main" style={{ fontSize: 17 }}>Words to practise</span>
          <span className="list-value">{pending}</span>
          <ChevronRight size={18} className="chevron" aria-hidden />
        </span>
      </button>
      <button type="button" className="list-row" style={{ minHeight: 58 }} onClick={onHistory}>
        <span className="icon-tile"><Clock size={17} aria-hidden /></span>
        <span className="list-body" style={{ gap: 8, padding: "0 14px 0 0" }}>
          <span className="list-main" style={{ fontSize: 17 }}>Last reading</span>
          <span className="list-value">{last ? `${last.accuracy}%` : "None yet"}</span>
          <ChevronRight size={18} className="chevron" aria-hidden />
        </span>
      </button>
    </section>
    </div>
  </main>;
}
