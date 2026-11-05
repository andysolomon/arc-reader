import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchReadable, hostOf } from "../lib/fetchUrl";
import { openDocument } from "../lib/openDoc";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";

export interface ClipboardImport {
  busy: boolean;
  readClipboard: () => Promise<void>;
}

export const ClipboardImportContext = createContext<ClipboardImport | null>(null);

export function useClipboardImport() {
  const value = useContext(ClipboardImportContext);
  if (!value) throw new Error("Clipboard import requires Shell");
  return value;
}

/** One import at a time, shared by the navigation, composer, and native paste. */
export function useClipboardImportController(enabled: boolean): ClipboardImport {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const importing = useRef(false);

  const importText = useCallback(async (read: () => Promise<string>) => {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    let failure = "Clipboard blocked — paste outside a text field";
    try {
      const text = (await read()).trim();
      if (!text) {
        toast("Clipboard is empty");
        return;
      }
      failure = "Couldn't open clipboard text. Please try again";
      const create = useLibrary.getState().create;
      let rec;
      if (/^https?:\/\/\S+$/i.test(text)) {
        failure = `Couldn't read ${hostOf(text)} — try copying the article text`;
        toast(`Fetching ${hostOf(text)}…`);
        const article = await fetchReadable(text);
        rec = await create({ ...article, source: "url" });
      } else {
        rec = await create({ text, source: "paste" });
      }
      await openDocument(rec, navigate, { autoplay: true, resume: false });
    } catch {
      toast(failure);
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }, [navigate]);

  const readClipboard = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      toast("Clipboard unavailable — paste outside a text field");
      return;
    }
    await importText(() => navigator.clipboard.readText());
  }, [importText]);

  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], [role='dialog'], dialog"))) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text?.trim()) return;
      event.preventDefault();
      void importText(() => Promise.resolve(text));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled, importText]);

  return { busy, readClipboard };
}
