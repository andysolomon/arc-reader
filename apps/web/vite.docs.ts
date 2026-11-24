import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { pinRefs } from "./scripts/diagrams.mjs";
import { DOC_LINKS, DOCS_SECTION } from "./src/lib/docs";

/**
 * Serves the repo's HTML docs (docs/**\/*.html: the diagrams, the cluster explainer,
 * the plans) from the app at /docs/…, so Settings can link to them. The build copies
 * them into dist/docs, which `vite preview` serves like any other file; the dev server
 * reads them from disk. They sit behind the same access gate as the rest of the app.
 *
 * Each page gets a bar across the top with a link back to Settings and a menu of the
 * other pages, because the installed app and the iOS shell have no browser Back button.
 * Links to files the app doesn't serve (README.md, the Markdown notes) point at GitHub
 * instead. Code references on the diagram pages get the line numbers the code has now
 * (scripts/diagrams.mjs).
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

// The bar every page gets, in the shape of an iOS navigation bar: back to Settings on the
// left, and the page's title in the middle, which is also a menu of the other pages. It takes
// its colours from the page, so it follows whichever theme the page is showing.
const CHEVRON_LEFT = `<svg viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2 2 10l8 8"/></svg>`;
const CHEVRON_DOWN = `<svg viewBox="0 0 12 8" width="10" height="7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 1.5 5 5 5-5"/></svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** `ownTitle` is the page's <title>, as the HTML it already is. */
function bar(page: string, ownTitle: string): string {
  const listed = DOC_LINKS.find((d) => d.page === page);
  const title = listed ? esc(listed.title) : ownTitle;
  const options = [
    ...(listed ? [] : [`<option value="${DOCS_PATH}${esc(page)}" selected>${title}</option>`]),
    ...DOC_LINKS.map((d) => `<option value="${DOCS_PATH}${d.page}"${d.page === page ? " selected" : ""}>${esc(d.title)}</option>`),
  ].join("");
  // Coming back to a page restores the menu's last choice; put it back on the page shown.
  const menu = `<select aria-label="Open another page" autocomplete="off" onchange="location.href=this.value">${options}</select><script>addEventListener("pageshow",function(){var s=document.querySelector("[data-docs-bar] select");if(s)s.value="${DOCS_PATH}"+${JSON.stringify(page)}})</script>`;
  return `<nav data-docs-bar aria-label="ReadAloud"><a href="/settings#${DOCS_SECTION}" data-docs-back>${CHEVRON_LEFT}<span>Settings</span></a><label data-docs-title><span>${title}</span>${CHEVRON_DOWN}${menu}</label></nav>`;
}

// The page starts below the bar: the room is made on <html>, so a page keeps whatever padding
// its own <body> has. --docs-bar is the bar's height, for pages that park sticky rows under it.
// The pages style bare elements (svg, nav, a), so the bar sets everything it depends on.
// The title sits in the middle while there is room, and gives way to the back link when there isn't.
const BAR_STYLE = `<style data-docs-strip>
:root{--docs-bar:calc(44px + env(safe-area-inset-top))}
html{box-sizing:border-box;padding-top:var(--docs-bar) !important;scroll-padding-top:var(--docs-bar);-webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
[data-docs-bar]{position:fixed;z-index:2147483647;inset:0 0 auto;height:var(--docs-bar);box-sizing:border-box;padding:env(safe-area-inset-top) max(4px,env(safe-area-inset-right)) 0 max(4px,env(safe-area-inset-left));display:grid;grid-template-columns:minmax(max-content,1fr) minmax(0,auto) minmax(0,1fr);align-items:center;background:inherit;color:inherit;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent);font:400 17px/1.2 -apple-system,system-ui,sans-serif;letter-spacing:0;user-select:none;-webkit-user-select:none}
[data-docs-back]{justify-self:start;display:inline-flex;align-items:center;gap:5px;height:44px;padding:0 10px 0 8px;color:var(--docs-accent,var(--accent,currentColor));text-decoration:none;-webkit-touch-callout:none}
[data-docs-back]:active,[data-docs-title]:active{opacity:.55}
[data-docs-title]{position:relative;display:inline-flex;align-items:center;gap:6px;height:44px;max-width:420px;min-width:0;padding:0 6px;font-weight:600;color:inherit}
[data-docs-title]>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
[data-docs-bar] svg{display:block;flex:none;width:12px;height:20px;max-width:none;margin:0;padding:0}
[data-docs-title]>svg{width:10px;height:7px;opacity:.6}
[data-docs-title]>select{position:absolute;inset:0;width:100%;height:100%;margin:0;border:0;padding:0;opacity:0;font-size:16px;cursor:pointer;-webkit-appearance:none;appearance:none}
[data-docs-title]:has(select:focus-visible),[data-docs-back]:focus-visible{outline:2px solid var(--docs-accent,var(--accent,currentColor));outline-offset:-4px;border-radius:10px}
@media print{[data-docs-bar]{display:none}html{padding-top:0 !important}}
</style>`;
// Pages drawn for T3's inline viewer take their colours from its theme variables and leave
// the background to it. Their fallbacks are the dark theme, so give them its background.
// --docs-gutter is the side padding, for rows of theirs that run edge to edge.
const INLINE_THEME = `<style data-docs-theme>:root{--docs-accent:#d9955a;--docs-gutter:16px}html{background:#161412;color:#ece6dc;color-scheme:dark}body{background:#161412;padding:16px max(var(--docs-gutter),env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom)) max(var(--docs-gutter),env(safe-area-inset-left)) !important}</style>`;

/** With `viewport-fit=cover` the page reaches under the notch and the home indicator, and env(safe-area-inset-*) reports them. */
function coverViewport(html: string): string {
  return html.replace(/<meta name="viewport" content="([^"]*)"/i, (whole, content: string) =>
    /viewport-fit/.test(content) ? whole : `<meta name="viewport" content="${content.replace(/[,\s]+$/, "")}, viewport-fit=cover"`);
}

/** The page as the app serves it: the bar across the top, the safe areas, code references at their lines, and repo links for files outside the docs. */
export function servedDoc(html: string, page: string): string {
  const here = posix.dirname(`docs/${page}`);
  const linked = pinRefs(html).html.replace(/\bhref="([^"#:?]+?\.(?:md|ts|tsx|json|yaml))"/g, (whole, target: string) => {
    const path = posix.normalize(posix.join(here, target));
    return path.startsWith("..") ? whole : `href="${REPO}${path}" target="_blank" rel="noopener"`;
  });
  // A page Settings doesn't list is named by the first part of its own title.
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1].split(/\s+[—–|]\s+/)[0].trim() || "ReadAloud";
  const styles = BAR_STYLE + (html.includes("var(--foreground") ? INLINE_THEME : "");
  return coverViewport(linked)
    .replace(/<\/head>/i, (head) => `${styles}\n${head}`)
    .replace(/<body([^>]*)>/i, (body) => `${body}\n${bar(page, title)}`);
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
