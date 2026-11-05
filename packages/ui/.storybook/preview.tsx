import type { Preview, Decorator } from "@storybook/react-vite";
import React, { useEffect } from "react";
import "../src/styles.css";

const ThemeDecorator: Decorator = (Story, ctx) => {
  const theme = (ctx.globals.theme as string) || "dark";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.style.background = "var(--bg)";
    document.body.style.color = "var(--fg)";
  }, [theme]);
  return (
    <div style={{ padding: 24, background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [ThemeDecorator],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
          { value: "tokyo-night", title: "Tokyo Night" },
          { value: "catppuccin", title: "Catppuccin" },
          { value: "gruvbox", title: "Gruvbox" },
          { value: "nord", title: "Nord" },
          { value: "everforest", title: "Everforest" },
          { value: "kanagawa", title: "Kanagawa" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "dark" },
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
  },
};
export default preview;
