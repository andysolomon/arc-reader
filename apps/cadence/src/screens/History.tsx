import { ChevronRight } from "lucide-react";
import type { Passage } from "@readaloud/practice/passages";
import { dayOf } from "@readaloud/practice/score";
import { currentStreak } from "@readaloud/practice/store";
import { usePractice } from "../store";
import { bandTitle, dayLabel, roundTitle } from "../text";

export function History({ onRead }: { onRead: (passage: Passage) => void }) {
  const name = usePractice((s) => s.readerName);
  const band = usePractice((s) => s.band);
  const points = usePractice((s) => s.points);
  const history = usePractice((s) => s.history);
  const streak = usePractice((s) => currentStreak(s, dayOf(Date.now())));
  const rounds = [...history].reverse();

  return <main className="page page-list" style={{ gap: 20 }}>
    <header className="page-head">
      <h1 className="title">History</h1>
      <p className="subtitle">{name} · {bandTitle(band)}</p>
    </header>
    <div className="stats">
      <div className="stat"><span className="stat-number tabular">{streak}</span><span className="stat-label">day streak</span></div>
      <div className="stat"><span className="stat-number tabular">{history.length}</span><span className="stat-label">{history.length === 1 ? "reading" : "readings"}</span></div>
      <div className="stat"><span className="stat-number tabular">{points.toLocaleString("en-US")}</span><span className="stat-label">points</span></div>
    </div>
    <section aria-label="Readings" className="section">
      <h2 className="section-label">Readings</h2>
      {rounds.length ? <div className="list">
        {rounds.map((round) => {
          const { title, author, passage } = roundTitle(round);
          const body = <span className="list-body" style={{ minHeight: 66 }}>
            <span className="list-main"><span className="list-title">{passage && <span className="sr-only">Read again: </span>}{title}</span><span className="list-sub">{[dayLabel(round.at), author].filter(Boolean).join(" · ")}</span></span>
            <span className="reading-score"><span className="tabular">{round.accuracy}%</span><span className="list-sub tabular">{round.wcpm} / min</span></span>
            {passage && <ChevronRight size={18} className="chevron" aria-hidden />}
          </span>;
          // A bundled passage can be read again; a news passage's words aren't kept.
          return passage
            ? <button key={round.at} type="button" className="list-row" onClick={() => onRead(passage)}>{body}</button>
            : <div key={round.at} className="list-row">{body}</div>;
        })}
      </div> : <p className="empty">Your readings will be listed here.</p>}
    </section>
  </main>;
}
