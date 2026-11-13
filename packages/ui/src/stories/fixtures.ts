import type { Voice, ParagraphLike } from "../lib/types";

export const VOICES: Voice[] = [
  { id: "ava", name: "Ava", lang: "EN-US", tags: ["warm", "narrator"], hue: 30, engine: "kittentts" },
  { id: "noah", name: "Noah", lang: "EN-GB", tags: ["crisp", "documentary"], hue: 215, engine: "phonon" },
  { id: "piper", name: "Piper", lang: "EN-US · local", tags: ["offline", "neutral"], hue: null, engine: "local" },
];

const P1 =
  "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach. I did not wish to live what was not life, living is so dear. Simplicity, simplicity, simplicity!";
const P2 = "Why should we live with such hurry and waste of life? We are determined to be starved before we are hungry.";

function toParas(texts: string[]): ParagraphLike[] {
  let start = 0;
  return texts.map((t) => {
    const sentences = t.split(/(?<=[.!?…])\s+/).map((s) => ({ text: s, words: s.split(/\s+/) }));
    const p = { sentences, start };
    start += sentences.length;
    return p;
  });
}
export const PARAGRAPHS = toParas([P1, P2]);
