import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@readaloud/ui";
import { useSettings } from "../state/settings";
import { useLibrary } from "../state/library";
import { normalizeAppServer } from "../lib/appServer";
import { reconnectLibrary, useLibrarySync } from "../lib/librarySync";

export function AppServerSettings() {
  const saved = useSettings((s) => s.appServer);
  const [address, setAddress] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = useLibrarySync();
  useEffect(() => { setAddress(saved); }, [saved]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeAppServer(address);
    if (!normalized) {
      setError("Use the website’s http or https address, including its port, without a page or API path.");
      return;
    }
    setError(null);
    setBusy(true);
    setAddress(normalized);
    const changed = normalized !== saved;
    useSettings.getState().set("appServer", normalized);
    if (changed) {
      // Restart all catalogues, requests and screens against the new connection.
      // Library edits are already durable in IndexedDB and sync on startup.
      window.location.reload();
      return;
    }
    try {
      await reconnectLibrary();
      await useLibrary.getState().refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => { void connect(event); }}>
      <p className="m-0 text-[13px] text-fg2">
        Use the same Arc Reader website as your computer for your library, all voices, prepared audio, Studio, summaries and article imports. Documents and listening progress merge with that shared library. Turn on Tailscale on your iPhone to reach a .ts.net address. Changing the address restarts the app; saved readings remain on this device.
      </p>
      <label htmlFor="library-server" className="text-[13px]">Website address</label>
      <Input id="library-server" value={address} onChange={(event) => setAddress(event.target.value)}
        disabled={busy} placeholder="https://omarchy.tail1b9428.ts.net:8449" inputMode="url"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <Button type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
      {error && <p role="alert" className="m-0 text-[13px] text-accent">{error}</p>}
      <p role="status" className="m-0 text-[13px] text-fg2">
        {sync.status === "synced" ? `Connected · ${sync.documents} ${sync.documents === 1 ? "document" : "documents"}`
          : sync.status === "syncing" ? "Syncing library…" : sync.error}
      </p>
    </form>
  );
}
