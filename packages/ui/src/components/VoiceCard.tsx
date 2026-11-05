import { MorphIcon } from "morphicons/react";
import { Play, AudioLines } from "lucide";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";
import type { Voice } from "../lib/types";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { VoiceAvatar } from "./VoiceAvatar";
import { Waveform } from "./Waveform";
import { Button } from "./Button";

export interface VoiceCardProps {
  voice: Voice;
  selected?: boolean;
  previewing?: boolean;
  onPreview: () => void;
  onSelect: () => void;
  className?: string;
}

export function VoiceCard({ voice, selected, previewing, onPreview, onSelect, className }: VoiceCardProps) {
  return (
    <Card interactive selected={selected} className={cn("flex min-h-[200px] flex-col gap-3.5", className)} data-voice={voice.id}>
      <div className="flex items-center justify-between">
        <VoiceAvatar voice={voice} size={40} />
        {selected ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
            <Check size={16} strokeWidth={1.5} aria-hidden />
            Selected
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="text-[16px] font-semibold">{voice.name}</div>
        <div className="font-mono text-[12px] text-fg2">{voice.lang}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {voice.tags.map((t) => (
          <Chip key={t} tag>
            {t}
          </Chip>
        ))}
      </div>
      <div className="mt-auto flex gap-2">
        <button
          type="button"
          onClick={onPreview}
          aria-label={previewing ? `Playing preview of ${voice.name}` : `Preview ${voice.name}`}
          aria-pressed={!!previewing}
          className="inline-flex h-9 flex-1 items-center gap-2 rounded-control border border-line bg-bg px-3 text-[13px] text-fg hover:bg-bg3"
        >
          <MorphIcon icon={previewing ? AudioLines : Play} size={16} strokeWidth={1.5} reducedMotion="user" style={{ display: "block" }} />
          <Waveform active={!!previewing} />
          {previewing ? "Playing…" : "Preview"}
        </button>
        <Button
          variant={selected ? "secondary" : "primary"}
          size="sm"
          onClick={onSelect}
          aria-pressed={selected}
          className={cn("h-9 px-3.5 font-semibold", selected && "cursor-default border-0 bg-bg3 text-fg")}
        >
          {selected ? "Selected" : "Use"}
        </Button>
      </div>
    </Card>
  );
}
