import { createHash } from "node:crypto";
import type { PreparationRequest } from "./src/engine/preparation";

interface Profile {
  id: string;
  kind?: string;
  language?: string;
  instruct?: string;
  ref_text?: string;
  seed?: number;
  vd_states?: string;
  is_locked?: number;
}
interface Catalog {
  engines: { tts: { active: string; backends: { id: string; available?: boolean; supports_cloning?: boolean }[] } };
  profiles: Profile[];
}
export interface PreparationWorker {
  id: string;
  name: string;
  target: string;
  key: string;
  /** Readings it prepares at once, one passage each. */
  slots: number;
  /** It runs on the computer this server runs on, so it gives way when that computer is busy. */
  local: boolean;
}
/** Kubernetes and Compose services answer to a bare name; another computer has a dotted one. */
export const sharesHost = (target: string) => {
  const host = new URL(target).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || !host.includes(".");
};
const machine = (id: string, name: string, target: string, key: string, slots = 1): PreparationWorker =>
  ({ id, name, target, key, slots, local: sharesHost(target) });
/** Phonon is a speech server of its own: it renders its voices and nothing else. */
export const PHONON_ENGINE = "phonon";
export const PHONON_WORKER = "phonon";
export const forPhonon = (requests: PreparationRequest[]) => requests.some((item) => item.engine === PHONON_ENGINE);
const profileSignature = (profile: Profile) => JSON.stringify([
  profile.kind, profile.language, profile.instruct, profile.ref_text, profile.seed, profile.vd_states, profile.is_locked,
]);

/** Secondary machines may only render the same engine and voice recipe. Clone
 * reference audio is compared too; matching names or ids alone are insufficient. */
export class PreparationWorkers {
  readonly workers: PreparationWorker[];
  private catalogs = new Map<string, { expires: number; value: Promise<Catalog> }>();
  private references = new Map<string, { expires: number; value: Promise<string> }>();

  constructor(env: Record<string, string>) {
    const target = (env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/$/, "");
    this.workers = [machine("primary", env.VOICESTUDIO_NAME || "VoiceStudio", target, env.VOICESTUDIO_API_KEY || "")];
    const secondary = env.VOICESTUDIO_SECONDARY_URL?.replace(/\/$/, "");
    if (secondary && secondary !== target) this.workers.push(machine("secondary", env.VOICESTUDIO_SECONDARY_NAME || "Omarchy",
      secondary, env.VOICESTUDIO_SECONDARY_API_KEY || env.VOICESTUDIO_API_KEY || ""));
    // Phonon refuses a request beyond PTTS_MAX_CONCURRENT_REQUESTS (1 unless raised), so more
    // slots need that raised to match, plus one for someone listening.
    const phonon = env.PHONON_URL?.replace(/\/$/, "");
    if (phonon) this.workers.push(machine(PHONON_WORKER, "Phonon", phonon, env.PHONON_API_KEY || "",
      Math.max(1, Math.floor(Number(env.PHONON_PREPARATION_SLOTS)) || 1)));
  }

  /** The one machine that can take a reading, when its engine has a server of its own. */
  only(requests: PreparationRequest[]): PreparationWorker | undefined {
    return forPhonon(requests) ? this.workers.find((worker) => worker.id === PHONON_WORKER) : undefined;
  }

  private async fetch(worker: PreparationWorker, path: string) {
    const response = await fetch(`${worker.target}${path}`, {
      headers: worker.key ? { Authorization: `Bearer ${worker.key}` } : {}, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`VoiceStudio discovery failed (HTTP ${response.status}).`);
    return response;
  }

  private catalog(worker: PreparationWorker) {
    let cached = this.catalogs.get(worker.id);
    if (!cached || cached.expires <= Date.now()) {
      const value = Promise.all([
        this.fetch(worker, "/engines").then((response) => response.json() as Promise<Catalog["engines"]>),
        this.fetch(worker, "/profiles").then((response) => response.json() as Promise<Profile[]>),
      ]).then(([engines, profiles]) => ({ engines, profiles }));
      cached = { expires: Date.now() + 30_000, value };
      this.catalogs.set(worker.id, cached);
      void value.catch(() => { if (this.catalogs.get(worker.id)?.value === value) this.catalogs.delete(worker.id); });
    }
    return cached.value;
  }

  private reference(worker: PreparationWorker, voice: string) {
    const key = `${worker.id}:${voice}`;
    let cached = this.references.get(key);
    if (!cached || cached.expires <= Date.now()) {
      const value = this.fetch(worker, `/profiles/${encodeURIComponent(voice)}/audio`)
        .then((response) => response.arrayBuffer())
        .then((audio) => createHash("sha256").update(Buffer.from(audio)).digest("hex"));
      cached = { expires: Date.now() + 30_000, value };
      this.references.set(key, cached);
      void value.catch(() => { if (this.references.get(key)?.value === value) this.references.delete(key); });
    }
    return cached.value;
  }

  async supports(worker: PreparationWorker, requests: PreparationRequest[]): Promise<boolean> {
    if (worker.id === PHONON_WORKER || forPhonon(requests)) return worker.id === PHONON_WORKER && forPhonon(requests);
    if (worker.id === "primary") return true;
    try {
      const secondary = await this.catalog(worker);
      const voices = new Map(requests.filter((item) => !item.cached).map((item) => [`${item.protocol}|${item.engine}|${item.voice}|${!!item.profile}`, item]));
      for (const item of voices.values()) {
        if (item.protocol !== "openai") return false;
        const tts = secondary.engines.tts;
        const backend = tts.backends.find((engine) => engine.id === item.engine && engine.available);
        if (!backend) return false;
        if (!item.profile) continue;
        if (tts.active !== item.engine || !backend.supports_cloning) return false;
        const primary = await this.catalog(this.workers[0]);
        const source = primary.profiles.find((profile) => profile.id === item.voice);
        const destination = secondary.profiles.find((profile) => profile.id === item.voice);
        if (!source || !destination || profileSignature(source) !== profileSignature(destination)) return false;
        if (source.kind !== "design") {
          const [a, b] = await Promise.all([this.reference(this.workers[0], item.voice), this.reference(worker, item.voice)]);
          if (a !== b) return false;
        }
      }
      return true;
    } catch {
      // Discovery or authentication failures leave the reading queued for the
      // primary machine; they never substitute a different voice or engine.
      return false;
    }
  }
}
