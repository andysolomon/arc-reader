export const radii = { control: 8, panel: 12, card: 16, pill: 999 } as const;
export const spacing = 4;
export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
export const shadows = { overlay: "0 16px 40px -16px rgba(0,0,0,.55)" } as const;
export const typography = {
  serif: 'Literata, Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: "ui-monospace, Menlo, Consolas, monospace",
  chromeSize: 14,
  readingSize: 19,
  readingSizeMin: 16,
  readingSizeMax: 26,
  readingLeading: 1.65,
  measure: 62,
  measureWide: 72,
} as const;
export const breakpoints = { sm: 640, lg: 1024 } as const;

/** Voice avatar fill: oklch(0.7 0.11 hue). Local/Piper uses --bg3. */
export function voiceColor(hue: number | null): string {
  return hue === null ? "var(--bg3)" : `oklch(0.7 0.11 ${hue})`;
}
