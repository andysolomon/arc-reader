import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SpeedChip } from "../components/SpeedChip";

const meta: Meta<typeof SpeedChip> = { title: "Player/SpeedChip", component: SpeedChip };
export default meta;
export const Default: StoryObj = {
  render: () => {
    const [s, setS] = useState(1);
    return <div className="pt-24"><SpeedChip speed={s} onChange={setS} /><p className="mt-3 text-fg2">Tap to cycle; hold 420ms or right-click for the slider.</p></div>;
  },
};
