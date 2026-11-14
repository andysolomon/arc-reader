import { EXPRESSION, PACE, PHRASING, type Judgement } from "../../lib/practice/judge";
import type { Score } from "../../lib/practice/score";
import { Meter, PaceDots } from "./parts";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Row({ title, detail, children, last }: { title: string; detail: string; children: React.ReactNode; last?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 px-4 py-3.5 ${last ? "" : "border-b border-line"}`}>
    <div className="flex flex-col"><span className="text-[15px]">{title}</span><span className="text-[13px] text-fg2">{detail}</span></div>
    {children}
  </div>;
}

export function ScorePanel({ score, judgement, speech }: { score: Score; judgement: Judgement; speech: number }) {
  const note = score.unsure === 1
    ? "One word was unclear in the recording, so it isn't counted against you. Tap it to try again."
    : score.unsure > 1 ? `${score.unsure} words were unclear in the recording, so they aren't counted against you. Tap one to try again.` : "";
  return <section aria-label="Score" className="flex flex-col rounded-panel border border-line bg-bg2">
    <div className="grid grid-cols-2 border-b border-line">
      <div className="flex flex-col gap-0.5 border-r border-line px-4 py-3.5">
        <span className="text-[13px] text-fg2">Accuracy</span>
        <span className="tabular font-serif text-[30px] font-medium leading-tight">{score.accuracy}%</span>
        <span className="text-[12px] text-fg2">{score.correct} of {score.counted} words</span>
      </div>
      <div className="flex flex-col gap-0.5 px-4 py-3.5">
        <span className="text-[13px] text-fg2">Words correct / min</span>
        <span className="tabular font-serif text-[30px] font-medium leading-tight">{score.wcpm}</span>
        <span className="text-[12px] text-fg2">{Math.round(speech)} s of speech</span>
      </div>
    </div>
    <Row title="Phrasing" detail={`Level ${judgement.phrasing} of ${PHRASING.length} · ${PHRASING[judgement.phrasing - 1]}`}><Meter value={judgement.phrasing} of={PHRASING.length} /></Row>
    <Row title="Expression" detail={`Level ${judgement.expression} of ${EXPRESSION.length} · ${EXPRESSION[judgement.expression - 1]}`}><Meter value={judgement.expression} of={EXPRESSION.length} /></Row>
    <Row title="Pace" detail={cap(PACE[judgement.pace - 1])} last={!note}><PaceDots pace={judgement.pace} /></Row>
    {note && <p className="m-0 px-4 py-3.5 text-[13px] text-fg2">{note}</p>}
  </section>;
}
