import { describe, expect, it } from "vitest";
import { publicUrl } from "./capacitor.config";
import { shellFallback, unreachablePage } from "./vite.shell";

describe("iOS shell loading from a server", () => {
  it("reduces the setting to an origin, and treats empty as bundled", () => {
    expect(publicUrl(" https://host.tailnet.ts.net:8449/ ")).toBe("https://host.tailnet.ts.net:8449");
    expect(publicUrl("https://host.tailnet.ts.net/app")).toBe("https://host.tailnet.ts.net");
    expect(publicUrl("")).toBe("");
    expect(publicUrl(undefined)).toBe("");
  });

  it("rejects a setting the web view could not load", () => {
    expect(() => publicUrl("host.tailnet.ts.net:8449")).toThrow(/READALOUD_PUBLIC_URL/);
    expect(() => publicUrl("capacitor://localhost")).toThrow(/http/);
  });

  it("names the server on the fallback page and retries it", () => {
    const html = unreachablePage("https://host.tailnet.ts.net:8449");
    expect(html).toContain("host.tailnet.ts.net:8449</span>");
    expect(html).toContain('var server = "https://host.tailnet.ts.net:8449";');
  });

  it("builds the fallback page only when a server is set", () => {
    const emitted = (serverUrl: string) => {
      const files: string[] = [];
      const plugin = shellFallback(serverUrl, "unreachable.html");
      (plugin.generateBundle as (this: unknown) => void).call({ emitFile: (f: { fileName: string }) => files.push(f.fileName) });
      return files;
    };
    expect(emitted("https://host.tailnet.ts.net:8449")).toEqual(["unreachable.html"]);
    expect(emitted("")).toEqual([]);
  });
});
