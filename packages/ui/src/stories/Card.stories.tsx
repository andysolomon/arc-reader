import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "../components/Card";

const meta: Meta<typeof Card> = { title: "Primitives/Card", component: Card, args: { children: "Card content", className: "w-[260px]" } };
export default meta;
type S = StoryObj<typeof Card>;
export const Default: S = {};
export const Interactive: S = { args: { interactive: true } };
export const Selected: S = { args: { selected: true } };
export const Panel: S = { args: { radius: "panel", padding: "sm" } };
