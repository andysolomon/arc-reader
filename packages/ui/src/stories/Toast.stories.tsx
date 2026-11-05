import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toast } from "../components/Toast";

const meta: Meta<typeof Toast> = { title: "Overlays/Toast", component: Toast, args: { message: "Ava selected", offset: 40 } };
export default meta;
type S = StoryObj<typeof Toast>;
export const Visible: S = {};
export const Error: S = { args: { message: "Clipboard unavailable here" } };
export const Hidden: S = { args: { message: null } };
