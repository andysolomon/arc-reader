import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePlayer } from "../state/player";

export const FOCUS_SEARCH_EVENT = "readaloud:focus-search";

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
}

/** Global keyboard map. Ignored while typing, except Esc (and ⌘↵, handled by Compose). */
export function useShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = usePlayer.getState();
      if (e.key === "Escape") {
        if (p.focus || p.shortcutsOpen || p.menuOpen) {
          e.preventDefault();
          usePlayer.setState({ focus: false, shortcutsOpen: false, menuOpen: false });
        }
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        p.setShortcutsOpen(!p.shortcutsOpen);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        if (pathname !== "/library") navigate("/library");
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)), 60);
        return;
      }
      if (!p.doc) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          p.toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          p.prev();
          break;
        case "ArrowRight":
          e.preventDefault();
          p.next();
          break;
        case "[":
          e.preventDefault();
          p.nudgeSpeed(-0.25);
          break;
        case "]":
          e.preventDefault();
          p.nudgeSpeed(0.25);
          break;
        case "f":
        case "F":
          if (pathname.startsWith("/read/")) {
            e.preventDefault();
            p.setFocus(!p.focus);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);
}
