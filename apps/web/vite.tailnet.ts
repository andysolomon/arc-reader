import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

/**
 * Prints the tailnet URL next to Vite's Local URL, for `vite` and `vite preview`.
 * The address is read at startup from `tailscale serve status`, so no hostname is
 * hard-coded. Prints nothing when Tailscale isn't installed.
 */

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c("32"), cyan = c("36"), bold = c("1"), dim = c("2");

type ServeStatus = { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };

function tailscale(args: string[]): string | null {
  try {
    return execFileSync("tailscale", args, { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function findTailnetUrl(localPort: number): { url: string | null; available: boolean } {
  const raw = tailscale(["serve", "status", "--json"]);
  if (raw === null) return { url: null, available: false };
  let status: ServeStatus = {};
  try {
    status = JSON.parse(raw || "{}") as ServeStatus;
  } catch {
    return { url: null, available: true };
  }
  const target = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${localPort}/?$`);
  for (const [hostPort, web] of Object.entries(status.Web ?? {})) {
    for (const h of Object.values(web.Handlers ?? {})) {
      if (h.Proxy && target.test(h.Proxy)) {
        const [host, port] = hostPort.split(":");
        return { url: port && port !== "443" ? `https://${host}:${port}/` : `https://${host}/`, available: true };
      }
    }
  }
  return { url: null, available: true };
}

function line(localPort: number | undefined): string | null {
  if (!localPort) return null;
  const { url, available } = findTailnetUrl(localPort);
  if (!available) return null;
  if (!url) {
    return `  ${green("➜")}  ${bold("Tailnet")}: ${dim(`not published · tailscale serve --bg --https=<port> http://127.0.0.1:${localPort}`)}`;
  }
  const m = url.match(/^(https:\/\/[^:/]+:)(\d+)(\/)$/);
  const pretty = m ? cyan(m[1]) + cyan(bold(m[2])) + cyan(m[3]) : cyan(url);
  return `  ${green("➜")}  ${bold("Tailnet")}: ${pretty}`;
}

export function tailnetUrl(): Plugin {
  return {
    name: "readaloud:tailnet-url",
    configureServer(server) {
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        print();
        const l = line(server.config.server.port);
        if (l) server.config.logger.info(l);
      };
    },
    configurePreviewServer(server) {
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        print();
        const l = line(server.config.preview.port);
        if (l) server.config.logger.info(l);
      };
    },
  };
}
