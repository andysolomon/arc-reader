import { useEffect, useMemo, type ReactNode } from "react";
import { VoiceAvatarImages } from "@readaloud/ui";
import { startAvatarSync, useAvatars } from "../state/avatars";

export function AvatarProvider({ children }: { children: ReactNode }) {
  const entries = useAvatars((s) => s.entries);
  useEffect(startAvatarSync, []);
  const images = useMemo(() => Object.fromEntries(Object.entries(entries).flatMap(([identity, r]) => r.url ? [[identity, r.url]] : [])), [entries]);
  return <VoiceAvatarImages.Provider value={images}>{children}</VoiceAvatarImages.Provider>;
}
