import { voicePortrait } from "@readaloud/ui";
import type { Voice } from "../data/voices";
import { languageLabel, voiceLanguage } from "./filters";

/**
 * What sets a voice apart, in a few words: its tags, the kind of character it plays, a custom
 * voice's direction, and its language when that is not English. Empty when nothing is known.
 */
export function voiceTraits(voice: Voice): string {
  const parts = [...voice.tags];
  // "character" alone says the same of every character voice; the portrait knows which kind.
  const character = voice.tags.includes("character") ? voicePortrait(voice).character : "human";
  if (character !== "human") parts.push(character);
  if (voice.description?.trim()) parts.push(voice.description.trim());
  const language = voiceLanguage(voice);
  if (language && !/^(EN|MULTI|AUTO)\b/i.test(language)) parts.push(languageLabel(language));
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
