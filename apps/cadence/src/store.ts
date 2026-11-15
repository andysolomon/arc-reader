import { createPracticeStore } from "@readaloud/practice/store";

/** Cadence's own progress on this device, apart from ReadAloud's Practice even on a shared address. */
export const usePractice = createPracticeStore("cadence:practice");
