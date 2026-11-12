import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlignLeft, ChevronDown, Link2, Upload, X } from "lucide-react";
import { Button, Chip, IconButton, TextArea, VoiceAvatar, VoiceServiceName, formatSpeed, cn } from "@readaloud/ui";
import { voiceSource } from "../data/voices";
import { PLACEHOLDERS } from "../data/sample";
import { getVoice } from "../state/voices";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { fetchReadable, hostOf, isWebAddress, looksLikeUrl, normalizeUrl } from "../lib/fetchUrl";
import { openDocument } from "../lib/openDoc";
import { importPage, isContentsPage } from "../state/books";
import { SPEED_STEPS } from "@readaloud/ui";
import { useClipboardImport } from "../hooks/useClipboardImport";
import { useIsTouch } from "../hooks/useMedia";

const DRAFT_KEY = "readaloud:draft";
const TEXT_PANEL_ID = "compose-text";

/**
 * Compose: a link field first, since most reading starts by pasting an address found elsewhere.
 * Pasting a link starts reading at once; pasting prose opens the text box instead. A link is a
 * link in the text box too: the page is fetched, the address is never read out as text.
 */
export function Compose() {
  const clipboard = useClipboardImport();
  const navigate = useNavigate();
  const layout = useSettings((s) => s.composeLayout);
  const voice = getVoice(useSettings((s) => s.voice));
  const speed = usePlayer((s) => s.speed);
  const setSpeed = usePlayer((s) => s.setSpeed);
  const hasDoc = usePlayer((s) => !!s.doc);
  const create = useLibrary((s) => s.create);
  const touch = useIsTouch();

  const [url, setUrl] = useState("");
  const [text, setText] = useState(() => sessionStorage.getItem(DRAFT_KEY) ?? "");
  const [title, setTitle] = useState<string | undefined>();
  const [textOpen, setTextOpen] = useState(() => !!sessionStorage.getItem(DRAFT_KEY)?.trim());
  const [ph, setPh] = useState(0);
  const [busy, setBusy] = useState<"fetch" | "listen" | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const focusText = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 3400);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, text);
  }, [text]);
  useEffect(() => {
    if (textOpen && focusText.current) {
      focusText.current = false;
      ta.current?.focus();
    }
  }, [textOpen]);

  const openText = (focus = true) => {
    focusText.current = focus;
    setTextOpen(true);
    if (focus) ta.current?.focus();
  };

  const clearText = () => {
    setText("");
    setTitle(undefined);
    ta.current?.focus();
  };

  const readLink = async (raw: string) => {
    const input = raw.trim();
    if (!input || busy) return;
    const host = hostOf(normalizeUrl(input));
    setBusy("fetch");
    toast(`Fetching ${host}…`);
    try {
      const f = await fetchReadable(input);
      const rec = await importPage(f, { source: "url" });
      // A contents page is there to be swapped for its chapters, so it opens without reading itself out.
      const listen = !isContentsPage(f);
      await openDocument(rec, navigate, { autoplay: listen, resume: false, prepare: listen });
    } catch {
      toast(`Couldn't read ${host} — try pasting the text`);
      linkRef.current?.focus();
      linkRef.current?.select();
    } finally {
      setBusy(null);
    }
  };

  const readText = async (t: string) => {
    setBusy("listen");
    try {
      const rec = await create({ text: t, title, source: "paste" });
      sessionStorage.removeItem(DRAFT_KEY);
      await openDocument(rec, navigate, { autoplay: true, resume: false, prepare: true });
    } finally {
      setBusy(null);
    }
  };

  /** A link that ended up in the text box moves to the link field and is fetched from there. */
  const readLinkFromText = (link: string) => {
    setText("");
    setTitle(undefined);
    setTextOpen(false);
    setUrl(link);
    return readLink(link);
  };

  /** Visible text wins; otherwise the link; a hidden draft is read only when there is no link. */
  const listen = async () => {
    if (busy) return;
    const t = text.trim();
    const link = url.trim();
    if (t && (textOpen || !link)) return isWebAddress(t) ? readLinkFromText(t) : readText(t);
    if (link) return readLink(link);
    toast("Paste a link or some text first");
    linkRef.current?.focus();
  };

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    void listen();
  };

  const onLinkPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text/plain").trim();
    if (!pasted) return;
    e.preventDefault();
    if (looksLikeUrl(pasted)) {
      setUrl(pasted);
      void readLink(pasted);
      return;
    }
    setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${pasted}` : pasted));
    setTitle(undefined);
    openText();
  };

  const onTextPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text/plain").trim();
    const { selectionStart, selectionEnd, value } = e.currentTarget;
    // Only when the link would be all there is in the box; one pasted into a sentence is part of the text.
    if (busy || !isWebAddress(pasted) || (value.slice(0, selectionStart) + value.slice(selectionEnd)).trim()) return;
    e.preventDefault();
    void readLinkFromText(pasted);
  };

  const onLinkKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void listen();
    }
  };

  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void listen();
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      setText(String(r.result ?? ""));
      setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ""));
      openText();
    };
    r.onerror = () => toast("Couldn't read that file");
    r.readAsText(file);
  };

  const centered = layout !== "editorial";
  const fetching = busy === "fetch";

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

        <form onSubmit={submitLink} className="flex flex-col gap-2">
          <motion.div layoutId="doc-surface" className="rounded-card">
            <label
              className={cn(
                "flex h-[60px] items-center gap-3 rounded-card border bg-bg2 pl-5 pr-3 transition-colors duration-base focus-within:border-fg3",
                fetching ? "border-fg3" : "border-line",
              )}
            >
              <span className="grid shrink-0 text-fg2" aria-hidden>
                {fetching ? <Spinner /> : <Link2 size={20} strokeWidth={1.5} />}
              </span>
              <input
                ref={linkRef}
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                autoFocus={!touch && !textOpen}
                aria-label="Link to read"
                aria-busy={fetching || undefined}
                placeholder="Paste a link…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={onLinkPaste}
                onKeyDown={onLinkKey}
                disabled={busy === "listen" || clipboard.busy}
                className="min-w-0 flex-1 border-0 bg-transparent font-serif text-[19px] text-fg outline-none placeholder:text-fg3"
              />
            </label>
          </motion.div>
          <p className={cn("text-[13px] text-fg2", centered ? "text-center" : "text-left")}>
            {fetching ? `Fetching ${hostOf(normalizeUrl(url))}…` : "Reading starts as soon as you paste a link."}
          </p>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-control border border-line bg-bg2 px-3 text-[13px] text-fg hover:bg-bg3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <span className="grid text-fg2">
              <Upload size={16} strokeWidth={1.5} aria-hidden />
            </span>
            Upload file
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={(e) => onFile(e.target.files?.[0])} className="sr-only" />
          </label>
          <Button
            leading={<AlignLeft size={16} strokeWidth={1.5} />}
            trailing={<ChevronDown size={14} strokeWidth={1.5} className={cn("text-fg2 transition-transform duration-base motion-reduce:transition-none", textOpen && "rotate-180")} aria-hidden />}
            onClick={() => (textOpen ? setTextOpen(false) : openText())}
            aria-expanded={textOpen}
            aria-controls={textOpen ? TEXT_PANEL_ID : undefined}
            className={cn(textOpen && "bg-bg3")}
          >
            Type or paste text
            {!textOpen && !!text.trim() && (
              <>
                <span className="ml-1 size-1.5 rounded-full bg-accent" aria-hidden />
                <span className="sr-only">, draft saved</span>
              </>
            )}
          </Button>
          <span className="flex-1" />
          <Chip leading={<VoiceAvatar voice={voice} size={24} />} onClick={() => navigate("/voices")} aria-label={`Voice: ${voice.name} · ${voiceSource(voice)}. Change voice`}>
            <VoiceServiceName source={voiceSource(voice)}>{voice.name}</VoiceServiceName>
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

        {textOpen && (
          <div id={TEXT_PANEL_ID} className="relative animate-rise">
            <TextArea
              ref={ta}
              aria-label="Text to read"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTitle(undefined);
              }}
              onPaste={onTextPaste}
              onKeyDown={onTextKey}
              placeholder={PLACEHOLDERS[ph]}
              rows={8}
              className={cn(text && "pr-14")}
            />
            {text && (
              <span className="absolute right-1.5 top-1.5">
                <IconButton label="Clear text" size={44} round onClick={clearText}>
                  <X size={18} strokeWidth={1.5} aria-hidden />
                </IconButton>
              </span>
            )}
          </div>
        )}

        <div className="mt-1 flex items-center gap-4">
          <Button variant="primary" size="xl" onClick={() => void listen()} loading={busy !== null} disabled={clipboard.busy} data-testid="listen">
            Listen
            <span className="rounded-[6px] bg-black/15 px-2 py-1 font-mono text-[12px] font-medium" aria-hidden>
              ⌘↵
            </span>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Spinner() {
  return <span className="inline-block size-[18px] rounded-full border-[1.5px] border-current border-r-transparent animate-spin motion-reduce:animate-none" />;
}
