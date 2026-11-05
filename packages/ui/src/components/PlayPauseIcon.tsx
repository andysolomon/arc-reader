import { MorphIcon } from "morphicons/react";
import { PlayFilled, PauseFilled } from "./icons";

export interface PlayPauseIconProps {
  playing: boolean;
  size?: number;
  className?: string;
}

/** Morphs between a filled play triangle and pause bars. Honors prefers-reduced-motion. */
export function PlayPauseIcon({ playing, size = 24, className }: PlayPauseIconProps) {
  return (
    <MorphIcon
      icon={playing ? PauseFilled : PlayFilled}
      size={size}
      spring="snappy"
      reducedMotion="user"
      className={className}
      style={{ display: "block" }}
    />
  );
}
