import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import type { Connect, Plugin } from "vite";
import type { DocRecord } from "./src/lib/db";
import { LlmKeyStore } from "./vite.llm";
import { sendJson } from "./vite.json";
import type { LibraryChanges } from "./vite.library";
import { ArtDirector, CoverFiles, CoverSettings, Covers, Documents, ImageModel, coverConfig, type CoverConfig } from "./vite.covers.service";

/** What the cover service is built on. Tests swap the outside world for stand-ins here. */
export interface CoverParts {
  config: CoverConfig;
  documents: { documents(): Promise<DocRecord[]> };
  /** Reaches the image model */
  fetch?: typeof fetch;
  /** Decides what each cover shows; without one, covers are drawn from their text alone */
  director?: Layer.Layer<ArtDirector, never, CoverSettings>;
}

export function coverLayer({ config, documents, fetch: fetchImpl = fetch, director = ArtDirector.layerNone }: CoverParts) {
  return Covers.layer.pipe(
    Layer.provide(Layer.mergeAll(CoverFiles.layer, ImageModel.layerOpenAi(fetchImpl), director, Documents.layerLibrary(documents))),
    Layer.provide(Layer.succeed(CoverSettings, config)),
  );
}

/** The covers, running: one per server, so there is one queue however many phones ask. */
export const coverRuntime = (parts: CoverParts) => ManagedRuntime.make(coverLayer(parts));
export type CoverRuntime = ReturnType<typeof coverRuntime>;

const EnsureBody = Schema.Struct({ retry: Schema.optional(Schema.Boolean) });

interface Answer { status: number; body: unknown }
const answer = (status: number, body: unknown): Answer => ({ status, body });
const problem = (status: number, error: string) => answer(status, { error });

/**
 * /api/covers
 *   GET  /                    every document's article cover, for the Library
 *   GET  /docs/:id            one document's covers
 *   POST /docs/:id/ensure     queue what is missing; `{ "retry": true }` also queues what failed
 *   GET  /images/:name        the art
 */
export function coverMiddleware(runtime: CoverRuntime): Connect.NextHandleFunction {
  const route = Effect.fn("covers.route")(function*(req: IncomingMessage, path: string, body: () => Promise<unknown>) {
    const covers = yield* Covers;
    const doc = path.match(/^\/docs\/([^/]{1,600})(\/ensure)?$/);
    const docId = doc && Option.getOrUndefined(Option.liftThrowable(decodeURIComponent)(doc[1]));
    if (req.method === "GET" && path === "/") return answer(200, yield* covers.library);
    if (req.method === "GET" && doc && docId && !doc[2]) return answer(200, yield* covers.document(docId));
    if (req.method === "POST" && doc && docId && doc[2]) {
      // Covers cost money to make: only this app's own pages may ask for them.
      if (req.headers.origin && Option.getOrUndefined(Option.liftThrowable((origin: string) => new URL(origin).host)(req.headers.origin)) !== req.headers.host) return problem(403, "Cross-origin writes are not allowed.");
      if (!req.headers["content-type"]?.startsWith("application/json")) return problem(415, "JSON required.");
      const raw = yield* Effect.tryPromise(body).pipe(Effect.option);
      const asked = Option.flatMap(raw, Schema.decodeUnknownOption(EnsureBody));
      if (Option.isNone(asked)) return problem(400, "Invalid request.");
      return answer(202, yield* covers.ensure(docId, asked.value.retry === true));
    }
    return problem(404, "Not found.");
  }, Effect.catchTags({
    DocumentMissing: () => Effect.succeed(problem(404, "This document has no covers yet.")),
    CoversUnavailable: (error) => Effect.succeed(problem(503, error.message)),
    CoverStorageError: () => Effect.succeed(problem(500, "Cover service could not complete the request.")),
  }));

  return (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url || "/").split("?")[0];
    void (async () => {
      if (req.method === "GET" && path.startsWith("/images/")) {
        const bytes = await runtime.runPromise(Covers.use((covers) => covers.image(path.slice(8))));
        if (Option.isNone(bytes)) return sendJson(req, res, 404, { error: "Cover not found." });
        // A name is never reused for different art, so a phone may keep it for good.
        res.writeHead(200, { "content-type": path.endsWith(".webp") ? "image/webp" : "image/png", "content-length": String(bytes.value.length), "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
        res.end(bytes.value);
        return;
      }
      const body = async () => {
        let text = "";
        for await (const chunk of req) { text += chunk.toString(); if (text.length > 4096) throw new Error("too large"); }
        return JSON.parse(text || "{}") as unknown;
      };
      const { status, body: payload } = await runtime.runPromise(route(req, path, body));
      // The Library asks every few seconds while covers are being drawn: an unchanged answer costs nothing.
      sendJson(req, res, status, payload, { etag: req.method === "GET" });
    })().catch((error) => {
      console.error("Cover service failed:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) sendJson(req, res, 500, { error: "Cover service could not complete the request." });
    });
  };
}

/** Covers follow the library: a new document gets them, a changed one is rechecked, a deleted one lets go. */
export function followLibrary(runtime: CoverRuntime, library: { subscribe(listener: (changes: LibraryChanges) => void): () => void }) {
  return library.subscribe(({ added, changed, deleted }) => {
    void runtime.runPromise(Covers.use((covers) => Effect.gen(function*() {
      for (const doc of added) yield* covers.added(doc);
      for (const doc of changed) yield* covers.changed(doc);
      for (const docId of deleted) yield* covers.forget(docId);
    }))).catch((error) => console.error("Covers could not follow the library:", error instanceof Error ? error.message : "unknown error"));
  });
}

type Library = CoverParts["documents"] & Parameters<typeof followLibrary>[1];

export function articleCovers(env: Record<string, string>, library: Library): Plugin {
  const mount = (server: { middlewares: Connect.Server; httpServer?: { once(event: "close", listener: () => void): unknown } | null }) => {
    const directory = resolve(env.LIBRARY_DATA_DIR || ".readaloud-library");
    const started = coverRuntime({
      config: coverConfig(env, resolve(directory, "covers")),
      documents: library,
      // The key the summaries use, saved in Settings or given in the environment.
      director: ArtDirector.layerChat(new LlmKeyStore(directory, env.LLM_API_KEY || ""), env.LLM_URL || "https://opencode.ai/zen/go"),
    });
    const unfollow = followLibrary(started, library);
    server.middlewares.use("/api/covers", coverMiddleware(started));
    // Start now, not on the first request: covers queued before a restart carry on by themselves.
    void started.runPromise(Covers.use((covers) => covers.library)).catch((error) => console.error("Covers could not start:", error instanceof Error ? error.message : "unknown error"));
    server.httpServer?.once("close", () => { unfollow(); void started.dispose(); });
  };
  return { name: "readaloud:article-covers", configureServer: mount, configurePreviewServer: mount };
}
