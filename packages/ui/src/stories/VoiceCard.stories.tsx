import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Mic, Trash2, Undo2 } from "lucide-react";
import { VoiceCard } from "../components/VoiceCard";
import { VOICES } from "./fixtures";

const meta: Meta<typeof VoiceCard> = { title: "Voices/VoiceCard", component: VoiceCard, args: { voice: VOICES[0], onPreview: () => {}, onSelect: () => {} } };
export default meta;
type S = StoryObj<typeof VoiceCard>;
export const Idle: S = { render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div> };
export const Selected: S = { args: { selected: true }, render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div> };
export const Previewing: S = { args: { previewing: true }, render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div> };
export const Demotable: S = { args: { voice: { ...VOICES[0], tags: ["designed"] }, actions: [{ label: "Send Ava back to Studio", icon: <Undo2 size={16} strokeWidth={1.5} aria-hidden />, onClick: () => {} }] }, render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div> };
export const Cloned: S = {
  args: {
    voice: { ...VOICES[0], name: "My narrator", tags: ["cloned"] },
    actions: [
      { label: "Re-record My narrator", icon: <Mic size={16} strokeWidth={1.5} aria-hidden />, onClick: () => {} },
      { label: "Delete My narrator", icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />, onClick: () => {}, danger: true },
    ],
  },
  render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div>,
};
export const Generating: S = { args: { previewing: true, generating: true }, render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div> };
export const Local: S = { args: { voice: VOICES[2] }, render: (a) => <div className="w-[180px]"><VoiceCard {...a} /></div> };
export const Grid: S = {
  render: () => {
    const [sel, setSel] = useState("ava");
    const [pv, setPv] = useState<string | null>(null);
    return (
      <div className="grid grid-cols-2 gap-1 rounded-panel border border-line bg-bg2 p-2 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-2 sm:p-4">
        {VOICES.map((v) => (
          <VoiceCard key={v.id} voice={v} selected={sel === v.id} previewing={pv === v.id} onSelect={() => setSel(v.id)} onPreview={() => { setPv(v.id); setTimeout(() => setPv(null), 3000); }} />
        ))}
      </div>
    );
  },
};
