import { MorphIcon } from "morphicons/react";
import { Sun, Moon } from "lucide";

export interface ThemeIconProps {
  scheme: "dark" | "light";
  size?: number;
}

/** Sun ↔ moon morph for the theme cycler. */
export function ThemeIcon({ scheme, size = 20 }: ThemeIconProps) {
  return <MorphIcon icon={scheme === "light" ? Sun : Moon} size={size} strokeWidth={1.5} reducedMotion="user" style={{ display: "block" }} />;
}
