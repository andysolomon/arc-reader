import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idPath, studioUrl, type Archetype } from "../lib/studio";

// Scope recipes to their catalog, separate from imported profile/engine voice IDs.
export const galleryFavoriteKey = (id: string) => studioUrl(`/archetypes/${idPath(id)}`);

interface GalleryState {
  favorites: Record<string, Archetype>;
  toggleFavorite: (voice: Archetype) => void;
}

export const useGallery = create<GalleryState>()(persist((set) => ({
  favorites: {},
  toggleFavorite: (voice) => set((state) => {
    const favorites = { ...state.favorites };
    const key = galleryFavoriteKey(voice.id);
    if (favorites[key]) delete favorites[key];
    else favorites[key] = voice;
    return { favorites };
  }),
}), {
  name: "readaloud:gallery",
  partialize: ({ favorites }) => ({ favorites }),
}));
