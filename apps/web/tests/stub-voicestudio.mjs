// Minimal stand-in for VoiceStudio's OpenAI-compatible audio API, for tests and
// for developing without the real server. Serves a sine-tone WAV whose length
// follows the sentence length, requires the bearer key, and lists two profiles.
//   node tests/stub-voicestudio.mjs [port] [key]
import { createServer } from "node:http";

const PORT = Number(process.argv[2] || process.env.STUB_PORT || 3999);
const KEY = process.argv[3] || process.env.STUB_KEY || "test-key";
const ENGINES = [
  { id: "kittentts", name: "KittenTTS", available: true, supports_cloning: false },
  { id: "supertonic3", name: "Supertonic-3", available: false, supports_cloning: false },
  { id: "omnivoice", name: "OmniVoice", available: true, supports_cloning: true },
  { id: "omnivoice-subprocess", available: true, supports_cloning: true },
  { id: "cosyvoice", name: "CosyVoice 3", available: false, supports_cloning: true },
];
const PROFILES = [
  { id: "prof-narrator-1", name: "Studio Narrator", type: "profile", language: "en-GB" },
  { id: "prof-mara", name: "Mara (cloned)", type: "profile", language: "de-DE" },
];

function wav(seconds, hz = 220) {
  const rate = 16000, n = Math.max(1, Math.round(rate * seconds));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 6000), 44 + i * 2);
  return buf;
}

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
let requests = 0;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return json(res, 200, { status: "ok", device: "cpu", version: "stub" });
  if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: "Missing or invalid API key", type: "authentication_error" } });
  if (req.headers.origin) return json(res, 403, { error: { message: "Cross-site browser request refused" } });
  if (url.pathname === "/engines/select") return json(res, 200, { family: "tts", active: "kittentts" });
  if (url.pathname === "/engines") return json(res, 200, { tts: { active: "omnivoice", backends: [{ id: "omnivoice", supports_cloning: true }] } });
  if (url.pathname === "/profiles") return json(res, 200, PROFILES.map(p => ({ ...p, kind: "clone" })));
  if (url.pathname === "/v1/models") return json(res, 200, { object: "list", data: ENGINES.filter((e) => e.available).map((e) => ({ id: e.id, object: "model", owned_by: "voicestudio" })) });
  if (url.pathname === "/v1/audio/voices") return json(res, 200, { voices: PROFILES.map((p) => ({ ...p, voice_id: p.id })), engines: ENGINES });
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    const j = JSON.parse(body);
    const content = /Summarize/.test(j.messages?.[0]?.content ?? "") ? "A stub summary of the main point.\n\nOne key idea from the article." : "Stub reply.";
    return json(res, 200, { model: j.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] });
  }
  if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    let j;
    try { j = JSON.parse(body); } catch { return json(res, 400, { error: { message: "Bad JSON" } }); }
    if (!j.input) return json(res, 422, { error: { message: "input is required", param: "input" } });
    if (j.model && !/^(tts-1|tts-1-hd|gpt-.*-tts)$/.test(j.model) && !ENGINES.some((e) => e.id === j.model && e.available)) return json(res, 400, { error: { message: `Engine '${j.model}' is not available`, param: "model", code: "model_not_available" } });
    requests++;
    const words = String(j.input).trim().split(/\s+/).length;
    const seconds = Math.max(0.3, words / 2.83 / (j.speed || 1));
    const hz = 180 + (String(j.voice).length * 23) % 200;
    const audio = wav(seconds, hz);
    if (j.stream_format === "sse") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "speech.audio.delta", audio: audio.toString("base64") })}\n\n`);
      // Fixed usage values make accounting assertions independent of tokenizers.
      return res.end(`data: ${JSON.stringify({ type: "speech.audio.done", usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } })}\n\n`);
    }
    res.writeHead(200, { "content-type": "audio/wav", "content-length": audio.length, "x-stub-requests": String(requests) });
    return res.end(audio);
  }
  if (url.pathname === "/v1/audio/transcriptions" && req.method === "POST") {
    // Evenly spaced word timings for whatever text the client says the clip contains (x-stub-text header).
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = decodeURIComponent(req.headers["x-stub-text"] || "") || "stub transcript";
    const words = text.split(/\s+/).filter(Boolean);
    const total = Buffer.concat(chunks).length / 32000; // 16 kHz 16-bit mono
    const per = total / Math.max(1, words.length);
    return json(res, 200, { text, language: "en", duration: total, words: words.map((w, i) => ({ word: w, start: +(i * per).toFixed(3), end: +((i + 1) * per).toFixed(3) })), segments: [] });
  }
  json(res, 404, { error: { message: "Not found" } });
}).listen(PORT, "127.0.0.1", () => console.log(`stub voicestudio on http://127.0.0.1:${PORT} (key: ${KEY})`));
