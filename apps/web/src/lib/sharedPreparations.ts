import type { Voice } from "../data/voices";
import type { SharedPreparation } from "../engine/preparation";
import { cacheKey } from "../engine/providers";
import type { PreparationJob } from "../state/preparation";
import type { DocRecord } from "./db";
import { planPassages, segment } from "./segment";

/** Match by all passage keys, so changed text never inherits another reading's status. */
export function sharedPreparationJobs(records: DocRecord[], catalogue: SharedPreparation[], voiceFor: (id: string) => Voice): PreparationJob[] {
  const jobs: PreparationJob[] = [];
  for (const rec of records) {
    const passages = planPassages(segment(rec.text).sentences);
    const expected = new Map<string, string[]>();
    const seen = new Set<string>();
    // Prefer a current reading, then the newest completed reading for each voice.
    const ordered = [...catalogue].sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || b.createdAt - a.createdAt);
    for (const reading of ordered) {
      const voiceKey = `${reading.engine}|${reading.voice}`;
      if (seen.has(voiceKey) || reading.keys.length !== passages.length) continue;
      let keys = expected.get(voiceKey);
      if (!keys) {
        keys = passages.map((passage) => cacheKey({ text: passage.text, voice: reading.voice, engine: reading.engine }));
        expected.set(voiceKey, keys);
      }
      if (!keys.every((key, index) => key === reading.keys[index])) continue;
      seen.add(voiceKey);
      jobs.push({
        id: `shared:${reading.id}:${rec.id}`, serverId: reading.id, remote: true,
        docId: rec.id, title: rec.title,
        voice: { ...voiceFor(reading.voice), engine: reading.engine },
        openaiModel: "", wordTimings: false,
        status: reading.state === "done" ? "ready" : reading.state === "cancelled" ? "cancelled" : reading.state === "error" ? "error" : reading.queued ? "queued" : "preparing",
        done: reading.done, total: reading.total, worker: reading.worker,
        message: reading.error || (reading.state === "done" && reading.available.length < reading.total ? "Some audio remains on the original device" : undefined),
      });
    }
  }
  return jobs;
}
