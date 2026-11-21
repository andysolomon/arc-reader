import type { AudioNotice } from "./db";

/** What the browser reports about this site's storage. Fields it cannot report are absent. */
export interface DeviceStorage {
  /** Bytes this site uses: documents, audio, settings and the app's own files. */
  used?: number;
  /** Bytes the browser allows this site before saves start failing. */
  allowed?: number;
  /** Whether the browser keeps this site's storage when the device runs low on space; absent when it cannot say. */
  kept?: boolean;
}

const manager = () => (typeof navigator === "undefined" ? undefined : navigator.storage);

export async function deviceStorage(): Promise<DeviceStorage> {
  const storage = manager();
  const [estimate, kept] = await Promise.all([
    storage?.estimate?.().catch(() => undefined),
    storage?.persisted?.().catch(() => undefined),
  ]);
  return {
    ...(estimate?.usage !== undefined && { used: estimate.usage }),
    ...(estimate?.quota ? { allowed: estimate.quota } : {}),
    ...(kept !== undefined && { kept }),
  };
}

/**
 * Ask the browser to keep this site's storage when the device runs low on space. Without it,
 * everything saved here (downloaded audio, changes not yet synced, settings) can be cleared.
 * The browser decides, and may ask the person; false means it declined or cannot.
 */
export async function keepStorage(): Promise<boolean> {
  const storage = manager();
  try {
    return (await storage?.persisted?.()) || (await storage?.persist?.()) || false;
  } catch {
    return false;
  }
}

const KB = 1024, MB = KB * 1024, GB = MB * 1024;

/** A size as people read it: "640 KB", "148 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  // Each unit takes over where the one below would round up to 1024.
  if (bytes >= GB - MB / 2) return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1).replace(/\.0$/, "")} GB`;
  if (bytes >= MB - KB / 2) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return bytes > 0 ? "Under 1 KB" : "0 MB";
}

/** What to tell the person when saved audio was removed to make room, or could not be saved. */
export function audioNoticeMessage(notice: AudioNotice): string {
  if (notice.kind === "full") return "This device is out of space for downloaded audio. Remove some in Settings.";
  const clips = notice.clips === 1 ? "1 older audio clip" : `${notice.clips.toLocaleString()} older audio clips`;
  return `Removed ${clips} to stay under ${formatBytes(notice.limit)}`;
}
