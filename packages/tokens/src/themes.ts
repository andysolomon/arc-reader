export type ThemeId =
  | "dark"
  | "light"
  | "tokyo-night"
  | "catppuccin"
  | "gruvbox"
  | "nord"
  | "everforest"
  | "kanagawa";

export interface ThemeColors {
  bg: string;
  bg2: string;
  bg3: string;
  line: string;
  fg: string;
  fg2: string;
  fg3: string;
  accent: string;
  accentFg: string;
  hl: string;
  danger: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  scheme: "dark" | "light";
  colors: ThemeColors;
  /** Three swatches used by the settings theme cards: bg, fg, accent */
  swatches: [string, string, string];
}

const omarchy = (
  id: ThemeId,
  name: string,
  [bg, bg2, bg3, line, fg, fg2, fg3, accent, danger]: string[],
  hlAlpha = 0.22,
): Theme => ({
  id,
  name,
  scheme: "dark",
  colors: { bg, bg2, bg3, line, fg, fg2, fg3, accent, accentFg: bg, hl: rgba(accent, hlAlpha), danger },
  swatches: [bg, fg, accent],
});

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const THEMES: Theme[] = [
  {
    id: "dark",
    name: "ReadAloud Dark",
    scheme: "dark",
    colors: {
      bg: "#161412",
      bg2: "#1d1a17",
      bg3: "#272320",
      line: "#342e29",
      fg: "#ece6dc",
      fg2: "#a39a8e",
      fg3: "#6f675d",
      accent: "#d9955a",
      accentFg: "#1c120a",
      hl: "rgba(217, 149, 90, 0.22)",
      danger: "#d9705c",
    },
    swatches: ["#161412", "#ece6dc", "#d9955a"],
  },
  {
    id: "light",
    name: "ReadAloud Light",
    scheme: "light",
    colors: {
      bg: "#f5f2ec",
      bg2: "#fcfaf6",
      bg3: "#ffffff",
      line: "#e3ddd3",
      fg: "#1f1b17",
      fg2: "#6b645b",
      fg3: "#9a9288",
      accent: "#a35b25",
      accentFg: "#ffffff",
      hl: "rgba(163, 91, 37, 0.18)",
      danger: "#b9452f",
    },
    swatches: ["#f5f2ec", "#1f1b17", "#a35b25"],
  },
  omarchy("tokyo-night", "Tokyo Night", ["#1a1b26", "#1f2335", "#24283b", "#2f3449", "#c0caf5", "#8089b3", "#565f89", "#7aa2f7", "#f7768e"]),
  omarchy("catppuccin", "Catppuccin", ["#1e1e2e", "#181825", "#313244", "#45475a", "#cdd6f4", "#a6adc8", "#6c7086", "#cba6f7", "#f38ba8"]),
  omarchy("gruvbox", "Gruvbox", ["#282828", "#1d2021", "#3c3836", "#504945", "#ebdbb2", "#a89984", "#7c6f64", "#fabd2f", "#fb4934"], 0.2),
  omarchy("nord", "Nord", ["#2e3440", "#3b4252", "#434c5e", "#4c566a", "#eceff4", "#aab2c0", "#7b8597", "#88c0d0", "#bf616a"]),
  omarchy("everforest", "Everforest", ["#2d353b", "#272e33", "#3d484d", "#475258", "#d3c6aa", "#9da9a0", "#7a8478", "#a7c080", "#e67e80"]),
  omarchy("kanagawa", "Kanagawa", ["#1f1f28", "#16161d", "#2a2a37", "#363646", "#dcd7ba", "#a09f8f", "#727169", "#7e9cd8", "#e46876"]),
];

export const THEME_IDS = THEMES.map((t) => t.id) as ThemeId[];
export const DEFAULT_THEME: ThemeId = "dark";

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && THEME_IDS.includes(v as ThemeId);
}

/** Apply a theme to the document root. */
export function applyTheme(id: ThemeId, root: HTMLElement = document.documentElement) {
  if (root.dataset.theme !== id) root.dataset.theme = id;
}

/** First-visit default: respect prefers-color-scheme. */
export function systemTheme(): ThemeId {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}
