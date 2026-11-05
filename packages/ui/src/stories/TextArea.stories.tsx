import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextArea } from "../components/TextArea";

const meta: Meta<typeof TextArea> = { title: "Primitives/TextArea", component: TextArea, args: { placeholder: "Paste or type anything…", "aria-label": "Text to read" } };
export default meta;
type S = StoryObj<typeof TextArea>;
export const Empty: S = {};
export const Filled: S = { args: { defaultValue: "I went to the woods because I wished to live deliberately." } };
export const Invalid: S = { args: { invalid: true, defaultValue: "" } };
export const Disabled: S = { args: { disabled: true } };
