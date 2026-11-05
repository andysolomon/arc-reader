import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Sheet } from "../components/Sheet";
import { Button } from "../components/Button";

const meta: Meta<typeof Sheet> = { title: "Overlays/Sheet", component: Sheet };
export default meta;
type S = StoryObj<typeof Sheet>;
export const Open: S = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open sheet</Button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Text">
          <div className="text-fg2">Reader text controls live here on small screens.</div>
        </Sheet>
      </>
    );
  },
};
