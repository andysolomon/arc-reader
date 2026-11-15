import { configurePractice } from "@readaloud/practice/host";
import { synthesize } from "../engine/providers";
import { ApiBusy, ApiRejected, ApiUnreachable, LOCAL_ENGINE } from "../engine/types";
import { getVoice, isLocalVoice, voiceLang } from "../state/voices";
import { useSettings } from "../state/settings";
import { planPassages, splitSentences, splitWords } from "./segment";
import { withSpeechAuth } from "./speechServer";
import { studioUrl } from "./studio";

/**
 * Reading Practice inside ReadAloud: the practice engine speaks in the reader's chosen voice, the
 * way the Voices preview makes it, and reaches the speech server Settings points at.
 */
configurePractice({
  speechRequest: (path, init) => {
    const url = studioUrl(path);
    return { url, init: withSpeechAuth(url, init) };
  },
  synthesize: (text, signal) => {
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
  },
  // A clip of up to about 60 words at a time, as the reader does.
  speechPieces: (text) => planPassages(splitSentences(text).map((s) => ({ text: s, words: splitWords(s), para: 0 }))).map((p) => p.text),
});
