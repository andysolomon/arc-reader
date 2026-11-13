import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { THEMES } from "@readaloud/tokens";
import { UsageMeter } from "../components/UsageMeter";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { ProgressRing } from "../components/ProgressRing";
import { ProgressBar } from "../components/ProgressBar";
import { ThemeSwatch } from "../components/ThemeSwatch";
import { Switch } from "../components/Switch";
import { Segmented } from "../components/Segmented";
import { Kbd } from "../components/Kbd";
import { SectionLabel } from "../components/SectionLabel";
import { Input } from "../components/Input";
import { VoiceAvatar } from "../components/VoiceAvatar";
import { ThemeIcon } from "../components/ThemeIcon";
import { PlayPauseIcon } from "../components/PlayPauseIcon";
import { Waveform } from "../components/Waveform";
import { VOICES } from "./fixtures";
import { Search } from "lucide-react";

const meta: Meta = { title: "Primitives/Misc" };
export default meta;

export const Usage: StoryObj = {
  render: () => (
    <div className="flex w-[520px] flex-col gap-4">
      <UsageMeter used={312450} limit={1000000} footer={<><span>Pro plan · renews Dec 1</span><button className="border-0 bg-transparent p-0 text-accent">Manage billing</button></>} />
      <UsageMeter used={960000} limit={1000000} />
      <UsageMeter used={0} limit={1000000} />
    </div>
  ),
};
export const Empty: StoryObj = {
  render: () => <EmptyState action={<button className="border-0 bg-transparent p-0 text-accent">Clear filters</button>}>Nothing here matches.</EmptyState>,
};
export const Skeletons: StoryObj = {
  render: () => (
    <div className="flex w-[480px] flex-col gap-3 font-serif text-[19px]">
      <p><Skeleton inline width="100%" /> <Skeleton inline width="70%" /></p>
      <Skeleton height={36} />
    </div>
  ),
};
export const Rings: StoryObj = {
  render: () => <div className="flex gap-4">{[0, 0.18, 0.4, 0.62, 0.85, 1].map((v) => <ProgressRing key={v} value={v} />)}</div>,
};
export const Bars: StoryObj = {
  render: () => <div className="flex w-80 flex-col gap-4">{[null, 0, 0.18, 0.62, 1].map((v) => <ProgressBar key={String(v)} value={v} label="Preparing" />)}</div>,
};
export const Swatches: StoryObj = {
  render: () => {
    const [t, setT] = useState("dark");
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {THEMES.map((th) => <ThemeSwatch key={th.id} theme={th} selected={t === th.id} onSelect={() => { setT(th.id); document.documentElement.dataset.theme = th.id; }} />)}
      </div>
    );
  },
};
export const Controls: StoryObj = {
  render: () => {
    const [on, setOn] = useState(true);
    const [sp, setSp] = useState(1);
    return (
      <div className="flex flex-col gap-5">
        <SectionLabel>Playback</SectionLabel>
        <div className="flex items-center gap-4"><Switch checked={on} onChange={setOn} label="Auto-play on share" /><Switch checked={false} onChange={() => {}} label="Disabled" disabled /></div>
        <Segmented value={sp} onChange={setSp} label="Default speed" options={[0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${v}×` }))} />
        <div className="flex gap-2"><Kbd>Space</Kbd><Kbd>⌘ ↵</Kbd><Kbd>Esc</Kbd></div>
        <Input leading={<Search size={16} strokeWidth={1.5} />} placeholder="Search  /" wrapperClassName="w-[240px]" />
        <Input type="email" placeholder="you@example.com" className="w-[320px]" />
      </div>
    );
  },
};
export const Icons: StoryObj = {
  render: () => {
    const [playing, setPlaying] = useState(false);
    const [light, setLight] = useState(false);
    return (
      <div className="flex items-center gap-6">
        <button className="grid size-12 place-items-center rounded-full border-0 bg-accent text-accent-fg" onClick={() => setPlaying((p) => !p)} aria-label="Toggle"><PlayPauseIcon playing={playing} /></button>
        <button className="grid size-10 place-items-center rounded-control border border-line bg-bg2" onClick={() => setLight((p) => !p)} aria-label="Theme"><ThemeIcon scheme={light ? "light" : "dark"} /></button>
        <Waveform active={playing} />
        {VOICES.map((v) => <VoiceAvatar key={v.id} voice={v} size={36} />)}
      </div>
    );
  },
};
