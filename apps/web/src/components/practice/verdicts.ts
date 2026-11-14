import type { Verdict } from "../../lib/practice/judge";

type Marked = Exclude<Verdict, "correct">;

/** Each mark differs in shape as well as colour, so it reads without colour too. */
export const MARK: Record<Marked, { className: string; tint: string; label: string; key: string; line: string; labelClass: string }> = {
  mispronounced: {
    className: "rounded-[4px] bg-hl px-[3px] -mx-[3px] text-accent",
    tint: "var(--accent)", label: "Mispronounced", key: "Mispronounced", labelClass: "text-accent",
    line: "This word didn't sound right. Listen to it, then try just this word.",
  },
  substituted: {
    className: "text-verdict-swap underline decoration-2 underline-offset-[5px]",
    tint: "var(--verdict-swap)", label: "Different word", key: "Different word", labelClass: "text-verdict-swap",
    line: "You read a different word here. Listen to it, then try just this word.",
  },
  skipped: {
    className: "text-fg2 line-through",
    tint: "var(--fg2)", label: "Skipped", key: "Skipped", labelClass: "text-fg2",
    line: "You skipped this word. Listen to it, then try just this word.",
  },
  unsure: {
    className: "underline decoration-dotted decoration-2 decoration-fg2 underline-offset-[5px]",
    tint: "var(--fg2)", label: "Unclear", key: "Unclear, not counted", labelClass: "text-fg2",
    line: "The recording wasn't clear here, so this word isn't counted. Try just this word.",
  },
};

export const isMarked = (v: Verdict): v is Marked => v !== "correct";
/** The tapped word's background while its popover is open: its verdict colour at 20%. */
export const openTint = (v: Marked) => `color-mix(in srgb, ${MARK[v].tint} 20%, transparent)`;
