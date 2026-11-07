import { useState } from "react";
import { Button, Input, cn } from "@readaloud/ui";
import type { StoreApi, UseBoundStore } from "zustand";
import { useLlm, type KeyState } from "../state/llm";
import { toast } from "../state/toast";

interface KeyFieldProps {
  store?: UseBoundStore<StoreApi<KeyState>>;
  /** Provider name, as in "OpenCode Go API key" */
  name?: string;
  envName?: string;
  /** Where to find a key */
  help?: string;
  /** Last row of its panel: no divider below */
  last?: boolean;
}

/** Enter, replace, or remove a provider key (OpenCode Go by default). The key goes to this ReadAloud server, never back to the browser. */
export function LlmKeyField({
  store = useLlm, name = "OpenCode Go", envName = "LLM_API_KEY",
  help = "From the OpenCode console, or “key” under “opencode-go” in ~/.local/share/opencode/auth.json.", last,
}: KeyFieldProps) {
  const config = store((s) => s.config);
  const id = `${envName.toLowerCase()}-error`;
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
      await store.getState().save(key);
      close();
      toast(`${name} key saved`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the key.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await store.getState().remove();
      toast(`${name} key removed`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove the key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-3 px-4 py-3.5", !last && "border-b border-line")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div>{name} API key</div>
          <div className="text-[13px] text-fg2">
            {config?.configured && !editing
              ? `${config.source === "env" ? `Set on the server (${envName})` : "Saved on this server"} · ends in ${config.hint}`
              : `${help} It’s stored on this ReadAloud server, not in the browser.`}
          </div>
        </div>
        {!showForm && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)} disabled={busy} className="bg-bg" aria-label={`Replace ${name} key`}>Replace</Button>
            {config?.source === "saved" && <Button variant="danger" onClick={() => void remove()} loading={busy} aria-label={`Remove ${name} key`}>Remove</Button>}
          </div>
        )}
      </div>
      {showForm && (
        <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            aria-label={`${name} API key`}
            placeholder="Paste your API key"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? id : undefined}
            className="min-w-0 flex-1 bg-bg font-mono text-[13px]"
          />
          <Button type="submit" variant="primary" size="md" loading={busy} disabled={!key.trim()}>Save</Button>
          {editing && <Button size="md" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>}
          {error && <p id={id} role="alert" className="m-0 w-full text-[13px] text-danger">{error}</p>}
        </form>
      )}
    </div>
  );
}
