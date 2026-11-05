import { VOICE_SERVICES, voiceServiceColor, type VoiceSource } from "@readaloud/tokens";
import { cn } from "../lib/cn";

export function VoiceSourceBadge({ source, className }: { source: VoiceSource; className?: string }) {
  const service = VOICE_SERVICES[source];
  const color = voiceServiceColor(source);
  return (
    <span
      data-voice-source={source}
      title={service.description}
      className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-[11px] font-medium text-fg", className)}
      style={{ background: `color-mix(in oklch, ${color} 14%, var(--bg2))`, borderColor: `color-mix(in oklch, ${color} 40%, var(--line))` }}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: source === "Browser" ? "var(--fg2)" : color }} />
      {service.title}
    </span>
  );
}
