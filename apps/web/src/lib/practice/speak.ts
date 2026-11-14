import { synthesize } from "../../engine/providers";
import { ApiBusy, ApiRejected, ApiUnreachable, LOCAL_ENGINE } from "../../engine/types";
import { getVoice, isLocalVoice, voiceLang } from "../../state/voices";
import { useSettings } from "../../state/settings";
import { planPassages, splitSentences, splitWords } from "../segment";
import { displayText } from "./words";

/** Whatever Practice is playing: a word, the passage, or the reader's own take. One at a time. */
let current: { stop: () => void } | null = null;

/** Stop whatever Practice is playing. */
export function stopPlayback() {
  current?.stop();
  current = null;
}

/**
 * Play a clip. Resolves true at its end, or false, quietly, when `signal` aborts or something else
 * starts playing.
 */
export function playClip(clip: Blob, signal?: AbortSignal): Promise<boolean> {
  stopPlayback();
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve, reject) => {
    const url = URL.createObjectURL(clip);
    const audio = new Audio(url);
    const finish = (error?: Error, ended = false) => {
      audio.onended = audio.onerror = null;
      signal?.removeEventListener("abort", stop);
      URL.revokeObjectURL(url);
      if (current === entry) current = null;
      if (error) reject(error); else resolve(ended);
    };
    const stop = () => { audio.pause(); finish(); };
    const entry = { stop };
    current = entry;
    signal?.addEventListener("abort", stop, { once: true });
    audio.onended = () => finish(undefined, true);
    audio.onerror = () => finish(new Error("This device couldn't play the audio."));
    audio.play().catch((e: unknown) => finish(e instanceof Error ? e : new Error("This device couldn't play the audio.")));
  });
}

/** Say `text` with the browser's own voice, for the on-device voice. */
function speakLocally(text: string, lang: string, signal?: AbortSignal): Promise<boolean> {
  stopPlayback();
  if (!("speechSynthesis" in window) || signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const finish = (ended: boolean) => { signal?.removeEventListener("abort", stop); if (current === entry) current = null; resolve(ended); };
    const stop = () => { window.speechSynthesis.cancel(); finish(false); };
    const entry = { stop };
    current = entry;
    signal?.addEventListener("abort", stop, { once: true });
    u.onend = () => finish(true);
    u.onerror = () => finish(false);
    window.speechSynthesis.speak(u);
  });
}

/** Speech for `text` in the reader's chosen voice, the way the Voices preview makes it. */
function voiceClip(text: string, signal?: AbortSignal) {
  const settings = useSettings.getState();
  const v = getVoice(settings.voice);
  const clip = synthesize({
    text,
    voice: v.id,
    engine: v.engine,
    openaiModel: settings.openaiModel,
    profile: v.kind === "profile",
    signal,
    forceLocal: isLocalVoice(v.id) || (v.kind === "profile" && settings.engine === LOCAL_ENGINE),
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    if (error instanceof ApiUnreachable) throw new Error("The speech server is unreachable right now.");
    if (error instanceof ApiBusy) throw new Error("VoiceStudio is busy. Try again in a moment.");
    if (error instanceof ApiRejected) throw new Error(error.message);
    throw new Error("Couldn't make the speech.");
  });
  return { clip, lang: voiceLang(v) };
}

/** Say one word in the reader's chosen voice. Rejects with a message to show. */
export async function speakWord(word: string, signal?: AbortSignal): Promise<void> {
  stopPlayback();
  const { clip, lang } = voiceClip(word, signal);
  const chunk = await clip.catch((e: unknown) => {
    throw e instanceof Error && e.message === "Couldn't make the speech." ? new Error(`Couldn't say "${word}".`) : e;
  });
  if (signal?.aborted) return;
  await (chunk.audio ? playClip(chunk.audio, signal) : speakLocally(word, lang, signal));
}

/**
 * Read a passage aloud in the reader's chosen voice, a clip of up to about 60 words at a time as
 * the reader does, making the next clip while one plays. `onPlaying` fires when sound begins.
 * Resolves when the reading ends, is stopped, or gives way to something else played.
 */
export async function speakPassage(text: string, signal: AbortSignal, onPlaying?: () => void): Promise<void> {
  stopPlayback();
  const sentences = splitSentences(displayText(text)).map((s) => ({ text: s, words: splitWords(s), para: 0 }));
  const pieces = planPassages(sentences);
  // Its own controller, so clips being made ahead stop too when the reading gives way.
  const ac = new AbortController();
  const stop = () => ac.abort();
  signal.addEventListener("abort", stop, { once: true });
  try {
    let next = pieces.length ? voiceClip(pieces[0].text, ac.signal) : null;
    for (let i = 0; i < pieces.length && next; i++) {
      const { clip, lang } = next;
      const chunk = await clip;
      if (ac.signal.aborted) return;
      next = i + 1 < pieces.length ? voiceClip(pieces[i + 1].text, ac.signal) : null;
      // A clip made ahead that's never played still rejects when the reading stops; nobody waits on it then.
      next?.clip.catch(() => undefined);
      if (i === 0) onPlaying?.();
      const ended = await (chunk.audio ? playClip(chunk.audio, ac.signal) : speakLocally(pieces[i].text, lang, ac.signal));
      if (!ended) return;
    }
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally {
    signal.removeEventListener("abort", stop);
    ac.abort();
  }
}
