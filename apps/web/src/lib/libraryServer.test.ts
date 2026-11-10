import { describe, expect, it } from "vitest";
import { normalizeLibraryServer } from "./libraryServer";

describe("library server address", () => {
  it("normalizes an absolute website root and retains its port", () => {
    expect(normalizeLibraryServer(" https://reader.example:8449/ ")).toBe("https://reader.example:8449");
    expect(normalizeLibraryServer("http://reader.example:4179")).toBe("http://reader.example:4179");
  });

  it.each(["", "/api/library", "reader.example", "capacitor://localhost", "file:///tmp/library",
    "https://reader.example/api/vs", "https://reader.example/library", "https://reader.example?key=secret",
    "https://reader.example/#/library", "https://user:secret@reader.example"])("rejects non-root website addresses: %s", (value) => {
    expect(normalizeLibraryServer(value)).toBe("");
  });
});
