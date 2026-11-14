import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Copy, Check } from "lucide-react";
import { THEMES } from "@readaloud/tokens";
import { Chip, SectionLabel, Segmented, Switch, ThemeSwatch, VoiceAvatar, VoiceSourceBadge, Button, Input } from "@readaloud/ui";
import { voiceSource } from "../data/voices";
import { getVoice, useVoices } from "../state/voices";
import { useSettings, useThemeId } from "../state/settings";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { ApiUsage } from "../components/ApiUsage";
import { ShortcutsGrid } from "../components/ShortcutsDialog";
import { studioJson, jsonBody } from "../lib/studio";
import { DEFAULT_ENGINE, OPENAI_STANDARD_MODEL, OPENAI_STEADY_MODEL, hasApi, hasOpenAI } from "../engine/providers";
import { writeClipboardText } from "../lib/clipboard";
import { isBundledApp } from "../lib/native";
import { normalizeSpeechServer } from "../lib/speechServer";
import { LOCAL_ENGINE } from "../engine/types";
import { SUMMARY_MODELS } from "../lib/summary";
import { useJev, useLlm } from "../state/llm";
import { CATEGORIES } from "../lib/category";
import { LlmKeyField } from "../components/LlmKeyField";
import { DOC_LINKS, docUrl } from "../lib/docs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}

function RowItem({ label, hint, children, last }: { label: string; hint?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3.5 ${last ? "" : "border-b border-line"}`}>
      <div>
        <div>{label}</div>
        {hint && <div className="text-[13px] text-fg2">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const s = useSettings();
  const theme = useThemeId();
  const voice = getVoice(s.voice);
  const hasDoc = usePlayer((st) => !!st.doc);
  const allEngines = useVoices((v) => v.engines);
  const activeEngine = useVoices((v) => v.activeEngine);
  // Only the active engine's choice matters for profile voices, so offer cloning engines alone.
  const cloners = allEngines.filter((e) => e.cloning && e.available);
  const notInstalled = allEngines.filter((e) => e.cloning && !e.available).length;
  const browserOnly = s.engine === LOCAL_ENGINE;
  const [engineBusy, setEngineBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [speechServer, setSpeechServer] = useState(s.speechServer);
  const [speechKey, setSpeechKey] = useState(s.speechServerKey);
  // Loaded from a ReadAloud server, the shell uses that server's speech proxy like any browser.
  const bundled = isBundledApp();
  useEffect(() => {
    setSpeechServer(s.speechServer);
    setSpeechKey(s.speechServerKey);
  }, [s.speechServer, s.speechServerKey]);
  // Hidden on static hosting, where the server has no /api/llm.
  const llmAvailable = useLlm((st) => st.config !== null);
  const jevAvailable = useJev((st) => st.config !== null);
  useEffect(() => { void useLlm.getState().load(); void useJev.getState().load(); }, []);

  const copyKey = async () => {
    try {
      await writeClipboardText(s.apiKey);
      setCopied(true);
      toast("API key copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Couldn't access the clipboard");
    }
  };
  const masked = `${s.apiKey.slice(0, 8)}${"•".repeat(20)}${s.apiKey.slice(-4)}`;

  return (
    <section data-screen="settings" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: hasDoc ? 160 : 64 }}>
      <div className="mx-auto flex max-w-[720px] flex-col gap-9">
        <h1 className="m-0 font-serif text-[26px] font-medium">Settings</h1>

        <Section title="Appearance">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {THEMES.map((t) => (
              <ThemeSwatch key={t.id} theme={t} selected={theme === t.id} onSelect={() => s.set("theme", t.id)} />
            ))}
          </div>
          <div className="text-[13px] text-fg2">
            Themes are exposed as CSS variables and switched with a <code className="rounded-[4px] bg-bg3 px-[5px] py-px font-mono text-fg">data-theme</code> attribute. The Linux client follows Omarchy's current theme automatically.
          </div>
          <div className="flex flex-col rounded-panel border border-line bg-bg2">
            <RowItem label="Player">
              <Segmented value={s.playerStyle} onChange={(v) => s.set("playerStyle", v)} label="Player style" options={[{ value: "capsule", label: "Capsule" }, { value: "bar", label: "Bar" }]} />
            </RowItem>
            <RowItem label="Highlight">
              <Segmented value={s.highlightStyle} onChange={(v) => s.set("highlightStyle", v)} label="Highlight style" options={[{ value: "block", label: "Block" }, { value: "dim", label: "Dim" }, { value: "underline", label: "Underline" }]} />
            </RowItem>
            <RowItem label="Compose layout" last>
              <Segmented value={s.composeLayout} onChange={(v) => s.set("composeLayout", v)} label="Compose layout" options={[{ value: "centered", label: "Centered" }, { value: "editorial", label: "Editorial" }]} />
            </RowItem>
          </div>
        </Section>

        <Section title="Playback">
          <div className="flex flex-col rounded-panel border border-line bg-bg2">
            <RowItem label="Default voice">
              <Chip size="sm" leading={<VoiceAvatar voice={voice} size={22} />} trailing={<ChevronRight size={16} strokeWidth={1.5} aria-hidden />} onClick={() => navigate("/voices")} className="bg-bg">
                {voice.name}
                <VoiceSourceBadge source={voiceSource(voice)} />
              </Chip>
            </RowItem>
            <RowItem label="Default speed">
              <Segmented
                value={s.defaultSpeed}
                onChange={(v) => {
                  s.set("defaultSpeed", v);
                  usePlayer.getState().setSpeed(v);
                }}
                label="Default speed"
                options={[0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${v}×` }))}
              />
            </RowItem>
            <RowItem label="Auto-play on share" hint="When text arrives from the share sheet, open the Reader already playing.">
              <Switch checked={s.autoplayShare} onChange={(v) => s.set("autoplayShare", v)} label="Auto-play on share" />
            </RowItem>
            <RowItem label="Show links as they are read" hint="When a linked word or phrase has been read, its link appears for a few seconds. Every link is also listed under Links in the Reader.">
              <Switch checked={s.linkToasts} onChange={(v) => s.set("linkToasts", v)} label="Show links as they are read" />
            </RowItem>
            {hasOpenAI() && (
              <RowItem label="OpenAI model" hint="Steady follows a narration prompt for an even delivery and powers accent voices. Standard costs about a third less per passage but ignores the prompt; accent voices stay on Steady.">
                <Segmented
                  value={s.openaiModel === OPENAI_STANDARD_MODEL ? OPENAI_STANDARD_MODEL : OPENAI_STEADY_MODEL}
                  onChange={(v) => s.set("openaiModel", v)}
                  label="OpenAI model"
                  options={[{ value: OPENAI_STEADY_MODEL, label: "Steady" }, { value: OPENAI_STANDARD_MODEL, label: "Standard" }]}
                />
              </RowItem>
            )}
            <RowItem label="Word timings from the server" hint="Asks the speech server to time each word after a passage is synthesized. One extra request per passage; off keeps the estimate." last>
              <Switch checked={s.wordTimings} onChange={(v) => s.set("wordTimings", v)} label="Word timings from the server" disabled={!hasApi()} />
            </RowItem>
          </div>
        </Section>

        {llmAvailable && (
          <Section title="Summaries">
            <p className="mb-3 text-sm text-fg2">This connection also explains code blocks and describes article images and diagrams when you open or prepare a reading. Image descriptions use a vision model (Muse Spark by default). Without it, the reader uses captions or alt text and skips code.</p>
            <div className="flex flex-col rounded-panel border border-line bg-bg2">
              <LlmKeyField />
              <RowItem label="Summary model" hint="Muse Spark is quick and uses little of your OpenCode Go allowance, but its provider may train on the text you send. GLM 5.3 takes about a minute and uses roughly 100× more allowance." last>
                <Segmented value={s.summaryModel} onChange={(v) => s.set("summaryModel", v)} label="Summary model" options={SUMMARY_MODELS.map((m) => ({ value: m.id, label: m.label }))} className="shrink-0 whitespace-nowrap" />
              </RowItem>
            </div>
          </Section>
        )}

        {jevAvailable && (
          <Section title="Library">
            <p className="m-0 text-[13px] text-fg2">
              Jev, TypeSafe’s classification model, files each new document onto one of {Object.keys(CATEGORIES).length} shelves (plus any you name yourself) in well under a second. Change a category in the Reader’s Details panel. The title, link, summary and an excerpt of the text are sent to TypeSafe.
            </p>
            <div className="flex flex-col rounded-panel border border-line bg-bg2">
              <LlmKeyField store={useJev} name="TypeSafe" envName="TYPESAFE_API_KEY" help="From the TypeSafe console (console.typesafe.ai/keys)." last />
            </div>
          </Section>
        )}

        {bundled && (
          <Section title="Speech server">
            <p className="m-0 text-[13px] text-fg2">
              Leave this empty to read with the iPhone’s own voice. To use VoiceStudio, paste its address, for example <span className="font-mono">https://mac.tailnet.ts.net:3900</span>. To use a ReadAloud server that already holds the key, paste its proxy, for example <span className="font-mono">https://host.ts.net:8449/api/vs</span>. A key is sent only to an absolute address, and only from this device.
            </p>
            <div className="flex flex-col gap-2">
              <Input
                value={speechServer}
                onChange={(e) => setSpeechServer(e.target.value)}
                onBlur={() => {
                  const next = normalizeSpeechServer(speechServer);
                  if (speechServer.trim() && !next) {
                    toast("Use an http or https address");
                    setSpeechServer(s.speechServer);
                    return;
                  }
                  setSpeechServer(next);
                  if (next !== s.speechServer) {
                    s.set("speechServer", next);
                    void useVoices.getState().load();
                  }
                }}
                placeholder="https://mac.tailnet.ts.net:3900"
                aria-label="Speech server address"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <Input
                type="password"
                value={speechKey}
                onChange={(e) => setSpeechKey(e.target.value)}
                onBlur={() => {
                  const next = speechKey.trim();
                  setSpeechKey(next);
                  if (next !== s.speechServerKey) s.set("speechServerKey", next);
                }}
                placeholder="VoiceStudio API key, if the server asks for one"
                aria-label="Speech server API key"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </Section>
        )}

        <Section title="Engine">
          <div className="flex flex-col rounded-panel border border-line bg-bg2">
            <RowItem label="Browser voice only" hint="Read everything with this device’s built-in voice, without any speech server." last>
              <Switch checked={browserOnly} onChange={(v) => s.set("engine", v ? LOCAL_ENGINE : DEFAULT_ENGINE)} label="Browser voice only" />
            </RowItem>
          </div>
          {hasApi() ? (
            <>
              <div className="flex flex-col gap-1">
                <div>Saved-voice engine</div>
                <div className="text-[13px] text-fg2">
                  {cloners.length
                    ? `The VoiceStudio engine that speaks your cloned and designed voices${notInstalled > 0 ? `; ${notInstalled} more can be installed from VoiceStudio's Model Catalogue` : ""}. Preset voices always use their own engine.`
                    : allEngines.length
                      ? "The speech server has no voice-cloning engine installed, so cloned and designed voices can’t play. Install one from VoiceStudio’s Model Catalogue."
                      : "Engines appear here once the speech server responds."}
                </div>
              </div>
              {cloners.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saved-voice engine">
                  {cloners.map((e) => (
                    <Chip key={e.id} size="sm" selected={activeEngine === e.id} disabled={engineBusy} onClick={() => {
                      if (activeEngine === e.id) return;
                      setEngineBusy(true);
                      void studioJson("/engines/select", jsonBody({ family: "tts", backend_id: e.id }))
                        .then(() => useVoices.getState().load())
                        .catch((error: Error) => toast(error.message))
                        .finally(() => setEngineBusy(false));
                    }}>
                      {e.label}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-[13px] text-fg2">No local speech server configured. Cloud voices use their own engine; choose one from Voices.</div>
          )}
        </Section>

        <Section title="API usage & spending">
          <ApiUsage />
        </Section>

        <Section title="API key · Linux client">
          <div className="flex items-center gap-2.5 rounded-panel border border-line bg-bg2 py-2.5 pl-4 pr-2.5">
            <code className="flex-1 truncate font-mono text-[13px] text-fg2" aria-label="API key, masked">
              {masked}
            </code>
            <Button leading={copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />} onClick={copyKey} className="bg-bg" aria-live="polite">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {/* Phones have no Linux client tab; the rail links it on wider screens. */}
          <Link to="/linux" className="flex items-center justify-between gap-4 rounded-panel border border-line bg-bg2 px-4 py-3.5 text-fg no-underline hover:bg-bg3 sm:hidden">
            <span>Set up the Linux client</span>
            <ChevronRight size={16} strokeWidth={1.5} className="text-fg2" aria-hidden />
          </Link>
        </Section>

        <Section title="Keyboard shortcuts">
          <ShortcutsGrid />
        </Section>

        {/* The server serves the docs (vite.docs.ts); the bundled iOS app has none. */}
        {!bundled && (
          <Section title="How it works">
            <nav aria-label="How it works" className="flex flex-col rounded-panel border border-line bg-bg2">
              {DOC_LINKS.map((d, i) => (
                <a key={d.page} href={docUrl(d.page)} className={`flex items-center justify-between gap-4 px-4 py-3.5 text-fg no-underline hover:bg-bg3 ${i < DOC_LINKS.length - 1 ? "border-b border-line" : ""}`}>
                  <div>
                    <div>{d.title}</div>
                    <div className="text-[13px] text-fg2">{d.hint}</div>
                  </div>
                  <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-fg2" aria-hidden />
                </a>
              ))}
            </nav>
          </Section>
        )}
      </div>
    </section>
  );
}
