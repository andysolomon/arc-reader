import { visualBlock, visualKey } from "./visuals";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocRecord } from "./db";
import { CATEGORIES, categoryNames, categoryRequest, citation, suggestCategory } from "./category";
import { summarySource } from "./summary";
import { assessPremiumFit, hasPremiumFit, premiumFitRequest } from "./premiumFit";

const rec = (patch: Partial<DocRecord> = {}): DocRecord =>
  ({ id: "d", title: "Evals for agents", text: "How to measure agents.", source: "url", domain: "example.com", voice: null, chars: 22, createdAt: 0, updatedAt: 0, ...patch });

describe("categories", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("offers the built-in shelves, then names from the library without case duplicates", () => {
    const names = categoryNames(["Reading list", "ai agents", " ", "Reading list"]);
    expect(names.slice(0, Object.keys(CATEGORIES).length)).toEqual(Object.keys(CATEGORIES));
    expect(names.slice(Object.keys(CATEGORIES).length)).toEqual(["Reading list"]);
  });

  it("asks Jev one Choice over every shelf with the document's details as state", () => {
    const summary = { source: summarySource("How to measure agents."), text: "Short.", model: "glm-5.3", version: 1, createdAt: 1 };
    const request = categoryRequest(rec({ meta: { url: "https://example.com/e", author: "Ada", notes: "private" }, summary }), ["Reading list"]);
    expect(request.model).toBe("jev-latest");
    expect(request.state).toEqual({ title: "Evals for agents", link: "https://example.com/e", author: "Ada", summary: "Short.", text: "How to measure agents." });
    expect(request.questions.category.type).toBe("choice");
    expect(request.questions.category.criteria["AI evaluation"]).toMatch(/Evals/);
    expect(request.questions.category.criteria["Reading list"]).toBeNull();
  });

  it("classifies visual descriptions without sending embedded image metadata", () => {
    const visual = { kind: "diagram" as const, src: "https://example.com/chart.png", alt: "Flow chart", caption: "" };
    const document = rec({ text: "A system design.\n\n" + visualBlock(visual), visualDescriptions: { [visualKey(visual)]: "Requests flow through a server." } });
    const request = categoryRequest(document, []);
    expect(request.state.text).toContain("Requests flow through a server.");
    expect(request.state.text).not.toMatch(/readaloud-visual|chart.png/);
  });

  it("returns Jev's pick with its confidence and reports failures", async () => {
    const fetch = vi.fn(async () => Response.json({ model: "jev-1.14.0", answers: { category: { type: "choice", choice: "AI evaluation", confidence: 0.83, probabilities: {} } } }));
    vi.stubGlobal("fetch", fetch);
    expect(await suggestCategory(rec(), [])).toMatchObject({ name: "AI evaluation", by: "jev", confidence: 0.83, model: "jev-1.14.0" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("/api/jev/v1/systemone");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ answers: { category: { choice: "toString" } } })));
    await expect(suggestCategory(rec(), [])).rejects.toThrow("didn't return a category");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Add your TypeSafe API key in Settings → Library." } }, { status: 503 })));
    await expect(suggestCategory(rec(), [])).rejects.toThrow("TypeSafe API key");
  });

  it("asks Jev whether a document deserves a paid voice and ties the verdict to its text", async () => {
    const request = premiumFitRequest(rec());
    expect(request.state.text).toBe("How to measure agents.");
    expect(Object.keys(request.questions.premium.criteria)).toEqual(["strong", "good", "weak"]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ model: "jev-1.14.0", answers: { premium: { choice: "strong", confidence: 0.7 } } })));
    const premium = await assessPremiumFit(rec());
    expect(premium).toMatchObject({ fit: "strong", confidence: 0.7, model: "jev-1.14.0", source: summarySource("How to measure agents.") });
    expect(hasPremiumFit(rec({ premium }))).toBe(true);
    expect(hasPremiumFit(rec({ premium, text: "Edited." }))).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ answers: { premium: { choice: "AI evaluation" } } })));
    await expect(assessPremiumFit(rec())).rejects.toThrow("didn't return an assessment");
  });

  it("formats a citation from whatever details are known", () => {
    expect(citation(rec({ meta: { author: "Ada", published: "2026-10-01", site: "Example", url: "https://example.com/e" } })))
      .toBe("Ada (2026-10-01). Evals for agents. Example. https://example.com/e");
    expect(citation(rec({ title: "Untitled. ", meta: { published: "2026" } }))).toBe("(2026). Untitled.");
  });
});
