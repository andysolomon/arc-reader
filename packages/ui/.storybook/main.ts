import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true, allowedHosts: [".ts.net"] },
  viteFinal: async (config) => ({
    ...config,
    server: { ...config.server, allowedHosts: [".ts.net", "localhost", "127.0.0.1"] },
  }),
};
export default config;
