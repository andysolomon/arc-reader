import { useEffect, useState } from "react";
import { audioCache } from "../lib/db";
import { audioLimitFor } from "../lib/audioLimit";
import { learnRates, type AudioRates } from "../lib/audioSize";
import { planReading } from "../lib/prepared";
import { deviceStorage } from "../lib/storage";
import { useLibrary } from "./library";
import { useSettings } from "./settings";

export interface DeviceAudio {
  /** Keys of the clips saved on this device */
  saved: Set<string>;
  /** Each voice's bytes per character, learned from those clips */
  rates: AudioRates;
  /** Bytes of audio saved, as last measured */
  used: number;
  /** Bytes of audio this device keeps before removing the oldest */
  limit: number;
}

/** Passages are saved in bursts: look again at most this often. */
const REFRESH_MS = 3_000;
/** Learning reads every clip's size, so do it less often: rates move slowly. */
const RELEARN_MS = 60_000;

/** What audio this device holds, for estimating what more would take. Null until measured, and while not `wanted`. */
export function useDeviceAudio(wanted: boolean): DeviceAudio | null {
  const [audio, setAudio] = useState<DeviceAudio | null>(null);
  const choice = useSettings((s) => s.audioLimit);
  useEffect(() => {
    if (!wanted) { setAudio(null); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let learned: { at: number; rates: AudioRates; used: number; limit: number } | null = null;
    const refresh = async () => {
      try {
        if (!learned || Date.now() - learned.at > RELEARN_MS) {
          const [sizes, storage] = await Promise.all([audioCache.sizes(), deviceStorage()]);
          learned = { at: Date.now(), rates: learnRates(useLibrary.getState().items.map((it) => planReading(it.rec)), sizes),
            used: [...sizes.values()].reduce((a, b) => a + b, 0), limit: audioLimitFor(storage.allowed, choice) };
          if (live) setAudio({ saved: new Set(sizes.keys()), rates: learned.rates, used: learned.used, limit: learned.limit });
          return;
        }
        const keys = await audioCache.keys();
        if (live) setAudio({ saved: new Set(keys), rates: learned.rates, used: learned.used, limit: learned.limit });
      } catch { /* storage unavailable: no estimate */ }
    };
    void refresh();
    const unsubscribe = audioCache.subscribe(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void refresh(); }, REFRESH_MS);
    });
    return () => { live = false; unsubscribe(); clearTimeout(timer); };
  }, [wanted, choice]);
  return audio;
}
