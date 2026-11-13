import { create } from "zustand";
import { hasCuratedPortrait, voiceAvatarIdentity, type PortraitVoice } from "@readaloud/ui";
import { isBundledApp } from "../lib/native";
import { useVoices } from "./voices";

interface AvatarEntry {
  identity: string;
  status: "queued" | "generating" | "ready" | "failed";
  url?: string;
  error?: string;
  review?: { status: "reviewed" | "unavailable" | "not-configured"; warnings: string[] };
}
interface AvatarState {
  configured: boolean;
  entries: Record<string, AvatarEntry>;
  refresh: () => Promise<void>;
  ensure: (voice: PortraitVoice, retry?: boolean) => Promise<AvatarEntry>;
}
const inFlight = new Map<string, Promise<AvatarEntry>>();
export const useAvatars = create<AvatarState>((set, get) => ({
  configured: false,
  entries: {},
  async refresh() {
    const response = await fetch("/api/avatars/", { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) throw new Error("Avatar service is unavailable.");
    const data = await response.json() as { configured: boolean; records: AvatarEntry[] };
    set({ configured: data.configured, entries: Object.fromEntries(data.records.map((r) => [r.identity, r])) });
  },
  ensure(voice, retry = false) {
    const identity = voiceAvatarIdentity(voice);
    const existing = inFlight.get(identity);
    if (existing) return existing;
    const task = (async () => {
      const response = await fetch("/api/avatars/ensure", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voice, retry }), signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json() as AvatarEntry & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not create avatar.");
      set({ entries: { ...get().entries, [identity]: result } });
      return result;
    })().finally(() => inFlight.delete(identity));
    inFlight.set(identity, task);
    return task;
  },
}));

/** Catalog changes cover cloning, designing, gallery additions and new engine voices. */
export function startAvatarSync() {
  if (isBundledApp()) return () => {};
  let stopped = false, busy = false, again = false;
  const sync = async () => {
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      await useAvatars.getState().refresh();
      const catalog = useVoices.getState();
      if (catalog.loaded && useAvatars.getState().configured) {
        for (const voice of catalog.voices) {
          if (stopped) break;
          if (voice.kind === "local" || hasCuratedPortrait(voice) || useAvatars.getState().entries[voiceAvatarIdentity(voice)]) continue;
          await useAvatars.getState().ensure(voice);
        }
      }
    } catch { /* Offline, older servers, or no key: keep the local illustration. */ }
    finally {
      busy = false;
      if (again && !stopped) { again = false; void sync(); }
    }
  };
  const unsubscribe = useVoices.subscribe((state, previous) => {
    if (state.voices !== previous.voices || state.loaded !== previous.loaded) void sync();
  });
  const timer = setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 10_000);
  const visible = () => { if (document.visibilityState === "visible") void sync(); };
  document.addEventListener("visibilitychange", visible);
  void sync();
  return () => { stopped = true; unsubscribe(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
}

export function avatarReviewNote(entry: AvatarEntry | undefined): string | undefined {
  const warnings = entry?.review?.warnings ?? [];
  if (warnings.some((w) => w === "gender-conflicting" || w === "age-conflicting")) return "Voice description has conflicting age or gender details; explicit settings were kept.";
  if (warnings.includes("similarity-review")) return "Avatar design may resemble another voice.";
  if (warnings.includes("gender-missing") && warnings.includes("age-missing")) return "Voice description may be missing age and gender details.";
  if (warnings.includes("gender-missing")) return "Voice description may be missing gender details.";
  if (warnings.includes("age-missing")) return "Voice description may be missing age details.";
  return undefined;
}
