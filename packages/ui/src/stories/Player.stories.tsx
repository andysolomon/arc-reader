import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PlayerPill } from "../components/PlayerPill";
import { PlayerBar } from "../components/PlayerBar";
import type { PlayerProps } from "../components/PlayerControls";
import { VOICES } from "./fixtures";

function usePlayerProps(over: Partial<PlayerProps> = {}): PlayerProps {
  const [playing, setPlaying] = useState(over.playing ?? false);
  const [speed, setSpeed] = useState(over.speed ?? 1);
  const [progress, setProgress] = useState(over.progress ?? 0.37);
  const [menuOpen, setMenu] = useState(over.menuOpen ?? false);
  return {
    voice: VOICES[0],
    playing,
    speed,
    progress,
    ticks: [0.12, 0.3, 0.46, 0.61, 0.8, 0.9],
    elapsed: 412 * progress,
    remaining: 412 * (1 - progress),
    onToggle: () => setPlaying((p) => !p),
    onPrev: () => setProgress((p) => Math.max(0, p - 0.1)),
    onNext: () => setProgress((p) => Math.min(1, p + 0.1)),
    onSeek: setProgress,
    onSpeed: setSpeed,
    onVoice: () => {},
    onDownload: () => {},
    onShare: () => {},
    onAddToLibrary: () => {},
    onChangeVoice: () => {},
    menuOpen,
    onMenuOpenChange: setMenu,
    ...over,
    loading: over.loading,
  };
}

const Frame = ({ children }: { children: React.ReactNode }) => <div className="relative h-[260px] w-full overflow-hidden rounded-card border border-line bg-bg">{children}</div>;

const meta: Meta = { title: "Player/PlayerPill" };
export default meta;

export const Paused: StoryObj = { render: () => { const p = usePlayerProps(); return <Frame><PlayerPill {...p} /></Frame>; } };
export const Playing: StoryObj = { render: () => { const p = usePlayerProps({ playing: true }); return <Frame><PlayerPill {...p} /></Frame>; } };
export const Loading: StoryObj = { render: () => { const p = usePlayerProps({ loading: true, progress: 0 }); return <Frame><PlayerPill {...p} /></Frame>; } };
export const MenuOpen: StoryObj = { render: () => { const p = usePlayerProps({ menuOpen: true }); return <Frame><PlayerPill {...p} /></Frame>; } };
export const LocalVoice: StoryObj = { render: () => { const p = usePlayerProps({ voice: VOICES[2] }); return <Frame><PlayerPill {...p} /></Frame>; } };
export const Bar: StoryObj = { name: "PlayerBar", render: () => { const p = usePlayerProps({ playing: true }); return <Frame><PlayerBar {...p} /></Frame>; } };
export const BarCompact: StoryObj = { name: "PlayerBar · compact (mobile)", render: () => { const p = usePlayerProps({ playing: true }); return <div className="relative h-[260px] w-[360px] overflow-hidden rounded-card border border-line bg-bg"><PlayerBar {...p} compact /></div>; } };
