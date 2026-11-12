import { SLIDE_SOURCE, imageSource, type ArticleVisual } from "./visuals";

function srcset(value: string): string {
  if (value.startsWith("data:")) return "";
  return value.split(",").map((entry) => {
    const [url, size = "1x"] = entry.trim().split(/\s+/);
    return { url, size: parseFloat(size) || 1 };
  }).sort((a, b) => b.size - a.size)[0]?.url ?? "";
}

/** Serialize SVG only for an inert <img>/canvas image, never insertion into the page DOM. */
export function svgImage(el: Element): string {
  const svg = el.cloneNode(true) as Element;
  svg.querySelectorAll("script,foreignObject,iframe,object,embed,image").forEach((node) => node.remove());
  svg.querySelectorAll("use").forEach((node) => { if (!(node.getAttribute("href") || node.getAttribute("xlink:href") || "").startsWith("#")) node.remove(); });
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /href|src/i.test(attr.name) && !attr.value.startsWith("#")
        || /(?:url\(\s*["']?(?!#)|@import)/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  svg.querySelectorAll("style").forEach((style) => {
    if (/@import|url\(/i.test(style.textContent ?? "")) style.remove();
  });
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = Number(svg.getAttribute("width")) || viewBox?.[2] || 800;
  const height = Number(svg.getAttribute("height")) || viewBox?.[3] || 500;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  if (!viewBox) svg.setAttribute("viewBox", `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
  svg.setAttribute("width", String(Math.max(1, width * scale)));
  svg.setAttribute("height", String(Math.max(1, height * scale)));
  const serialized = new XMLSerializer().serializeToString(svg);
  return imageSource(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`);
}

export function articleVisual(el: Element, base: string, caption: string): ArticleVisual | null {
  if (el.getAttribute("role") === "presentation" || el.getAttribute("role") === "none") return null;
  const width = Number(el.getAttribute("width"));
  const height = Number(el.getAttribute("height"));
  if (width > 0 && height > 0 && width <= 32 && height <= 32 && !caption) return null;
  if (el.tagName.toLowerCase() === "svg") {
    const alt = el.getAttribute("aria-label") || el.querySelector("title")?.textContent || "";
    const description = el.querySelector("desc")?.textContent || "";
    // Tiny interface symbols usually have no meaningful description or figure.
    const dimensions = el.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const large = (width > 64 && height > 64) || !!(dimensions && dimensions[2] > 64 && dimensions[3] > 64);
    if (!caption && !alt && !description && !el.closest("figure") && el.getAttribute("role") !== "img" && !large) return null;
    return { kind: "diagram", src: svgImage(el), alt: alt.trim().slice(0, 1200), caption: (caption || description).trim().slice(0, 1600) };
  }
  const alt = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
  if (el.hasAttribute("alt") && !alt.trim() && !caption) return null;
  const picture = el.closest("picture");
  const candidates = [el.getAttribute("data-src"), el.getAttribute("data-original"),
    srcset(el.getAttribute("data-srcset") || ""), srcset(el.getAttribute("srcset") || ""),
    srcset(picture?.querySelector("source")?.getAttribute("srcset") || ""), el.getAttribute("src")];
  const src = candidates.map((value) => value ? imageSource(value, base) : "").find(Boolean) || "";
  if (SLIDE_SOURCE.test(src)) return { kind: "slide", src, alt: alt.trim().slice(0, 1200), caption: "" };
  return { kind: /\b(?:diagram|chart|graph|flowchart)\b/i.test(`${alt} ${caption}`) ? "diagram" : "image", src, alt: alt.trim().slice(0, 1200), caption: caption.slice(0, 1600) };
}
