import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (m: string) => void;
  clear: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
export const TOAST_MS = 2200;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (m) => {
    if (timer) clearTimeout(timer);
    set({ message: m });
    timer = setTimeout(() => set({ message: null }), TOAST_MS);
  },
  clear: () => {
    if (timer) clearTimeout(timer);
    set({ message: null });
  },
}));

export const toast = (m: string) => useToast.getState().show(m);
