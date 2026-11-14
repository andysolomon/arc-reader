import { describe, expect, it } from "vitest";
import { cssRules, resolveVars } from "./svgStyles";

describe("reading a page's stylesheet for its pictures", () => {
  it("flattens screen rules and skips dark, print, fonts and animations", () => {
    const rules = cssRules(`@charset "utf-8";@import url(x.css);/* a { fill: red } */
      a{fill:red;content:"}{;"}
      @media screen and (min-width:40em){@supports (display:grid){b{stroke:blue !important}}}
      @media (prefers-color-scheme:dark){c{fill:black}} @media print{d{fill:gray}}
      @font-face{font-family:X;src:url(x.woff)} @keyframes spin{from{opacity:0}to{opacity:1}}
      @layer base{e{--x:1px}}`);
    expect(rules).toEqual([
      { selector: "a", declarations: [["fill", "red"], ["content", '"}{;"']] },
      { selector: "b", declarations: [["stroke", "blue"]] },
      { selector: "e", declarations: [["--x", "1px"]] },
    ]);
  });
  it("resolves nested variables and fallbacks, and gives up on a variable with neither", () => {
    const vars = new Map([["--a", "var(--b)"], ["--b", "#111"], ["--loop", "var(--loop)"]]);
    expect(resolveVars("var(--a) var(--none, var(--b))", vars)).toBe("#111 #111");
    expect(resolveVars("rgb(0 0 0 / var(--none, 50%))", vars)).toBe("rgb(0 0 0 / 50%)");
    expect(resolveVars("var(--none)", vars)).toBeNull();
    expect(resolveVars("var(--loop)", vars)).toBeNull();
  });
});
