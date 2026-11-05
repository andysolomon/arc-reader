import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { VoiceCard } from "../components/VoiceCard";
import { VOICES } from "./fixtures";

const meta: Meta<typeof VoiceCard> = { title: "Voices/VoiceCard", component: VoiceCard, args: { voice: VOICES[0], onPreview: () => {}, onSelect: () => {} } };
export default meta;
type S = StoryObj<typeof VoiceCard>;
export const Idle: S = { render: (a) => <div className="w-[240px]"><VoiceCard {...a} /></div> };
export const Selected: S = { args: { selected: true }, render: (a) => <div className="w-[240px]"><VoiceCard {...a} /></div> };
export const Previewing: S = { args: { previewing: true }, render: (a) => <div className="w-[240px]"><VoiceCard {...a} /></div> };
export const Local: S = { args: { voice: VOICES[2] }, render: (a) => <div className="w-[240px]"><VoiceCard {...a} /></div> };
export const Grid: S = {
  render: () => {
    const [sel, setSel] = useState("ava");
    const [pv, setPv] = useState<string | null>(null);
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
        {VOICES.map((v) => (
          <VoiceCard key={v.id} voice={v} selected={sel === v.id} previewing={pv === v.id} onSelect={() => setSel(v.id)} onPreview={() => { setPv(v.id); setTimeout(() => setPv(null), 3000); }} />
        ))}
      </div>
    );
  },
};
