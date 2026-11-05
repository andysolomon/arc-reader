import type { TokenUsage } from "../lib/usage";
import { ApiRejected } from "./types";

/** The player already waits for a complete sentence. SSE lets us keep the
 * provider's usage alongside that sentence's MP3 instead of discarding it. */
export async function readSpeechStream(response: Response): Promise<{ audio: Blob; tokens?: TokenUsage }> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let tokens: TokenUsage | undefined;
  let completed = false;
  const body = await response.text();
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    let event;
    try { event = JSON.parse(data); } catch { throw new ApiRejected(502, "Invalid speech stream"); }
    if (!event || typeof event !== "object") throw new ApiRejected(502, "Invalid speech stream");
    if (event.type === "error" || event.error) throw new ApiRejected(502, "Speech generation failed");
    if (event.type === "speech.audio.delta") {
      if (completed || typeof event.audio !== "string") throw new ApiRejected(502, "Invalid speech stream");
      try {
        const binary = atob(event.audio);
        parts.push(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
      } catch { throw new ApiRejected(502, "Invalid speech audio"); }
    } else if (event.type === "speech.audio.done") {
      completed = true;
      const usage = event.usage;
      if (usage && [usage.input_tokens, usage.output_tokens].every((n) => Number.isSafeInteger(n) && n >= 0)) {
        tokens = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
      }
    }
  }
  const audio = new Blob(parts, { type: "audio/mpeg" });
  if (!completed || !audio.size) throw new ApiRejected(502, "Incomplete speech stream");
  return { audio, tokens };
}
