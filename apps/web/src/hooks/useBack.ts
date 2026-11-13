import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

/** Where each history entry sits, by its key, for as long as the page stays loaded. */
const positions = new Map<string, number>();
let current = 0;
/** The last screen that was not a document: where Back from a document leads. */
let origin: { index: number; path: string } | null = null;

const isDocument = (pathname: string) => pathname.startsWith("/read/");

/** Follow the history stack so a document knows which screen it was opened from. Mounted once, in the Shell. */
export function useHistoryTrail() {
  const { key, pathname, search } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    const known = positions.get(key);
    if (known !== undefined) current = known;
    else if (type === "POP") {
      // First load, or an entry from before a reload: nothing earlier can be trusted.
      positions.clear();
      origin = null;
      current = 0;
      positions.set(key, 0);
    } else {
      if (type === "PUSH") current += 1;
      // A push drops the entries ahead; a replace takes over the current one.
      for (const [k, index] of positions) if (index >= current) positions.delete(k);
      positions.set(key, current);
    }
    if (!isDocument(pathname)) origin = { index: current, path: pathname + search };
  }, [key, type, pathname, search]);
}

/**
 * Leave a document for the screen it was opened from, stepping back through history so that
 * screen is as it was left. Chapters opened along the way are skipped.
 */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    if (origin && origin.index < current) navigate(origin.index - current);
    else navigate(origin?.path ?? fallback);
  };
}
