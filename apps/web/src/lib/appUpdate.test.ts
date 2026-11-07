import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { reloadWhenIdle } from "./appUpdate";

const store = (playing: boolean) => create(() => ({ playing, loading: false, preparing: null as string | null }));

describe("reloadWhenIdle", () => {
  it("reloads at once when nothing is playing", () => {
    const reload = vi.fn();
    reloadWhenIdle(store(false), reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits until playback, loading, and preparation have all stopped", () => {
    const s = store(true);
    const reload = vi.fn();
    reloadWhenIdle(s, reload);
    // Between passages the engine keeps `playing` and may wait on the next clip.
    s.setState({ loading: true });
    s.setState({ loading: false, preparing: "Preparing image and diagram descriptions…" });
    s.setState({ preparing: null });
    expect(reload).not.toHaveBeenCalled();
    s.setState({ playing: false });
    s.setState({ playing: true });
    s.setState({ playing: false });
    expect(reload).toHaveBeenCalledOnce();
  });
});
