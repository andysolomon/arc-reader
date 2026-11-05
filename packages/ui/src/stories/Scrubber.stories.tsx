import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Scrubber } from "../components/Scrubber";

const meta: Meta<typeof Scrubber> = { title: "Player/Scrubber", component: Scrubber };
export default meta;
type S = StoryObj<typeof Scrubber>;
export const Interactive: S = {
  render: () => {
    const [v, setV] = useState(0.4);
    return <div className="w-[420px] rounded-pill border border-line bg-bg2 px-4"><Scrubber value={v} ticks={[0.1, 0.25, 0.5, 0.7, 0.9]} onSeek={setV} valueText={`${Math.round(v * 100)}%`} /></div>;
  },
};
export const Empty: S = { args: { value: 0, ticks: [], onSeek: () => {} }, render: (a) => <div className="w-[420px]"><Scrubber {...a} /></div> };
export const Disabled: S = { args: { value: 0.5, ticks: [0.5], onSeek: () => {}, disabled: true }, render: (a) => <div className="w-[420px]"><Scrubber {...a} /></div> };
