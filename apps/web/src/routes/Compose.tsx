import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Clipboard, Link2, Upload } from "lucide-react";
import { Button, Chip, TextArea, VoiceAvatar, formatSpeed, cn, Input } from "@readaloud/ui";
import { PLACEHOLDERS, SAMPLE, SAMPLE_TITLE } from "../data/sample";
import { getVoice } from "../state/voices";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { fetchReadable, hostOf } from "../lib/fetchUrl";
import { openDocument } from "../lib/openDoc";
import { SPEED_STEPS } from "@readaloud/ui";
import { useClipboardImport } from "../hooks/useClipboardImport";

const DRAFT_KEY = "readaloud:draft";

export function Compose() {
  const clipboard = useClipboardImport();
  const navigate = useNavigate();
  const layout = useSettings((s) => s.composeLayout);
  const voice = getVoice(useSettings((s) => s.voice));
  const speed = usePlayer((s) => s.speed);
  const setSpeed = usePlayer((s) => s.setSpeed);
  const hasDoc = usePlayer((s) => !!s.doc);
  const create = useLibrary((s) => s.create);

  const [text, setText] = useState(() => sessionStorage.getItem(DRAFT_KEY) ?? "");
  const [title, setTitle] = useState<string | undefined>();
  const [ph, setPh] = useState(0);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"fetch" | "listen" | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 3400);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, text);
  }, [text]);
  useEffect(() => {
    if (showUrl) urlRef.current?.focus();
  }, [showUrl]);

  const listen = async () => {
    const t = text.trim();
    if (!t) {
      toast("Paste or type something first");
      ta.current?.focus();
      return;
    }
    setBusy("listen");
    try {
      const rec = await create({ text: t, title, source: t === SAMPLE ? "sample" : "paste", domain: t === SAMPLE ? "Sample" : undefined });
      sessionStorage.removeItem(DRAFT_KEY);
      await openDocument(rec, navigate, { autoplay: true, resume: false });
    } finally {
      setBusy(null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void listen();
    }
  };

  const fetchUrl = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy("fetch");
    toast(`Fetching ${hostOf(url)}…`);
    try {
      const f = await fetchReadable(url);
      const rec = await create({ text: f.text, title: f.title, source: "url", domain: f.domain });
      await openDocument(rec, navigate, { autoplay: true, resume: false });
    } catch {
      toast(`Couldn't read ${hostOf(url)} — try pasting the text`);
    } finally {
      setBusy(null);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      setText(String(r.result ?? ""));
      setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ""));
      setShowUrl(false);
      ta.current?.focus();
    };
    r.onerror = () => toast("Couldn't read that file");
    r.readAsText(file);
  };

  const centered = layout !== "editorial";

  return (
    <section
      data-screen="compose"
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto animate-fadein", centered ? "px-6 py-12" : "px-6 pb-12 pt-12 sm:px-16 sm:pt-[72px]")}
      style={{ paddingBottom: hasDoc ? 160 : undefined }}
    >
      <div className={cn("flex w-full flex-col gap-3.5", centered ? "m-auto max-w-compose" : "mr-auto max-w-editorial")}>
        <h1
          className={cn("font-serif font-normal leading-[1.15] tracking-[-.01em] text-fg", centered ? "mb-2.5 text-center text-[30px]" : "mb-6 text-left text-[32px] sm:text-[44px]")}
        >
          What should I read to you?
        </h1>
        <motion.div layoutId="doc-surface" className="rounded-card">
          <TextArea
            ref={ta}
            aria-label="Text to read"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTitle(undefined);
            }}
            onKeyDown={onKey}
            placeholder={PLACEHOLDERS[ph]}
            rows={8}
          />
        </motion.div>
        <div className="flex flex-wrap items-center gap-2">
          <Button leading={<Clipboard size={16} strokeWidth={1.5} />} onClick={() => void clipboard.readClipboard()} loading={clipboard.busy} disabled={busy !== null}>
            Read clipboard
          </Button>
          <Button leading={<Link2 size={16} strokeWidth={1.5} />} onClick={() => setShowUrl((v) => !v)} aria-expanded={showUrl}>
            From URL
          </Button>
          <label className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-control border border-line bg-bg2 px-3 text-[13px] text-fg hover:bg-bg3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <span className="grid text-fg2">
              <Upload size={16} strokeWidth={1.5} aria-hidden />
            </span>
            Upload file
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={(e) => onFile(e.target.files?.[0])} className="sr-only" />
          </label>
          <span className="flex-1" />
          <Chip leading={<VoiceAvatar voice={voice} size={24} />} onClick={() => navigate("/voices")} aria-label={`Voice: ${voice.name}. Change voice`}>
            {voice.name}
          </Chip>
          <Chip
            onClick={() => {
              const i = SPEED_STEPS.indexOf(speed);
              setSpeed(i === -1 ? 1 : SPEED_STEPS[(i + 1) % SPEED_STEPS.length]);
            }}
            aria-label={`Speed ${formatSpeed(speed)}. Tap to cycle`}
            className="min-w-[58px]"
          >
            {formatSpeed(speed)}
          </Chip>
        </div>
        {showUrl && (
          <form onSubmit={fetchUrl} className="flex gap-2 animate-rise">
            <Input ref={urlRef} type="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Article URL" className="flex-1" />
            <Button type="submit" size="md" loading={busy === "fetch"} disabled={clipboard.busy} className="bg-bg3">
              Fetch
            </Button>
          </form>
        )}
        <div className="mt-1 flex items-center gap-4">
          <Button variant="primary" size="xl" onClick={listen} loading={busy === "listen"} disabled={clipboard.busy} data-testid="listen">
            Listen
            <span className="rounded-[6px] bg-black/15 px-2 py-1 font-mono text-[12px] font-medium" aria-hidden>
              ⌘↵
            </span>
          </Button>
          <Button
            variant="link"
            onClick={() => {
              setText(SAMPLE);
              setTitle(SAMPLE_TITLE);
              ta.current?.focus();
            }}
          >
            Try a sample
          </Button>
        </div>
      </div>
    </section>
  );
}
