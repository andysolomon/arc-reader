// Reader's words for PreparationQueue.tla, for /statechart --view.
const row = (v, j) => {
  if (v.status[j] === "ready") return "Saved";
  switch (v.pc[j]) {
    case "start": return v.server[j] === "none" ? "Starting" : "Starting again";
    case "sending": return v.server[j] === "made" ? "Made, device not told yet" : "On the server";
    case "turn": return v.savingNow > 0 ? "Waiting while another saves" : "Waiting to save";
    case "walking": return "Saving";
    default: return v.server[j] === "none" ? "Waiting on this device" : "Back in the queue";
  }
};

export const title = "Audio preparation queue";
const saved = (v, j) => (v.stored[j].length && v.status[j] !== "ready" ? `, ${v.stored[j].length} saved` : "");
export const state = (v) => Object.keys(v.status).map((j) => `${j}: ${row(v, j)}${saved(v, j)}`).join(" | ");

const checked = (to, j) =>
  to.pc[j] === "sending" ? `reading ${j} is sent to the server` : to.pc[j] === "turn" ? `reading ${j} goes straight to saving` : `reading ${j} is found saved already`;
const WORDS = {
  ServerMakes: (j) => `the server makes reading ${j}`,
  ServerAnswers: (j) => `this device sees reading ${j} made`,
  TakeTurn: (j) => `reading ${j} gets a turn to save`,
  ClipArrives: (j) => `a clip of reading ${j} arrives`,
  ClipTimesOut: (j) => `a clip of reading ${j} times out`,
};
export const step = (action, from, to) => {
  if (action === "Reload") return "the page reloads";
  if (action === "Done") return null;
  // The reading the step belongs to; drain() can start another one in the same step.
  const differs = (k, field) => JSON.stringify(from[field][k]) !== JSON.stringify(to[field][k]);
  const j = Object.keys(from.status).find((k) => from.pc[k] !== "idle" && ["pc", "server", "stored", "todo"].some((field) => differs(k, field)))
    ?? Object.keys(from.status).find((k) => differs(k, "server"));
  return action === "CheckCache" ? checked(to, j) : WORDS[action]?.(j) ?? action;
};
