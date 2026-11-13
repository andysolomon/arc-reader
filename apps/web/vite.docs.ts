import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Serves the repo's HTML docs (docs/**\/*.html: the diagrams, the cluster explainer,
 * the plans) from the app at /docs/…, so Settings can link to them. The build copies
 * them into dist/docs, which `vite preview` serves like any other file; the dev server
 * reads them from disk. They sit behind the same access gate as the rest of the app.
 *
 * Each page gets a small link back to Settings, because the installed app and the iOS
 * shell have no browser Back button. Links to files the app doesn't serve (README.md,
 * the Markdown notes) point at GitHub instead.
 */

export const DOCS_PATH = "/docs/";
export const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs");
const REPO = "https://github.com/andysolomon/arc-reader/blob/main/";

/** Every HTML page under `dir`, as forward-slash paths relative to it. */
export function docPages(dir = DOCS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.split(sep).join("/"))
    .sort();
}

// A strip across the top of every page holds the link, so it never covers the page's own controls.
const BACK = `<a href="/settings" data-docs-back style="position:fixed;z-index:2147483647;left:max(12px,env(safe-area-inset-left));top:calc(7px + env(safe-area-inset-top));padding:6px 12px;border-radius:999px;background:#161412;color:#ece6dc;border:1px solid #3a342d;font:600 13px/1.2 -apple-system,system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.3)">← ReadAloud</a>`;
const STRIP = `<style data-docs-strip>body{box-sizing:border-box;padding-top:calc(44px + env(safe-area-inset-top)) !important}</style>`;
// Pages drawn for T3's inline viewer take their colours from its theme variables and leave
// the background to it. Their fallbacks are the dark theme, so give them its background.
const INLINE_THEME = `<style data-docs-theme>html{background:#161412;color-scheme:dark}body{padding-left:max(20px,env(safe-area-inset-left)) !important;padding-right:max(20px,env(safe-area-inset-right)) !important;padding-bottom:32px !important}</style>`;

/** The page as the app serves it: a link back to Settings, and repo links for files outside the docs. */
export function servedDoc(html: string, page: string): string {
  const here = posix.dirname(`docs/${page}`);
  const linked = html.replace(/\bhref="([^"#:?]+?\.(?:md|ts|tsx|json|yaml))"/g, (whole, target: string) => {
    const path = posix.normalize(posix.join(here, target));
    return path.startsWith("..") ? whole : `href="${REPO}${path}" target="_blank" rel="noopener"`;
  });
  const styles = STRIP + (html.includes("var(--foreground") ? INLINE_THEME : "");
  return linked
    .replace(/<\/head>/i, (head) => `${styles}\n${head}`)
    .replace(/<body([^>]*)>/i, (body) => `${body}\n${BACK}`);
}

export function hostedDocs(dir = DOCS_DIR): Plugin {
  return {
    name: "readaloud:docs",
    generateBundle() {
      for (const page of docPages(dir)) {
        this.emitFile({ type: "asset", fileName: `docs/${page}`, source: servedDoc(readFileSync(resolve(dir, page), "utf8"), page) });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? "/", "http://dev").pathname);
        if (!path.startsWith(DOCS_PATH)) return next();
        const page = path.slice(DOCS_PATH.length);
        const file = resolve(dir, page);
        if (!page.endsWith(".html") || relative(dir, file).startsWith("..") || !existsSync(file)) return next();
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(servedDoc(readFileSync(file, "utf8"), page));
      });
    },
  };
}
