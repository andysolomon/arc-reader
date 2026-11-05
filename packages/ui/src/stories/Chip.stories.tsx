import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "../components/Chip";
import { VoiceAvatar } from "../components/VoiceAvatar";
import { VOICES } from "./fixtures";

const meta: Meta<typeof Chip> = { title: "Primitives/Chip", component: Chip, args: { children: "All voices" } };
export default meta;
type S = StoryObj<typeof Chip>;
export const Default: S = {};
export const Selected: S = { args: { selected: true } };
export const WithAvatar: S = { args: { leading: <VoiceAvatar voice={VOICES[0]} size={24} />, children: "Ava" } };
export const Tag: S = { args: { tag: true, children: "narrator" } };
export const Disabled: S = { args: { disabled: true } };
