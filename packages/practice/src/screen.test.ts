import { describe, expect, it } from "vitest";
import { fits, interpretScreening, screeningRequest } from "./screen";

describe("Jev screening", () => {
  it("asks one level choice and one suitability question", () => {
    const r = screeningRequest("A passage.");
    expect(r.model).toBe("jev-latest");
    expect(Object.keys(r.questions.level.criteria)).toEqual(["6-8", "9-12", "college", "advanced"]);
    expect(r.questions.unsuitable.type).toBe("noul");
  });

  it("keeps passages Jev is sure fit the band and are suitable", () => {
    const ok = interpretScreening({ answers: { level: { choice: "9-12", confidence: 0.8 }, unsuitable: { noul: 0.05 } } });
    expect(fits(ok, "9-12")).toBe(true);
    expect(fits(ok, "college")).toBe(false);
    expect(fits({ ...ok, confidence: 0.6 }, "9-12")).toBe(false);
    expect(fits({ ...ok, unsuitable: 0.4 }, "9-12")).toBe(false);
    expect(() => interpretScreening({ answers: { level: { choice: "grade 3" }, unsuitable: { noul: 0.1 } } })).toThrow();
  });
});
