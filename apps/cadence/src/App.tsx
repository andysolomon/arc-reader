import { useEffect, useState } from "react";
import { BookOpen, Bookmark, Clock } from "lucide-react";
import type { Passage } from "@readaloud/practice/passages";
import { usePractice } from "./store";
import { usePassageDeck } from "./usePassageDeck";
import { Drill } from "./screens/Drill";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { Reading, type Result } from "./screens/Reading";
import { Readers } from "./screens/Readers";
import { Results } from "./screens/Results";
import type { PracticeWord } from "./screens/Word";
import { Words } from "./screens/Words";
import { Logo } from "./ui";

type Tab = "read" | "words" | "history";
/** What fills the screen: the tabs, or one of the flows that take it over. */
type View = { name: "tabs" } | { name: "reading" } | { name: "results"; result: Result } | { name: "drill"; words: PracticeWord[]; back: View };

const TABS = [
  { id: "read", label: "Read", Icon: BookOpen },
  { id: "words", label: "Words", Icon: Bookmark },
  { id: "history", label: "History", Icon: Clock },
] as const;

export function App() {
  const [tab, setTab] = useState<Tab>("read");
  const [view, setView] = useState<View>({ name: "tabs" });
  const [readers, setReaders] = useState(false);
  const readerId = usePractice((s) => s.readerId);
  const deck = usePassageDeck();
  const { load } = deck;
  // A passage for whoever is reading, at their level; switching reader brings one at theirs.
  useEffect(() => { void load(usePractice.getState().band); }, [load, readerId]);
  useEffect(() => { window.scrollTo(0, 0); }, [view.name, tab]);

  const band = () => usePractice.getState().band;
  const home = () => setView({ name: "tabs" });
  const drill = (words: PracticeWord[], back: View) => { if (words.length) setView({ name: "drill", words, back }); };
  const readAgain = (passage: Passage) => { deck.show(passage); setView({ name: "reading" }); };

  if (view.name === "reading") return <Reading deck={deck} onClose={home} onResult={(result) => setView({ name: "results", result })} />;
  if (view.name === "results") return <Results result={view.result}
    // The passage just read gives way to a new one, wherever the reader goes next.
    onClose={() => { void load(band()); home(); }}
    onNext={() => { void load(band()); setView({ name: "reading" }); }}
    onAgain={() => readAgain(view.result.passage)}
    onPractise={(words) => drill(words, view)} />;
  if (view.name === "drill") return <Drill words={view.words} onDone={() => setView(view.back)} />;

  return <div className="shell">
    {tab === "read" && <Home deck={deck} onStart={() => setView({ name: "reading" })} onReaders={() => setReaders(true)} onWords={() => setTab("words")} onHistory={() => setTab("history")} />}
    {tab === "words" && <Words onPractise={(words) => drill(words, view)} />}
    {tab === "history" && <History onRead={readAgain} />}
    {/* A tab bar on a phone; a sidebar with the app's name on a wide screen. */}
    <nav aria-label="Primary" className="tabbar">
      <span className="brand"><Logo /><span>Cadence</span></span>
      {TABS.map(({ id, label, Icon }) => <button key={id} type="button" className="tab" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
        <Icon size={23} aria-hidden /><span>{label}</span>
      </button>)}
    </nav>
    {readers && <Readers onClose={() => setReaders(false)} />}
  </div>;
}
