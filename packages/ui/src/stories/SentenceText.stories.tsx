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
const heading = (text: string, level: number, start: number) => ({ heading: level, start, sentences: [{ text, words: text.split(" ") }] });
export const Headings: S = {
  args: {
    activeIndex: 3,
    paragraphs: [
      heading("Where I lived", 2, 0),
      { ...PARAGRAPHS[0], start: 1 },
      heading("What I lived for", 3, 1 + PARAGRAPHS[0].sentences.length),
      { ...PARAGRAPHS[1], start: 2 + PARAGRAPHS[0].sentences.length },
      heading("A smaller point", 4, 2 + PARAGRAPHS[0].sentences.length + PARAGRAPHS[1].sentences.length),
    ],
  },
};
export const Interactive: S = {
  render: (a) => {
    const [i, setI] = useState(0);
    return <SentenceText {...a} activeIndex={i} activeWord={1} onSeek={setI} />;
  },
};
