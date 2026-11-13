import { describe, expect, it } from "vitest";
import { noZoomViewport } from "./native";

describe("noZoomViewport", () => {
  it("adds the zoom limits and keeps the rest of the tag", () => {
    expect(noZoomViewport("width=device-width, initial-scale=1, viewport-fit=cover")).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no",
    );
  });

  it("replaces existing limits instead of repeating them", () => {
    expect(noZoomViewport("width=device-width, maximum-scale=5, user-scalable=yes")).toBe("width=device-width, maximum-scale=1, user-scalable=no");
  });
});
