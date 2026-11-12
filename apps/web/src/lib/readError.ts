/** A link that can't be read for a reason worth telling: the message is written for whoever pasted the link. */
export class ReadError extends Error {}

/** Long enough to read a sentence of explanation in a toast */
export const EXPLAIN_MS = 7000;
