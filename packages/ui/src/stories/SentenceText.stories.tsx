import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SentenceText } from "../components/SentenceText";
import { PARAGRAPHS } from "./fixtures";

const meta: Meta<typeof SentenceText> = {
  title: "Reader/SentenceText",
  component: SentenceText,
  args: { paragraphs: PARAGRAPHS, activeIndex: 1, activeWord: 3, mode: "block" },
};
export default meta;
type S = StoryObj<typeof SentenceText>;
export const Block: S = {};
export const Dim: S = { args: { mode: "dim" } };
export const Underline: S = { args: { mode: "underline" } };
export const Loading: S = { args: { loading: true, activeIndex: 0, activeWord: -1 } };
export const Wide26px: S = { args: { wide: true, fontSize: 26 } };
export const Interactive: S = {
  render: (a) => {
    const [i, setI] = useState(0);
    return <SentenceText {...a} activeIndex={i} activeWord={1} onSeek={setI} />;
  },
};
