import { describe, expect, it } from "vitest";
import { readSpeechStream } from "./speechStream";

const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const audio = event({ type: "speech.audio.delta", audio: "AQID" });
const done = event({ type: "speech.audio.done", usage: { input_tokens: 10, output_tokens: 25, total_tokens: 35 } });

describe("OpenAI speech events", () => {
  it("reassembles binary audio from independently encoded deltas and retains reported tokens", async () => {
    const result = await readSpeechStream(new Response(`: keepalive\r\n\r\n${audio}${event({ type: "speech.audio.delta", audio: "BAU=" })}${done}`));
    expect(Array.from(new Uint8Array(await result.audio.arrayBuffer()))).toEqual([1, 2, 3, 4, 5]);
    expect(result.audio.type).toBe("audio/mpeg");
    expect(result.tokens).toEqual({ inputTokens: 10, outputTokens: 25 });
  });

  it("accepts events split across arbitrary network chunks and a final event without a separator", async () => {
    const bytes = new TextEncoder().encode(audio + done.trimEnd());
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
    expect((await readSpeechStream(new Response(stream))).tokens?.inputTokens).toBe(10);
  });

  it.each([
    audio,
    done,
    `${audio}data: {bad json}\n\n`,
    `${audio}${event({ type: "error", error: { message: "failed" } })}`,
    `${event({ type: "speech.audio.delta", audio: "!notbase64" })}${done}`,
  ])("rejects incomplete or invalid streams", async (body) => {
    await expect(readSpeechStream(new Response(body))).rejects.toThrow();
  });

  it.each([undefined, { input_tokens: -1, output_tokens: 2 }, { input_tokens: "10", output_tokens: 2 }])("keeps missing/invalid token counts unavailable", async (usage) => {
    const result = await readSpeechStream(new Response(audio + event({ type: "speech.audio.done", usage })));
    expect(result.tokens).toBeUndefined();
    expect(result.audio.size).toBe(3);
  });
});
