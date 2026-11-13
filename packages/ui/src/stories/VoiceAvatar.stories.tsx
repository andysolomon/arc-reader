import type { Meta, StoryObj } from "@storybook/react-vite";
import { VoiceAvatar } from "../components/VoiceAvatar";
import { VOICE_PORTRAITS, voicePortrait } from "../lib/voicePortraits";

const bella = { id: "expr-voice-2-f", name: "Bella", engine: "kittentts", hue: 30 };
const meta: Meta<typeof VoiceAvatar> = { title: "Voices/VoiceAvatar", component: VoiceAvatar, args: { voice: bella, size: 52 } };
export default meta;
type Story = StoryObj<typeof VoiceAvatar>;
export const Default: Story = {};
export const Sizes: Story = { render: () => <div className="flex items-center gap-4">{[22, 24, 36, 52, 80, 120].map((size) => <VoiceAvatar key={size} voice={bella} size={size} />)}</div> };
export const Interactive: Story = { args: { interactive: true, onClick: () => {} } };
export const Catalog: Story = { render: () => <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
  {Object.keys(VOICE_PORTRAITS).map((key) => {
    const at = key.indexOf(":");
    const voice = { engine: key.slice(0, at), id: key.slice(at + 1), name: key.slice(at + 1).replace(/^phonon:/, ""), hue: 30 };
    return <div key={key} className="flex flex-col items-center gap-2 text-center"><VoiceAvatar voice={voice} size={80} /><span className="max-w-full break-words text-sm">{voice.name}</span><span className="text-xs text-fg2">{voicePortrait(voice).concept}</span></div>;
  })}
</div> };
