import type { IconNode } from "morphicons/react";

/** Filled play/pause shapes (rounded, matching the prototype). */
export const PlayFilled: IconNode = [
  ["path", { d: "M8 5.5v13c0 .8.9 1.3 1.6.9l10-6.5c.6-.4.6-1.4 0-1.8l-10-6.5C8.9 4.2 8 4.7 8 5.5z", fill: "currentColor", stroke: "none" }],
];
export const PauseFilled: IconNode = [
  ["rect", { x: 6, y: 5, width: 4, height: 14, rx: 1, fill: "currentColor", stroke: "none" }],
  ["rect", { x: 14, y: 5, width: 4, height: 14, rx: 1, fill: "currentColor", stroke: "none" }],
];
