import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { FISH_MODEL, OPENAI_MODEL, hasApi, hasFish, hasOpenAI } from "../engine/providers";
import { monthKey } from "../lib/dates";
import { formatUsd, getUsageSnapshot, summarizeUsage, USAGE_EVENT, USAGE_KEY, type UsageProvider, type UsageRow } from "../lib/usage";

const providers: { id: UsageProvider; name: string; configured: () => boolean; model?: string; href?: string; link?: string }[] = [
  { id: "openai", name: "OpenAI", configured: hasOpenAI, model: OPENAI_MODEL, href: "https://platform.openai.com/usage", link: "OpenAI usage dashboard" },
  { id: "fish", name: "Fish Audio", configured: hasFish, model: FISH_MODEL, href: "https://fish.audio/", link: "Fish Audio account" },
  { id: "voicestudio", name: "VoiceStudio", configured: hasApi },
  { id: "unknown", name: "Earlier usage", configured: () => false },
];
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const count = (n: number) => n.toLocaleString();

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="min-w-0 rounded-card border border-line bg-bg2 p-4">
    <div className="text-[12px] text-fg2">{label}</div>
    <div className="mt-1 break-words font-mono text-[24px] tracking-tight tabular-nums">{value}</div>
    <div className="mt-1 text-[12px] text-fg2">{hint}</div>
  </div>;
}

function DailySpend({ month, rows }: { month: string; rows: UsageRow[] }) {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(year, m, 0).getDate();
  const values = Array.from({ length: days }, (_, i) => rows.filter((r) => r.day === `${month}-${String(i + 1).padStart(2, "0")}`).reduce((sum, r) => sum + (r.costUsd ?? 0), 0));
  const max = Math.max(...values, 0.000001);
  return <div className="rounded-card border border-line bg-bg2 p-4">
    <div className="flex flex-wrap justify-between gap-2 text-[12px] text-fg2"><span>Daily estimated spend</span><span>Peak {formatUsd(Math.max(...values))} · USD</span></div>
    <svg viewBox={`0 0 ${days * 12} 72`} className="mt-3 h-[72px] w-full" preserveAspectRatio="none" role="img" aria-label={`Daily estimated spend for ${monthLabel(month)}. ${values.map((v, i) => `${i + 1}: ${formatUsd(v)}`).join("; ")}`}>
      {values.map((value, i) => <rect key={i} x={i * 12 + 1} y={70 - Math.max(2, value / max * 66)} width={9} height={Math.max(2, value / max * 66)} rx={2} fill={value > 0 ? "var(--accent)" : "var(--line)"}>
        <title>{`${month}-${String(i + 1).padStart(2, "0")}: ${formatUsd(value)}`}</title>
      </rect>)}
    </svg>
    <div className="mt-1 flex justify-between text-[11px] text-fg2"><span>1</span><span>{days}</span></div>
  </div>;
}

export function ApiUsage() {
  const [snapshot, setSnapshot] = useState(getUsageSnapshot);
  const [currentMonth, setCurrentMonth] = useState(monthKey);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => { setSnapshot(getUsageSnapshot()); setCurrentMonth(monthKey()); };
    const onStorage = (event: StorageEvent) => { if (event.key === USAGE_KEY || event.key === null) refresh(); };
    window.addEventListener(USAGE_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener(USAGE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);
  const month = selectedMonth ?? currentMonth;
  const months = Array.from(new Set([currentMonth, month, ...snapshot.rows.map((r) => r.day.slice(0, 7))])).sort().reverse();
  const rows = snapshot.rows.filter((r) => r.day.startsWith(month));
  const total = summarizeUsage(rows);
  const spend = !rows.length || total.priced ? formatUsd(total.costUsd) : "Unavailable";

  return <div className="flex flex-col gap-3.5" role="region" aria-label="API usage and spending">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-[13px] text-fg2">Speech generated in this browser, grouped by provider.</p>
      <select aria-label="Usage month" value={month} onChange={(event) => setSelectedMonth(event.target.value === currentMonth ? null : event.target.value)} className="max-w-full rounded-lg border border-line bg-bg2 px-3 py-2 text-[13px] text-fg">
        {months.map((value) => <option key={value} value={value}>{monthLabel(value)}{value === currentMonth ? " · This month" : ""}</option>)}
      </select>
    </div>
    {snapshot.storageError && <p role="status" className="m-0 rounded-lg border border-line p-3 text-[13px] text-fg2">Usage could not be fully saved or read. Totals may be incomplete; audio playback is unaffected.</p>}
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      <Metric label={total.unpriced ? "Estimated spend · partial" : "Estimated spend"} value={spend} hint="USD · list prices, before credits and tax" />
      <Metric label="Reported tokens" value={total.tokenRequests ? count(total.inputTokens + total.outputTokens) : "—"} hint={total.tokenRequests ? `${count(total.inputTokens)} input · ${count(total.outputTokens)} audio output` : "Available when returned by the provider"} />
      <Metric label="Speech requests" value={count(total.requests)} hint={`${count(total.characters)} characters${total.legacy ? " · includes earlier counts" : " generated"}`} />
    </div>
    {!rows.length && <p className="m-0 rounded-card border border-dashed border-line p-4 text-[13px] text-fg2">No speech usage recorded for this month. Generate speech with an API voice to start tracking. Cached playback and browser voices add no API usage.</p>}
    {total.priced && total.costUsd > 0 && <DailySpend month={month} rows={rows} />}
    <div className="overflow-hidden rounded-panel border border-line bg-bg2">
      {providers.filter((p) => p.id !== "unknown" || rows.some((r) => r.provider === "unknown")).map((provider, index) => {
        const records = rows.filter((r) => r.provider === provider.id);
        const summary = summarizeUsage(records);
        const models = [...new Set(records.map((r) => r.model))];
        const configured = provider.configured();
        return <div key={provider.id} data-provider-usage={provider.id} className={`p-4 ${index ? "border-t border-line" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{provider.name}</span><span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg2">{configured ? "Configured" : records.length ? "Historical usage" : "Not configured"}</span></div>
              <div className="mt-1 break-all text-[12px] text-fg2">{models.length ? models.join(" · ") : provider.model ?? "Speech server"}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[16px] tabular-nums">{records.length ? summary.priced ? `≈ ${formatUsd(summary.costUsd)}` : "Not available" : "$0.00"}</div>
              <div className="text-[11px] text-fg2">{records.length ? summary.unpriced ? "Some costs unavailable" : "Estimated spend" : "No recorded usage"}</div>
            </div>
          </div>
          {records.length > 0 && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg2">
            <span>{count(summary.requests)} requests</span><span>{count(summary.characters)} characters</span>
            {provider.id === "fish" && <span>{count(records.reduce((n, r) => n + r.bytes, 0))} UTF-8 bytes{summary.legacy ? " since tracking began" : ""}</span>}
            {summary.tokenRequests > 0 && <span>{count(summary.inputTokens)} input / {count(summary.outputTokens)} output tokens</span>}
          </div>}
          {records.length > 0 && <ul className="mb-0 mt-2 list-none p-0 text-[12px] text-fg2">
            {[...new Set(records.map((r) => `${r.model}: ${r.pricing}`))].map((line) => <li key={line} className="break-words">{line}</li>)}
          </ul>}
          {provider.href && <a href={provider.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-accent hover:underline">{provider.link}<ExternalLink size={12} aria-hidden /></a>}
        </div>;
      })}
    </div>
    <details className="text-[13px] text-fg2">
      <summary className="cursor-pointer text-fg">How usage is counted</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="m-0">Completed speech requests include prefetched sentences, even if you do not listen to them. Replaying cached audio and using the browser voice add no API charges. Failed or interrupted responses may still be billed by the provider and are not included here.</p>
        <p className="m-0">OpenAI token totals use reported input and audio output tokens. Fish Audio bills by UTF-8 bytes; TTS-1 models bill by characters. Missing tokens and unknown prices stay unavailable. Earlier character counts are preserved, but their costs cannot be reconstructed.</p>
        <p className="m-0">History stays in this browser and is removed if you clear site data. It combines keys used with each provider. Other devices, other apps, and Studio operations such as dubbing or transcription are not included. VoiceStudio server and hosting costs are not reported.</p>
        <p className="m-0">Estimates use list prices checked November 5, 2026, and retain the rate used at generation time. Account dashboards show your actual charges, credits, and discounts.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <a className="text-accent hover:underline" href="https://developers.openai.com/api/docs/models/gpt-4o-mini-tts" target="_blank" rel="noreferrer">OpenAI pricing</a>
          <a className="text-accent hover:underline" href="https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits" target="_blank" rel="noreferrer">Fish Audio pricing</a>
        </div>
      </div>
    </details>
  </div>;
}
