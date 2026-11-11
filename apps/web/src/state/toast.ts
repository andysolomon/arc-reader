import { create } from "zustand";

interface ToastState {
  message: string | null;
  /** The toast is a link to this address */
  href: string | null;
  show: (m: string, ms?: number, href?: string) => void;
  clear: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
export const TOAST_MS = 2200;

export const useToast = create<ToastState>((set) => ({
  message: null,
  href: null,
  show: (m, ms = TOAST_MS, href) => {
    if (timer) clearTimeout(timer);
    set({ message: m, href: href ?? null });
    timer = setTimeout(() => set({ message: null, href: null }), ms);
  },
  clear: () => {
    if (timer) clearTimeout(timer);
    set({ message: null, href: null });
  },
}));

export const toast = (m: string, ms?: number, href?: string) => useToast.getState().show(m, ms, href);
