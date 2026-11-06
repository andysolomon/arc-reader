import { useState } from "react";
import { Button, Input } from "@readaloud/ui";
import { useLlm } from "../state/llm";
import { toast } from "../state/toast";

/** Enter, replace, or remove the OpenCode Go key. The key goes to this ReadAloud server, never back to the browser. */
export function LlmKeyField() {
  const config = useLlm((s) => s.config);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showForm = !config?.configured || editing;
  const close = () => { setEditing(false); setKey(""); setError(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await useLlm.getState().save(key);
      close();
      toast("OpenCode Go key saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the key.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await useLlm.getState().remove();
      toast("OpenCode Go key removed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove the key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div>OpenCode Go API key</div>
          <div className="text-[13px] text-fg2">
            {config?.configured && !editing
              ? `${config.source === "env" ? "Set on the server (LLM_API_KEY)" : "Saved on this server"} · ends in ${config.hint}`
              : "From the OpenCode console, or “key” under “opencode-go” in ~/.local/share/opencode/auth.json. It’s stored on this ReadAloud server, not in the browser."}
          </div>
        </div>
        {!showForm && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)} disabled={busy} className="bg-bg">Replace</Button>
            {config?.source === "saved" && <Button variant="danger" onClick={() => void remove()} loading={busy}>Remove</Button>}
          </div>
        )}
      </div>
      {showForm && (
        <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            aria-label="OpenCode Go API key"
            placeholder="Paste your API key"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "llm-key-error" : undefined}
            className="min-w-0 flex-1 bg-bg font-mono text-[13px]"
          />
          <Button type="submit" variant="primary" size="md" loading={busy} disabled={!key.trim()}>Save</Button>
          {editing && <Button size="md" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>}
          {error && <p id="llm-key-error" role="alert" className="m-0 w-full text-[13px] text-danger">{error}</p>}
        </form>
      )}
    </div>
  );
}
