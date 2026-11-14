import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw } from "lucide-react";
import { Button, SectionLabel } from "@readaloud/ui";
import { useMicRecorder } from "../hooks/useMicRecorder";
import { useLiveCoach } from "../hooks/useLiveCoach";
import { nextPassage, type Passage } from "../lib/practice/passages";
import type { Band } from "../lib/practice/bands";
import { prepareTake } from "../lib/practice/audio";
import { judgeReading, type Judgement } from "../lib/practice/judge";
import { feedback, scoreReading, dayOf, type Score } from "../lib/practice/score";
import { displayText } from "../lib/practice/words";
import { currentStreak, usePractice } from "../state/practice";
import { ArrowBox, LevelChip, LevelPicker, StreakChip, TitleRow } from "../components/practice/parts";
import { PassageCard } from "../components/practice/PassageCard";
import { LivePassage } from "../components/practice/LivePassage";
import { RecorderControls } from "../components/practice/RecorderControls";
import { JudgingPanel } from "../components/practice/JudgingPanel";
import { MarkKey, MarkedPassage } from "../components/practice/MarkedPassage";
import { ScorePanel } from "../components/practice/ScorePanel";
import { WordBank } from "../components/practice/WordBank";
import { ReaderPicker } from "../components/practice/ReaderPicker";
import { WordDrill, type DrillWord } from "../components/practice/WordDrill";
import { MARK, markLine } from "../components/practice/verdicts";
import { toGo } from "../state/practice";
import { ErrorNotice } from "../components/studio/shared";

const METER_BARS = 20;
const RECENT = 12;

interface Result { judgement: Judgement; score: Score; speech: number; phrase: string; points: number; streakDay: number }
type Phase = "start" | "reading" | "judging" | "results" | "drill";

export function PracticePage() {
  const band = usePractice((s) => s.band);
  const setBand = usePractice((s) => s.setBand);
  const streak = usePractice((s) => currentStreak(s, dayOf(Date.now())));
  const [phase, setPhase] = useState<Phase>("start");
  const [passage, setPassage] = useState<Passage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [takeSeconds, setTakeSeconds] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [openWord, setOpenWord] = useState<number | null>(null);
  const [drill, setDrill] = useState<{ words: DrillWord[]; back: Phase } | null>(null);
  const recent = useRef<string[]>([]);
  const loader = useRef<AbortController>();
  const judge = useRef<AbortController>();
  /** The next passage, fetched while this one is read: finding an NPR passage can take a while. */
  const upcoming = useRef<{ band: Band; promise: Promise<Passage>; ac: AbortController } | null>(null);
  useEffect(() => () => { loader.current?.abort(); judge.current?.abort(); upcoming.current?.ac.abort(); }, []);

  const prefetch = (forBand: Band) => {
    upcoming.current?.ac.abort();
    const ac = new AbortController();
    const promise = nextPassage(forBand, { avoid: recent.current, signal: ac.signal });
    promise.catch(() => undefined);
    upcoming.current = { band: forBand, promise, ac };
  };

  const clearMessages = () => { setError(""); setNotice(""); };

  const load = async () => {
    loader.current?.abort();
    const ready = upcoming.current?.band === band ? upcoming.current : null;
    if (!ready) upcoming.current?.ac.abort();
    upcoming.current = null;
    const ac = ready?.ac ?? new AbortController(); loader.current = ac;
    setLoading(true); setLoadFailed(false);
    try {
      const next = await (ready?.promise ?? nextPassage(band, { avoid: recent.current, signal: ac.signal }));
      if (ac.signal.aborted) return;
      recent.current = [...recent.current.filter((id) => id !== next.id), next.id].slice(-RECENT);
      setPassage(next);
      prefetch(band);
    } catch { if (!ac.signal.aborted) setLoadFailed(true); }
    finally { if (!ac.signal.aborted) setLoading(false); }
  };

  const check = async (file: File, seconds: number) => {
    if (!passage) return;
    judge.current?.abort();
    const ac = new AbortController(); judge.current = ac;
    clearMessages(); setTakeSeconds(seconds); setPhase("judging");
    try {
      const take = await prepareTake(file);
      if (ac.signal.aborted) return;
      setTakeSeconds(Math.round(take.duration));
      const judgement = await judgeReading(passage.text, take, ac.signal);
      if (ac.signal.aborted) return;
      if (judgement.offScript) {
        setNotice("That recording didn't match the passage, so it wasn't scored. Read the passage aloud, then stop.");
        setPhase("reading");
        return;
      }
      const score = scoreReading(judgement, take.speech);
      const words = judgement.words;
      usePractice.getState().finishRound({
        passageId: passage.id, accuracy: score.accuracy, wcpm: score.wcpm, phrasing: judgement.prosody?.phrasing ?? 0, points: score.points,
        missed: score.missed.map((w) => w.word), clean: words.filter((w) => w.verdict === "correct").map((w) => w.word),
      });
      setResult({ judgement, score, speech: take.speech, phrase: feedback(score, judgement.prosody?.pace ?? 3), points: score.points, streakDay: usePractice.getState().streak.days });
      setOpenWord(null);
      setPhase("results");
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Checking the reading failed. Please retry.");
      setPhase("reading");
    }
  };

  const secondsRef = useRef(0);
  const mic = useMicRecorder({ meterBars: METER_BARS, capture: true, onRecorded: (file) => void check(file, secondsRef.current) });
  const live = useLiveCoach(phase === "reading" && passage ? passage.text : null, mic.recording, mic.samplesSince);
  secondsRef.current = mic.seconds;

  const startReading = () => { clearMessages(); setResult(null); setPhase("reading"); void load(); };
  const backToStart = () => { mic.discard(); loader.current?.abort(); setLoading(false); clearMessages(); setPhase("start"); };
  const cancelJudging = () => { judge.current?.abort(); setPhase("reading"); };
  const readAgain = () => { clearMessages(); setResult(null); setPhase("reading"); };
  const nextOne = () => { clearMessages(); setResult(null); setPhase("reading"); void load(); };
  const startDrill = (words: DrillWord[], back: Phase) => { if (!words.length) return; setOpenWord(null); setDrill({ words, back }); setPhase("drill"); };
  const drillBank = () => startDrill(toGo(usePractice.getState().words).map((w) => ({
    word: w.word, label: w.missed === 1 ? "Missed once" : `Missed ${w.missed} times`, line: "Listen to it, then try just this word.",
  })), "start");
  const drillMissed = () => result && startDrill(result.score.missed.map((w) => {
    const verdict = w.verdict as keyof typeof MARK;
    return { word: w.word, label: MARK[verdict].label, labelClass: MARK[verdict].labelClass, line: markLine(verdict, w.heard) };
  }), "results");

  return <section data-screen="practice" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-40 sm:px-10 sm:pt-10 animate-fadein">
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      {phase === "start" && <>
        <TitleRow chip={<StreakChip days={streak} />} />
        <p className="m-0 text-fg2">Read a passage aloud. Each word is checked, along with your pace, phrasing and expression.</p>
        <ReaderPicker />
        <div className="flex flex-col gap-2">
          <SectionLabel id="practice-level">Level</SectionLabel>
          <LevelPicker band={band} onChange={setBand} />
        </div>
        <Button variant="primary" size="xl" className="w-full justify-between" trailing={<ArrowBox />} onClick={startReading}>Start reading</Button>
        <WordBank onPractise={drillBank} />
      </>}

      {phase === "drill" && drill && <>
        <TitleRow chip={<LevelChip band={band} />} />
        <WordDrill words={drill.words} onDone={() => { setPhase(drill.back); setDrill(null); }} />
      </>}

      {phase === "reading" && <>
        <TitleRow chip={<LevelChip band={band} onClick={backToStart} />} />
        <PassageCard
          head="Read this aloud"
          passage={passage && !loading ? passage : null}
          action={<Button size="sm" variant="ghost" loading={loading} disabled={mic.recording} onClick={() => { clearMessages(); void load(); }}>Another passage</Button>}
        >
          {passage && !loading
            ? mic.recording ? <LivePassage text={passage.text} live={live} /> : <p className="m-0 font-serif text-lg leading-relaxed">{displayText(passage.text)}</p>
            : <p role="status" className="m-0 text-sm text-fg2">{loadFailed ? "Couldn't load a passage. Try another." : "Finding a passage…"}</p>}
        </PassageCard>
        {notice && <p role="status" className="m-0 rounded-control border border-line bg-bg2 p-3 text-sm text-fg2">{notice}</p>}
        <ErrorNotice error={error || mic.error} />
        <RecorderControls recording={mic.recording} starting={mic.starting} seconds={mic.seconds} levels={mic.levels}
          disabled={!passage || loading} onStart={() => { clearMessages(); void mic.start(); }} onStop={mic.stop} />
      </>}

      {phase === "judging" && passage && <>
        <TitleRow chip={<LevelChip band={band} />} />
        <PassageCard head={`Your reading · ${takeSeconds} second${takeSeconds === 1 ? "" : "s"}`} passage={passage}>
          <p className="m-0 font-serif text-lg leading-relaxed text-fg2">{displayText(passage.text)}</p>
        </PassageCard>
        <JudgingPanel onCancel={cancelJudging} />
      </>}

      {phase === "results" && passage && result && <>
        <TitleRow chip={<LevelChip band={band} />} />
        <div>
          <p className="m-0 font-serif text-[19px] leading-[1.4]">{result.phrase}</p>
          <p className="m-0 text-[13px] text-fg2">+{result.points} points · day {result.streakDay} of your streak</p>
        </div>
        <PassageCard head="Your reading · tap a marked word" passage={passage} footer={<MarkKey />}>
          <MarkedPassage words={result.judgement.words} open={openWord} onOpen={setOpenWord} />
        </PassageCard>
        <ScorePanel score={result.score} judgement={result.judgement} speech={result.speech} />
        <div className="flex flex-col gap-2.5">
          <Button variant="primary" size="xl" className="w-full justify-between" trailing={<ArrowBox />} onClick={nextOne}>Next passage</Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" size="lg" leading={<RotateCcw size={16} aria-hidden />} onClick={readAgain}>Read again</Button>
            {result.score.missed.length > 0 && <Button variant="secondary" size="lg" leading={<Mic size={16} aria-hidden />} onClick={drillMissed}>
              Practise {result.score.missed.length} word{result.score.missed.length === 1 ? "" : "s"}
            </Button>}
          </div>
        </div>
      </>}
    </div>
  </section>;
}
