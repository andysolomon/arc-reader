import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchReadable, hostOf, isWebAddress, normalizeUrl } from "../lib/fetchUrl";
import { EXPLAIN_MS, ReadError } from "../lib/readError";
import { openDocument } from "../lib/openDoc";
import { useLibrary } from "../state/library";
import { importPage, isContentsPage } from "../state/books";
import { toast } from "../state/toast";

export interface ClipboardImport {
  busy: boolean;
}

export const ClipboardImportContext = createContext<ClipboardImport | null>(null);

export function useClipboardImport() {
  const value = useContext(ClipboardImportContext);
  if (!value) throw new Error("Clipboard import requires Shell");
  return value;
}

/** Pasting outside a text field opens the text (or fetched article) in the reader, one import at a time. */
export function useClipboardImportController(enabled: boolean): ClipboardImport {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const importing = useRef(false);

  const importText = useCallback(async (read: () => Promise<string>) => {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    let failure = "Couldn't open clipboard text. Please try again";
    try {
      const text = (await read()).trim();
      if (!text) return;
      const create = useLibrary.getState().create;
      let rec;
      let listen = true;
      if (isWebAddress(text)) {
        const host = hostOf(normalizeUrl(text));
        failure = `Couldn't read ${host} — try copying the article text`;
        toast(`Fetching ${host}…`);
        const article = await fetchReadable(text);
        rec = await importPage(article, { source: "url" });
        listen = !isContentsPage(article);
      } else {
        rec = await create({ text, source: "paste" });
      }
      await openDocument(rec, navigate, { autoplay: listen, resume: false, prepare: listen });
    } catch (e) {
      if (e instanceof ReadError) toast(e.message, EXPLAIN_MS);
      else toast(failure);
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }, [navigate]);

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

  return { busy };
}
