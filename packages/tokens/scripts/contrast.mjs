// WCAG 2.2 AA contrast check per theme, including text on --hl composited over --bg.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/themes.css"), "utf8");

const blocks = [...css.matchAll(/html\[data-theme="([^"]+)"\]\s*{([^}]+)}/g)].map((m) => {
  const vars = Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((v) => [v[1], v[2].trim()]));
  return { id: m[1], vars };
});

const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
};
const parse = (c) => {
  if (c.startsWith("#")) return hex(c);
  const m = c.match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(",").map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const over = (top, bottom) => {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat([1]);
};
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

let failed = false;
const rows = [];
for (const t of blocks) {
  const v = t.vars;
  const bg = parse(v.bg), bg2 = parse(v.bg2), bg3 = parse(v.bg3);
  const hlOnBg = over(parse(v.hl), bg);
  const checks = [
    ["fg / bg", ratio(parse(v.fg), bg), 4.5],
    ["fg / bg2", ratio(parse(v.fg), bg2), 4.5],
    ["fg / bg3", ratio(parse(v.fg), bg3), 4.5],
    ["fg2 / bg", ratio(parse(v.fg2), bg), 4.5],
    ["fg2 / bg2", ratio(parse(v.fg2), bg2), 4.5],
    ["fg / hl∘bg", ratio(parse(v.fg), hlOnBg), 4.5],
    ["fg / hl∘bg2", ratio(parse(v.fg), over(parse(v.hl), bg2)), 4.5],
    ["accent / hl∘bg2 (waybar mockup)", ratio(parse(v.accent), over(parse(v.hl), bg2)), 4.5, "advisory"],
    ["accent-fg / accent", ratio(parse(v["accent-fg"]), parse(v.accent)), 4.5],
    ["accent / bg (text)", ratio(parse(v.accent), bg), 4.5],
    ["accent / bg2 (text)", ratio(parse(v.accent), bg2), 4.5],
    ["fg3 / bg (ticks, dashed borders)", ratio(parse(v.fg3), bg), 3, "advisory"],
  ];
  for (const [label, r, min, level] of checks) {
    const ok = r >= min;
    if (!ok && level !== "advisory") failed = true;
    rows.push({ theme: t.id, check: label, ratio: r.toFixed(2), min, ok: ok ? "pass" : level === "advisory" ? "warn" : "FAIL" });
  }
}
console.table(rows);
if (failed) {
  console.error("Contrast check failed.");
  process.exit(1);
}
const warns = rows.filter((r) => r.ok === "warn").length;
console.log(`${rows.length - warns} required contrast checks pass across ${blocks.length} themes (${warns} advisory warnings).`);
