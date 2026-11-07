interface Activity { playing: boolean; loading: boolean; preparing: string | null }
interface ActivityStore { getState(): Activity; subscribe(listener: (state: Activity) => void): () => void }

const busy = (s: Activity) => s.playing || s.loading || !!s.preparing;

/**
 * A deploy activates a new service worker in every open tab. Reloading at once
 * cut readings off mid-passage (the reader came back paused), so wait until
 * nothing is playing, loading, or being prepared.
 */
export function reloadWhenIdle(store: ActivityStore, reload = () => location.reload()) {
  if (!busy(store.getState())) return reload();
  const unsubscribe = store.subscribe((state) => {
    if (busy(state)) return;
    unsubscribe();
    reload();
  });
}
