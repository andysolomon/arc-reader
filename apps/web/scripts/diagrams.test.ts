import * as moddle from "bpmn-moddle";
import { describe, expect, it } from "vitest";
import { PAGES, loadModel, resolveRefs } from "./diagrams.mjs";

// bpmn-moddle's default export, however this runtime presents it.
const BpmnModdle = (moddle as any).default?.default ?? (moddle as any).default ?? (moddle as any).BpmnModdle;

/* The diagram pages in docs/ carry their models as plain scripts; a broken model blocks a merge. */

describe("diagram code references", () => {
  it("all point at code that still exists", () => {
    const { problems, count } = resolveRefs();
    expect(count).toBeGreaterThan(100);
    // Fix: point the reference at the code it describes, then run `node apps/web/scripts/diagrams.mjs refs`.
    expect(problems).toEqual([]);
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
