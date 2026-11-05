import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, SkipBack } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { PlayPauseIcon } from "../components/PlayPauseIcon";

const meta: Meta<typeof IconButton> = { title: "Primitives/IconButton", component: IconButton, args: { label: "Back", children: <ChevronLeft size={20} strokeWidth={1.5} /> } };
export default meta;
type S = StoryObj<typeof IconButton>;

export const Default: S = {};
export const Active: S = { args: { active: true } };
export const Round44: S = { args: { size: 44, round: true, label: "Previous sentence", children: <SkipBack size={20} strokeWidth={1.5} /> } };
export const Accent48: S = { args: { size: 48, round: true, tone: "accent", label: "Play", children: <PlayPauseIcon playing={false} /> } };
export const Disabled: S = { args: { disabled: true } };
