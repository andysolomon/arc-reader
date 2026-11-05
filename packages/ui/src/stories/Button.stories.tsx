import type { Meta, StoryObj } from "@storybook/react-vite";
import { Clipboard } from "lucide-react";
import { Button } from "../components/Button";

const meta: Meta<typeof Button> = { title: "Primitives/Button", component: Button, args: { children: "Paste from clipboard" } };
export default meta;
type S = StoryObj<typeof Button>;

export const Secondary: S = { args: { leading: <Clipboard size={16} strokeWidth={1.5} /> } };
export const Primary: S = { args: { variant: "primary", size: "xl", children: <>Listen<span className="rounded-[6px] bg-black/15 px-2 py-1 font-mono text-[12px] font-medium">⌘↵</span></> } };
export const Ghost: S = { args: { variant: "ghost" } };
export const Danger: S = { args: { variant: "danger", children: "Delete" } };
export const Link: S = { args: { variant: "link", children: "Try a sample" } };
export const Loading: S = { args: { loading: true } };
export const Disabled: S = { args: { disabled: true } };
export const AllStates: S = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Idle</Button>
      <Button loading>Loading</Button>
      <Button disabled>Disabled</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="danger">Error</Button>
    </div>
  ),
};
