import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export type Breakpoint = "sm" | "md" | "lg";

/** sm: < 640px, md: 640–1024px, lg: > 1024px */
export function useBreakpoint(): Breakpoint {
  const sm = useMedia("(max-width: 639.98px)");
  const lg = useMedia("(min-width: 1025px)");
  return sm ? "sm" : lg ? "lg" : "md";
}

export const useIsTouch = () => useMedia("(pointer: coarse)");
