/** How much downloaded audio to keep, in GB, or "max": half of what the browser allows this site. Chosen in Settings → Storage. */
export const AUDIO_LIMIT_CHOICES = [1, 2, 5, 10, 20, "max"] as const;
export type AudioLimitChoice = (typeof AUDIO_LIMIT_CHOICES)[number];
export const DEFAULT_AUDIO_LIMIT: AudioLimitChoice = 1;
export const isAudioLimitChoice = (value: unknown): value is AudioLimitChoice => AUDIO_LIMIT_CHOICES.includes(value as AudioLimitChoice);

const GB = 1024 ** 3;

/** The most audio may take: half of what the browser allows this site, so documents and unsynced changes still have room. */
export const mostAudioFor = (allowed?: number) => (allowed ? Math.floor(allowed / 2) : undefined);

/** Bytes of audio to keep for a choice. Never more than half of what the browser allows; "max" is 1 GB when the browser can't say. */
export function audioLimitFor(allowed: number | undefined, choice: AudioLimitChoice): number {
  const most = mostAudioFor(allowed);
  if (choice === "max") return most ?? GB;
  return most === undefined ? choice * GB : Math.min(choice * GB, most);
}

/** The choices worth offering: amounts the browser allows, then "max". A choice past it would only mean "max". */
export const audioLimitChoicesFor = (allowed?: number) => {
  const most = mostAudioFor(allowed);
  return AUDIO_LIMIT_CHOICES.filter((choice) => choice === "max" || most === undefined || choice * GB < most);
};
