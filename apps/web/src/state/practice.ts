import { createPracticeStore } from "@readaloud/practice/store";

export * from "@readaloud/practice/store";

/** ReadAloud's own practice progress. Cadence, the standalone app, keeps a separate one. */
export const usePractice = createPracticeStore("readaloud:practice");
