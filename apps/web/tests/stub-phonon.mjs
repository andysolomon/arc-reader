// Minimal stand-in for Gradium's Phonon server (ghcr.io/gradium-ai/ptts-openai-server),
// for tests. It needs no key, lists voice names, and serves a sine-tone WAV whose
// length follows the text.
//   node tests/stub-phonon.mjs [port]
import { createServer } from "node:http";

const PORT = Number(process.argv[2] || process.env.STUB_PORT || 3997);
const VOICES = ["Alfie", "Captain Silas Blackwater", "Harper", "Hugh", "Imogen", "Newcomer", "Zoey", "default"];

function wav(seconds, hz) {
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

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  // The web server's proxy is the only caller: browser credentials must not arrive.
  if (req.headers.origin || req.headers.cookie || req.headers.authorization) return json(res, 403, { error: { message: "Unexpected browser credentials" } });
  if (url.pathname === "/v1/audio/voices" && req.method === "GET") return json(res, 200, { aliases: {}, voices: VOICES });
  if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    let j;
    try { j = JSON.parse(body); } catch { return json(res, 400, { error: { message: "Bad JSON" } }); }
    if (!j.input) return json(res, 400, { error: { message: "input is required", param: "input" } });
    if (!VOICES.includes(j.voice)) return json(res, 400, { error: { message: `voice '${j.voice}' is not available`, param: "voice" } });
    const seconds = Math.max(0.3, String(j.input).trim().split(/\s+/).length / 2.83);
    const audio = wav(seconds, 180 + (String(j.voice).length * 23) % 200);
    res.writeHead(200, { "content-type": "audio/wav", "content-length": audio.length });
    return res.end(audio);
  }
  json(res, 404, { error: { message: "Not found" } });
}).listen(PORT, "127.0.0.1", () => console.log(`stub phonon on http://127.0.0.1:${PORT}`));
