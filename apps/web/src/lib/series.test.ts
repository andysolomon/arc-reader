import { describe, expect, it } from "vitest";
import { seriesPlace } from "./series";

describe("a book's place in a series", () => {
  it("reads the series and the volume from the title", () => {
    expect(seriesPlace("AI Engineering from Scratch: Volume 4 — Large Language Models: Generation and Pretraining")).toEqual({
      name: "AI Engineering from Scratch", key: "ai engineering from scratch", volume: 4, rest: "Volume 4 — Large Language Models: Generation and Pretraining",
    });
    expect(seriesPlace("The Art of Computer Programming, Vol. 2")).toMatchObject({ name: "The Art of Computer Programming", volume: 2, rest: "Vol. 2" });
    expect(seriesPlace("Dune Book 3")).toMatchObject({ name: "Dune", volume: 3 });
    expect(seriesPlace("A History of Rome (Part II)")).toMatchObject({ name: "A History of Rome", volume: 2, rest: "Part II" });
    expect(seriesPlace("Capital – Volume IV")).toMatchObject({ name: "Capital", volume: 4 });
  });

  it("gives the volumes of one series the same key", () => {
    expect(seriesPlace("Deep  Work: volume 1")?.key).toBe(seriesPlace("Deep Work: Volume 2")?.key);
  });

  it("leaves other titles alone", () => {
    for (const title of ["Backend Basics", "The Jungle Book", "Volume 2 of the report", "Part in Parcel: a memoir", "My Bookmarks 3", "Notebook 4"]) expect(seriesPlace(title), title).toBeNull();
  });
});
