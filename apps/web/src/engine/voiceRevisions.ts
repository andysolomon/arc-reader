/**
 * Which recording each re-recorded clone currently speaks with. A clone keeps its id
 * when its reference is replaced, so cached and prepared audio keys add the revision:
 * clips made with the old recording stop matching instead of replaying the old voice.
 * Remembered across reloads so a reading started before VoiceStudio answers still
 * looks up the new recording's clips.
 */
const STORAGE = "readaloud:voice-revisions";

function restore(): Record<string, string> {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE) || "{}") as unknown;
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, string> : {};
  } catch {
    return {};
  }
}

let revisions = restore();

export const voiceRevision = (id: string): string | undefined => revisions[id];

/** Replace the whole map with what VoiceStudio reports; voices missing from it lose their revision. */
export function setVoiceRevisions(next: Record<string, string>) {
  revisions = { ...next };
  save();
}

export function setVoiceRevision(id: string, revision: string) {
  revisions = { ...revisions, [id]: revision };
  save();
}

function save() {
  try {
    globalThis.localStorage?.setItem(STORAGE, JSON.stringify(revisions));
  } catch {
    /* private mode: the map still applies for this session */
  }
}

/** The voice id inside a cache key's voice field (`<id>@<revision>`); accent ids already use `~`. */
export const voiceIdOfKeyPart = (part: string) => part.split("@")[0];
