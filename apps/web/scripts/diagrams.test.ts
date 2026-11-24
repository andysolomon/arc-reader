import * as moddle from "bpmn-moddle";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES, ROOT, describesChange, loadModel, pinRefs } from "./diagrams.mjs";

// bpmn-moddle's default export, however this runtime presents it.
const BpmnModdle = (moddle as any).default?.default ?? (moddle as any).default ?? (moddle as any).BpmnModdle;

/* The diagram pages in docs/ carry their models as plain scripts; a broken model blocks a merge. */

describe("diagram code references", () => {
  it.each(PAGES)("%s: each names a line the code still has", (page) => {
    const { problems, count } = pinRefs(readFileSync(resolve(ROOT, page), "utf8"));
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThan(100);
  });

  const root = mkdtempSync(join(tmpdir(), "diagram-refs-"));
  mkdirSync(join(root, "apps/web/src/engine"), { recursive: true });
  const code = (...lines: string[]) => writeFileSync(join(root, "apps/web/src/engine/engine.ts"), lines.join("\n"));
  const page = `code: [SRC + "engine/engine.ts#private ensureChunk(", "apps/web/src/engine/engine.ts#async play( … } catch (e"]`;

  it("get the line their code is on now, wherever it has moved", () => {
    code("class E {", "  async play() {", "    try {", "    } catch (e) {}", "  }", "  private ensureChunk(passage: number) {}", "}");
    expect(pinRefs(page, root)).toEqual({ html: `code: [SRC + "engine/engine.ts:6", "apps/web/src/engine/engine.ts:4"]`, problems: [], count: 2 });
    code("// A line added above both.", "class E {", "  async play() {", "    try {", "    } catch (e) {}", "  }", "  private ensureChunk(passage: number, signal: AbortSignal) {}", "}");
    expect(pinRefs(page, root).html).toBe(`code: [SRC + "engine/engine.ts:7", "apps/web/src/engine/engine.ts:5"]`);
  });

  it("that name no line say which, and how to fix them", () => {
    code("class E {", "  async play() {}", "  private ensureChunk(a: number) {}", "  private ensureChunk(b: string) {}", "}");
    expect(pinRefs(page, root).problems).toEqual([
      "apps/web/src/engine/engine.ts#private ensureChunk(: 2 lines start with “private ensureChunk(”. Make it longer, or name a line above it first: “<line above> … private ensureChunk(”.",
      "apps/web/src/engine/engine.ts#async play( … } catch (e: no line below line 2 starts with “} catch (e”. Change the text after # to the start of the line this describes.",
    ]);
    code("class E {", "  private chunkFor(passage: number) {}", "}");
    expect(pinRefs(page, root).problems[0]).toBe("apps/web/src/engine/engine.ts#private ensureChunk(: no line starts with “private ensureChunk(”. Change the text after # to the start of the line this describes.");
    expect(pinRefs(`[SRC + "engine/gone.ts#x"]`, root).problems).toEqual(["apps/web/src/engine/gone.ts#x: the file no longer exists. Point the reference at the file that has this code now."]);
  });

  it("written as line numbers fail, saying how to cite the line instead", () => {
    expect(pinRefs(`code: [SRC + "state/preparation.ts:204", "compose.yaml:82", SRC + "main.tsx"]`, root).problems).toEqual([
      `apps/web/src/state/preparation.ts:204: a line number goes stale when code above it moves. Cite how the line it describes starts instead: SRC + "state/preparation.ts#<start of that line>"`,
      `compose.yaml:82: a line number goes stale when code above it moves. Cite how the line it describes starts instead: "compose.yaml#<start of that line>"`,
    ]);
  });
});

describe("diagram staleness reminder", () => {
  const diff = (...lines: string[]) => ["--- a/docs/x.html", "+++ b/docs/x.html", "@@ -1 +1 @@", ...lines].join("\n");

  it("ignores pages whose only change is a reference following its code within the same file", () => {
    expect(describesChange(diff(
      `-  code: [SRC + "engine/engine.ts#private ensureChunk(", "apps/web/vite.prepare.ts#async submit("] },`,
      `+  code: [SRC + "engine/engine.ts#private chunkFor(", "apps/web/vite.prepare.ts#async submit(job"] },`,
    ))).toBe(false);
  });

  it("counts a change to what a page says", () => {
    expect(describesChange(diff(`-  d: "VoiceStudio voices only.", code: [SRC + "a.ts#x"] },`, `+  d: "VoiceStudio and Phonon voices.", code: [SRC + "a.ts#y"] },`))).toBe(true);
    expect(describesChange(diff(`-  code: [SRC + "a.ts#x"] },`, `+  code: [SRC + "b.ts#x"] },`))).toBe(true);
    expect(describesChange(diff(`+  { id: "X_phonon", n: "Phonon" },`))).toBe(true);
    expect(describesChange(diff(`-  { id: "X_old", n: "Old" },`))).toBe(true);
  });
});

describe("BPMN page", () => {
  const { DIAGRAMS, build, toBPMN } = loadModel(PAGES[0]);
  const ids = Object.keys(DIAGRAMS);

  it.each(ids)("%s: flows, walkthroughs and called processes resolve", (id) => {
    const G = build(id);
    const missing: string[] = [];
    for (const f of G.flows) for (const end of [f.f, f.to]) if (!G.E[end]) missing.push(`flow end ${end}`);
    for (const f of G.flows) for (const [x, y] of f.pts) if (!Number.isFinite(x) || !Number.isFinite(y)) missing.push(`flow ${f.f}→${f.to} has no route`);
    for (const n of G.D.nodes) if (n.t === "call" && !DIAGRAMS[n.ref]) missing.push(`call ${n.id} → ${n.ref}`);
    for (const s of G.D.scenarios) for (const step of s.steps) {
      if (!G.E[step.at]) missing.push(`${s.id}: step ${step.at}`);
      if (step.call && !DIAGRAMS[step.call]?.scenarios.some((x: { id: string }) => x.id === step.sc)) missing.push(`${s.id}: call ${step.call}/${step.sc}`);
    }
    expect(missing).toEqual([]);
  });

  it.each(ids)("%s: exports BPMN 2.0 XML that parses without warnings", async (id) => {
    const { warnings } = await new BpmnModdle().fromXML(toBPMN(id));
    expect(warnings.map((w: { message: string }) => w.message)).toEqual([]);
  });
});

describe("sequence page", () => {
  const { SEQS, P, OPS, layout, buildSteps, toMermaid, find } = loadModel(PAGES[1]);
  const ids = Object.keys(SEQS);

  it.each(ids)("%s: lays out with every fragment inside its parent", (id) => {
    const L = layout(id);
    const problems: string[] = [];
    const visit = (rows: any[]) => {
      for (const it of rows) {
        if (it.ops) {
          if (!it.id) problems.push("fragment without id");
          if (!OPS[it.op]) problems.push(`unknown operator ${it.op}`);
          if (![it.x0, it.x1, it.y0, it.y1].every(Number.isFinite) || it.x1 <= it.x0) problems.push(`frame ${it.id}`);
          for (const { frag } of it.ctx) if (it.x0 < frag.x0 || it.x1 > frag.x1 || it.y0 < frag.y0 || it.y1 > frag.y1) problems.push(`${it.id} escapes ${frag.id}`);
          for (const op of it.ops) visit(op.rows);
        } else if (it.f) {
          if (!P[it.f] || !P[it.to]) problems.push(`${it.id}: unknown participant`);
          if ((it.f === it.to) !== (it.t === "self")) problems.push(`${it.id}: self call marked wrongly`);
          for (const k of ["x1", "x2", "y", "lx", "ly"]) if (!Number.isFinite(it[k])) problems.push(`${it.id}: ${k}`);
        } else if (it.ref) {
          if (!SEQS[it.ref]) problems.push(`ref ${it.id} → ${it.ref}`);
        } else problems.push("unknown row");
      }
    };
    visit(SEQS[id].rows);
    for (const a of L.acts) if (!(a.y1 > a.y0)) problems.push(`activation on ${a.p}`);
    expect(problems).toEqual([]);
  });

  it.each(ids)("%s: every walkthrough picks real branches and has steps", (id) => {
    const problems: string[] = [];
    for (const sc of SEQS[id].scenarios) {
      for (const [frag, k] of Object.entries(sc.pick ?? {})) {
        const F = find(id, frag);
        if (!F?.ops) problems.push(`${sc.id}: no fragment ${frag}`);
        else if ((k as number) >= F.ops.length) problems.push(`${sc.id}: ${frag} has no operand ${k}`);
      }
      for (const [ref, target] of Object.entries(sc.calls ?? {})) {
        const r = find(id, ref);
        if (!r?.ref) problems.push(`${sc.id}: no ref ${ref}`);
        else if (target && !SEQS[r.ref].scenarios.some((s: { id: string }) => s.id === target)) problems.push(`${sc.id}: ${r.ref} has no walkthrough ${target}`);
      }
      const steps = buildSteps(id, sc.id, true);
      if (!steps.length) problems.push(`${sc.id}: no steps`);
      for (const s of steps) if (!find(s.diag, s.id)) problems.push(`${sc.id}: step ${s.diag}/${s.id}`);
    }
    expect(problems).toEqual([]);
  });

  it.each(ids)("%s: exports Mermaid text", (id) => {
    const text: string = toMermaid(id);
    expect(text).toMatch(/^%%.*\nsequenceDiagram\n/);
    // Message texts must not carry characters Mermaid treats as markup or statement ends.
    const labels = text.split("\n").map((l) => l.match(/^\s*\w+(?:->>|-->>|-\))\w+: (.*)$/)?.[1]).filter(Boolean);
    expect(labels.length).toBeGreaterThan(10);
    expect(labels.filter((l) => /[<>;#]/.test(l!))).toEqual([]);
  });
});
