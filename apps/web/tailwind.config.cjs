const path = require("path");
module.exports = {
  presets: [require("@readaloud/tokens/tailwind-preset")],
  content: ["./index.html", "./src/**/*.{ts,tsx}", path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}")],
};
