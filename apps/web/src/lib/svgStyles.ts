/**
 * An inline SVG drawn by a page often takes its colours and fonts from the page's stylesheets:
 * `fill="var(--accent)"`, `class="mono"`, a background on the frame around it. Shown on its own
 * as an image, none of that reaches it and everything paints black. These helpers work out what
 * the page's CSS gives each element, without a browser laying the page out, so the picture can
 * carry its look with it.
 */

export interface CssRule {
  selector: string;
  declarations: [property: string, value: string][];
}

/** Properties an SVG picture's look depends on; layout and interaction are left behind. */
const PAINT = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "opacity", "color", "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "letter-spacing", "text-decoration", "stop-color", "stop-opacity", "marker-start",
  "marker-mid", "marker-end", "display", "visibility",
]);
/** What an SVG takes from the page around it. */
const INHERITED = ["color", "font-family", "font-size", "font-weight", "font-style"];
const BACKGROUND = new Set(["background", "background-color"]);

/** Split on a separator that is not inside quotes or brackets. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

export function declarations(text: string): [string, string][] {
  return splitTop(text, ";").flatMap((part) => {
    const colon = part.indexOf(":");
    if (colon < 0) return [];
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).replace(/!important\s*$/i, "").trim();
    if (!property || !value) return [];
    return [[property.startsWith("--") ? property : property.toLowerCase(), value]];
  });
}

/** Rules a light, on-screen reading of the page uses: dark-scheme and print styles are skipped. */
const SKIPPED_AT_RULE = /^@(?:font-face|keyframes|-webkit-keyframes|page|counter-style|property|font-feature-values)\b/i;
const OFF_SCREEN_MEDIA = /prefers-color-scheme\s*:\s*dark|\bprint\b|prefers-contrast|forced-colors/i;

/** A flat list of style rules, in source order, from a stylesheet's text. */
export function cssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let i = 0;
  const block = (): string => {
    // At an opening brace: the text up to its partner.
    let depth = 0;
    let quote = "";
    const start = i + 1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { i++; return text.slice(start, i - 1); }
    }
    return text.slice(start);
  };
  while (i < text.length) {
    const open = text.indexOf("{", i);
    const semicolon = text.indexOf(";", i);
    // A statement such as @import or @charset with no block.
    if (semicolon >= 0 && (open < 0 || semicolon < open) && /^\s*@/.test(text.slice(i, semicolon))) { i = semicolon + 1; continue; }
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    i = open;
    const body = block();
    if (prelude.startsWith("@")) {
      if (SKIPPED_AT_RULE.test(prelude) || (/^@media\b/i.test(prelude) && OFF_SCREEN_MEDIA.test(prelude))) continue;
      // @media screen, @supports, @layer and @container hold rules that apply.
      rules.push(...cssRules(body));
      continue;
    }
    const found = declarations(body);
    if (prelude && found.length) rules.push({ selector: prelude, declarations: found });
  }
  return rules;
}

type Values = Map<string, string>;
interface Scope { vars: Values; inherited: Values; background?: string }

/**
 * Replace each `var(--name, fallback)` from the custom properties in scope. Null when a variable
 * has neither a value nor a fallback, as a browser would treat the whole declaration as invalid.
 */
export function resolveVars(value: string, vars: Values, depth = 0): string | null {
  if (!value.includes("var(")) return value;
  if (depth > 20) return null;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let depthParen = 0;
    let end = at + 3;
    for (; end < value.length; end++) {
      if (value[end] === "(") depthParen++;
      else if (value[end] === ")" && --depthParen === 0) break;
    }
    const inner = value.slice(at + 4, end);
    const comma = splitTop(inner, ",");
    const name = comma[0].trim();
    const fallback = comma.length > 1 ? comma.slice(1).join(",").trim() : undefined;
    const raw = vars.get(name) ?? fallback;
    if (raw === undefined) return null;
    const resolved = resolveVars(raw, vars, depth + 1);
    if (resolved === null) return null;
    out += resolved;
    i = end + 1;
  }
  return out;
}

const matches = (el: Element, selector: string) => {
  try { return el.matches(selector); } catch { return false; }
};

/** A colour a picture can sit on: no images, gradients or see-through values. */
function solidColor(value: string): string | null {
  const v = value.trim();
  if (!v || /url\(|gradient|^(?:transparent|none|initial|inherit|unset|revert|currentcolor)$/i.test(v)) return null;
  if (/^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$|^rgba?\([^)]*\/\s*0%?\s*\)$/i.test(v) || /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i.test(v)) return null;
  const tokens = splitTop(v, " ").filter(Boolean);
  return tokens.length === 1 ? tokens[0] : null;
}

/** The page's styles, worked out element by element for the pictures in it. */
export class PageStyles {
  private rules: CssRule[];
  private scopes = new WeakMap<Element, Scope>();

  constructor(css: string[]) {
    this.rules = css.flatMap(cssRules).filter((rule) => rule.declarations.some(([property]) =>
      property.startsWith("--") || PAINT.has(property) || BACKGROUND.has(property)));
  }

  get empty() { return this.rules.length === 0; }

  /** Declarations that apply to an element, rules in source order and then its own style attribute. */
  private declared(el: Element): [string, string][] {
    const found = this.rules.filter((rule) => matches(el, rule.selector)).flatMap((rule) => rule.declarations);
    return [...found, ...declarations(el.getAttribute("style") ?? "")];
  }

  /** Custom properties, inherited text styles and the nearest solid background around an element. */
  private scope(el: Element): Scope {
    const cached = this.scopes.get(el);
    if (cached) return cached;
    const parent: Scope = el.parentElement ? this.scope(el.parentElement) : { vars: new Map(), inherited: new Map() };
    const vars = new Map(parent.vars);
    const own = this.declared(el);
    for (const [property, value] of own) if (property.startsWith("--")) vars.set(property, value);
    const inherited = new Map(parent.inherited);
    let background = parent.background;
    for (const [property, value] of own) {
      const resolved = resolveVars(value, vars);
      if (resolved === null) continue;
      if (INHERITED.includes(property) && resolved !== "inherit") inherited.set(property, resolved);
      if (BACKGROUND.has(property)) background = solidColor(resolved) ?? background;
    }
    const scope: Scope = { vars, inherited, background };
    this.scopes.set(el, scope);
    return scope;
  }

  /**
   * Write what the page's CSS gives `original` and everything in it onto `copy`, a deep clone of
   * it: paint properties as inline styles, every var() resolved, and the colour behind it.
   */
  bake(original: Element, copy: Element): { background?: string } {
    const sources = [original, ...original.querySelectorAll("*")];
    const targets = [copy, ...copy.querySelectorAll("*")];
    if (sources.length !== targets.length) return {};
    const outer = original.parentElement ? this.scope(original.parentElement) : undefined;
    sources.forEach((source, n) => {
      const target = targets[n];
      const { vars } = this.scope(source);
      const style = new Map<string, string>();
      // The page around the picture: text colour and font reach it by inheritance.
      if (n === 0 && outer) for (const [property, value] of outer.inherited) style.set(property, value);
      const fromRules = this.rules.filter((rule) => matches(source, rule.selector)).flatMap((rule) => rule.declarations);
      const inline = declarations(source.getAttribute("style") ?? "");
      for (const [property, value] of [...fromRules.filter(([property]) => PAINT.has(property)), ...inline]) {
        if (property.startsWith("--")) continue;
        const resolved = resolveVars(value, vars);
        if (resolved !== null) style.set(property, resolved);
      }
      for (const attr of [...target.attributes]) {
        if (attr.name === "style" || !attr.value.includes("var(")) continue;
        const resolved = resolveVars(attr.value, vars);
        if (resolved === null) target.removeAttribute(attr.name);
        else target.setAttribute(attr.name, resolved);
      }
      if (style.size) target.setAttribute("style", [...style].map(([property, value]) => `${property}:${value}`).join(";"));
      else target.removeAttribute("style");
    });
    // The picture's own <style> may use the page's variables too.
    copy.querySelectorAll("style").forEach((el) => {
      const vars = this.scope(original).vars;
      el.textContent = (el.textContent ?? "").replace(/var\([^;{}]*\)/g, (match) => resolveVars(match, vars) ?? "initial");
    });
    return { background: this.scope(original).background };
  }
}
