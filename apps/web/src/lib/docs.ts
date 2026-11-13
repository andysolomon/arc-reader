/** The repo's HTML docs, served by the app at /docs/ (vite.docs.ts) and listed in Settings. */
export interface DocLink {
  /** Path under docs/ in the repo. */
  page: string;
  title: string;
  hint: string;
}

export const DOC_LINKS: DocLink[] = [
  { page: "readaloud-bpmn.html", title: "How it works: process diagrams", hint: "Reading, speech, preparing audio, library sync and summaries, with walkthroughs you can play." },
  { page: "readaloud-sequence.html", title: "How it works: sequence diagrams", hint: "The same flows as messages between the app, the server and the speech engines." },
  { page: "kind-cluster-explainer.html", title: "How it runs", hint: "The kind cluster, Tailscale, and what happens on a deploy." },
  { page: "plans/voicestudio-integration.html", title: "VoiceStudio integration plan", hint: "What was planned, what has shipped since, and the open risks." },
  { page: "design/voice-avatars.html", title: "Voice avatars", hint: "Every voice’s portrait, at the sizes the app uses." },
];

export const docUrl = (page: string) => `/docs/${page}`;
