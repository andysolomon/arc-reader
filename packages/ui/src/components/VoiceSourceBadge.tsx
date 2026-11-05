import type { ReactNode } from "react";
import { VOICE_SERVICES, voiceServiceColor, voiceServiceTextColor, type VoiceSource } from "@readaloud/tokens";
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

/**
 * A voice name coloured by the service that renders it. Lighter than a badge for dense lists;
 * the service is still named for assistive tech and in the tooltip.
 */
export function VoiceServiceName({ source, children, inherit, className }: { source: VoiceSource; children: ReactNode; /** Keep the surrounding text colour (e.g. inside a selected chip). */ inherit?: boolean; className?: string }) {
  const service = VOICE_SERVICES[source];
  return (
    <span data-voice-source={source} title={`${service.title} · ${service.description}`} className={cn("font-medium", className)} style={inherit ? undefined : { color: voiceServiceTextColor(source) }}>
      {children}
      <span className="sr-only"> {service.title}</span>
    </span>
  );
}
