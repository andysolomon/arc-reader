import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Copy, Check } from "lucide-react";
import { THEMES } from "@readaloud/tokens";
import { Chip, SectionLabel, Segmented, Switch, ThemeSwatch, UsageMeter, VoiceAvatar, Button } from "@readaloud/ui";
import { getVoice, useVoices } from "../state/voices";
import { useSettings, useThemeId } from "../state/settings";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { getUsage, getUsageByEngine, PLAN_LIMIT, OPENAI_PRICE_PER_M } from "../lib/usage";
import { ShortcutsGrid } from "../components/ShortcutsDialog";
import { hasApi, hasOpenAI, hasFish, OPENAI_MODEL, FISH_MODEL } from "../engine/providers";

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
  const engines = allEngines.filter((e) => e.available || e.id === s.engine);
  const notInstalled = allEngines.length - engines.length;
  const [copied, setCopied] = useState(false);
  const [usage, setUsage] = useState(getUsage());
  const [byEngine, setByEngine] = useState(getUsageByEngine());
  useEffect(() => {
    const on = () => {
      setUsage(getUsage());
      setByEngine(getUsageByEngine());
    };
    window.addEventListener("readaloud:usage", on);
    return () => window.removeEventListener("readaloud:usage", on);
  }, []);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(s.apiKey);
      setCopied(true);
      toast("API key copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Couldn't access the clipboard");
    }
  };
  const masked = `${s.apiKey.slice(0, 8)}${"•".repeat(20)}${s.apiKey.slice(-4)}`;

  return (
    <section data-screen="settings" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: hasDoc ? 160 : 64 }}>
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
            <RowItem label="Word timings from the server" hint="Asks the speech server to time each word after a sentence is synthesized. One extra request per sentence; off keeps the estimate." last>
              <Switch checked={s.wordTimings} onChange={(v) => s.set("wordTimings", v)} label="Word timings from the server" disabled={!hasApi()} />
            </RowItem>
          </div>
        </Section>

        <Section title="Engine">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="TTS engine">
            {engines.map((e) => (
              <Chip key={e.id} size="sm" selected={s.engine === e.id} disabled={!e.available} onClick={() => s.set("engine", e.id)} title={e.available ? undefined : "Not installed on the speech server"}>
                {e.label}
              </Chip>
            ))}
          </div>
          <div className="text-[13px] text-fg2">
            {hasApi()
              ? `Installed engines reported by the speech server${notInstalled > 0 ? `; ${notInstalled} more can be installed from VoiceStudio's Model Catalogue` : ""}. Preset voices name their own engine; cloned voices use this one.`
              : "No local speech server configured. Cloud voices use their own engine; choose one from Voices."}
          </div>
        </Section>

        <Section title="Usage">
          <UsageMeter
            used={usage}
            limit={PLAN_LIMIT}
            footer={
              <>
                <span>
                  {usage === 0 ? "No cloud characters used yet this month" : "Counted when a cloud voice synthesizes text"}
                  {hasOpenAI() && (byEngine.openai ?? 0) > 0 && (
                    <>
                      {" · OpenAI "}
                      {(byEngine.openai ?? 0).toLocaleString()} chars ≈ ${(((byEngine.openai ?? 0) / 1_000_000) * (OPENAI_PRICE_PER_M[OPENAI_MODEL] ?? 15)).toFixed(2)} ({OPENAI_MODEL}, text only)
                    </>
                  )}
                  {hasFish() && (byEngine.fish ?? 0) > 0 && (
                    <> · Fish Audio {(byEngine.fish ?? 0).toLocaleString()} chars ({FISH_MODEL})</>
                  )}
                </span>
                <button type="button" onClick={() => toast("Billing opens on the web account page")} className="border-0 bg-transparent p-0 text-accent hover:text-fg">
                  Manage billing
                </button>
              </>
            }
          />
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
        </Section>

        <Section title="Keyboard shortcuts">
          <ShortcutsGrid />
        </Section>
      </div>
    </section>
  );
}
