import { synthesize } from "../../engine/providers";
import { ApiBusy, ApiRejected, ApiUnreachable, LOCAL_ENGINE } from "../../engine/types";
import { getVoice, isLocalVoice, voiceLang } from "../../state/voices";
import { useSettings } from "../../state/settings";

let playing: HTMLAudioElement | null = null;

/** Say one word in the reader's chosen voice, the way the Voices preview does. Rejects with a message to show. */
export async function speakWord(word: string, signal?: AbortSignal): Promise<void> {
  playing?.pause();
  const settings = useSettings.getState();
  const v = getVoice(settings.voice);
  const chunk = await synthesize({
    text: word,
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
    throw new Error(`Couldn't say "${word}".`);
  });
  if (signal?.aborted) return;
  if (chunk.audio) {
    const url = URL.createObjectURL(chunk.audio);
    const audio = new Audio(url);
    playing = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } else if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = voiceLang(v);
    window.speechSynthesis.speak(u);
  }
}
