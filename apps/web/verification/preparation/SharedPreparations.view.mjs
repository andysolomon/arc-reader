// Reader's words for SharedPreparations.tla, for /statechart --view.
const SHOWN = { none: "No row", running: "Row: preparing", done: "Row: ready", noted: "Row: ready, audio left on the other device", failed: "Row: failed" };
const SERVER = { new: "not asked for", running: "preparing", done: "done", noted: "done, some audio on the other device", failed: "failed", gone: "gone" };

export const title = "Server readings in the preparation queue";
export const state = (v) => Object.fromEntries(Object.keys(v.rows).flatMap((r) => [
  [`Reading ${r} on the server`, SERVER[v.catalogue[r]]],
  [`Reading ${r} in the queue`, `${SHOWN[v.rows[r]]}${v.hidden.includes(Number(r)) ? ", remembered as cleared" : ""}`],
]));

export const step = (action, from, to) => {
  const changed = (k) => Object.keys(from[k]).find((r) => from[k][r] !== to[k][r]);
  switch (action) {
    case "Create": return `someone prepares reading ${changed("catalogue")}`;
    case "End": return `reading ${changed("catalogue")} ends ${SERVER[to.catalogue[changed("catalogue")]]}`;
    case "Upload": return `the other device shares reading ${changed("catalogue")}'s audio`;
    case "Expire": return `the server drops reading ${changed("catalogue")}`;
    case "ChangeText": return to.matching ? "the reader undoes the edit" : "the reader edits the document";
    case "Fetch": return "a sync fetches the server's list";
    case "Apply": return "the sync updates the queue";
    case "Dismiss": return "the reader clears finished rows";
    case "Linger": return `reading ${changed("rows")}'s ready row clears itself`;
    case "Reload": return "the page reloads";
    default: return action;
  }
};
