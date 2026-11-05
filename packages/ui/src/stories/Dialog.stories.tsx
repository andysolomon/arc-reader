import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Dialog } from "../components/Dialog";
import { Button } from "../components/Button";
import { Kbd } from "../components/Kbd";

const meta: Meta<typeof Dialog> = { title: "Overlays/Dialog", component: Dialog };
export default meta;
type S = StoryObj<typeof Dialog>;
export const Shortcuts: S = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts">
          <div className="grid grid-cols-2 gap-x-7 gap-y-0.5">
            {[["Play / pause", "Space"], ["Next sentence", "→"], ["Focus mode", "F"], ["This sheet", "?"]].map(([w, k]) => (
              <div key={w} className="flex items-center justify-between border-b border-line py-2">
                <span className="text-[13px] text-fg2">{w}</span>
                <Kbd>{k}</Kbd>
              </div>
            ))}
          </div>
        </Dialog>
      </>
    );
  },
};
