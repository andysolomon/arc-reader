import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { allowed, mountAt } from "./vite.server";

describe("the API routes Cadence forwards", () => {
  it("lets the practice engine's requests through", () => {
    expect(allowed("POST", "/api/vs/transcribe")).toBe(true);
    expect(allowed("POST", "/api/phonon/v1/audio/speech")).toBe(true);
    expect(allowed("POST", "/api/decide/v1/systemone")).toBe(true);
    expect(allowed("POST", "/api/jev/v1/systemone")).toBe(true);
    expect(allowed("POST", "/api/llm/v1/chat/completions")).toBe(true);
    expect(allowed("GET", "/api/fetch?url=https%3A%2F%2Ftext.npr.org%2F1001")).toBe(true);
  });

  it("refuses the rest of ReadAloud's API", () => {
    expect(allowed("GET", "/api/library")).toBe(false);
    expect(allowed("POST", "/api/decide/config")).toBe(false);
    expect(allowed("GET", "/api/decide/v1/systemone")).toBe(false);
    expect(allowed("GET", "/api/vs/voices")).toBe(false);
    expect(allowed("POST", "/api/vs/v1/audio/speech")).toBe(false);
    expect(allowed("POST", "/api/llm/v1/responses")).toBe(false);
    // The page fetcher only reads NPR's text site.
    expect(allowed("GET", "/api/fetch?url=https%3A%2F%2Fexample.com%2F")).toBe(false);
    expect(allowed("GET", "/api/fetch?url=http%3A%2F%2F127.0.0.1%3A4173%2Fapi%2Flibrary")).toBe(false);
    expect(allowed("GET", "/api/fetch?url=https%3A%2F%2Ftext.npr.org.evil.example%2F")).toBe(false);
    expect(allowed("POST", "/api/fetch?url=https%3A%2F%2Ftext.npr.org%2F1001")).toBe(false);
  });
});

describe("the mount path", () => {
  const run = (url: string) => {
    const req = { url } as IncomingMessage;
    const res = { writeHead: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    mountAt("/cadence")(req, res as unknown as ServerResponse, next);
    return { req, res, next };
  };

  it("serves /cadence/* as the root", () => {
    const { req, next } = run("/cadence/assets/index.js?v=1");
    expect(req.url).toBe("/assets/index.js?v=1");
    expect(next).toHaveBeenCalled();
    expect(run("/cadence/").req.url).toBe("/");
  });

  it("leaves root paths alone, including ones that only start alike", () => {
    expect(run("/api/vs/transcribe").req.url).toBe("/api/vs/transcribe");
    expect(run("/cadences").req.url).toBe("/cadences");
  });

  it("adds the trailing slash that relative addresses need, keeping the query", () => {
    const { res, next } = run("/cadence?access=token");
    expect(res.writeHead).toHaveBeenCalledWith(308, { location: "/cadence/?access=token" });
    expect(next).not.toHaveBeenCalled();
  });
});
