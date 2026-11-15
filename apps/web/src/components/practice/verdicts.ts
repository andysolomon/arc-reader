import { MARK_TEXT, type Marked } from "@readaloud/practice/marks";

export { isMarked, markLine } from "@readaloud/practice/marks";

/** Each mark differs in shape as well as colour, so it reads without colour too. */
export const MARK: Record<Marked, { className: string; tint: string; label: string; key: string; line: string; labelClass: string }> = {
  mispronounced: { ...MARK_TEXT.mispronounced, className: "rounded-[4px] bg-hl px-[3px] -mx-[3px] text-accent", tint: "var(--accent)", labelClass: "text-accent" },
  substituted: { ...MARK_TEXT.substituted, className: "text-verdict-swap underline decoration-2 underline-offset-[5px]", tint: "var(--verdict-swap)", labelClass: "text-verdict-swap" },
  skipped: { ...MARK_TEXT.skipped, className: "text-fg2 line-through", tint: "var(--fg2)", labelClass: "text-fg2" },
  unsure: { ...MARK_TEXT.unsure, className: "underline decoration-dotted decoration-2 decoration-fg2 underline-offset-[5px]", tint: "var(--fg2)", labelClass: "text-fg2" },
};

/** The tapped word's background while its popover is open: its verdict colour at 20%. */
export const openTint = (v: Marked) => `color-mix(in srgb, ${MARK[v].tint} 20%, transparent)`;
