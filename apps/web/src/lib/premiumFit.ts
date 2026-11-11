import type { DocRecord, PremiumFit, PremiumFitLevel } from "./db";
import { JEV_MODEL, askJevChoice, jevState } from "./category";
import { summarySource } from "./summary";

/** What each verdict means. Jev picks one by its description. */
export const PREMIUM_FITS: Record<PremiumFitLevel, string> = {
  strong: "Strong candidate: sustained narrative or argumentative prose, such as an essay, story, profile or long-form feature, that a natural, expressive voice makes noticeably better to listen to and that is worth hearing in full",
  good: "Good candidate: informative prose worth hearing well, with some lists, tables, figures, code or citations that read flatly aloud",
  weak: "Weak candidate: reference material, documentation, code-heavy or list-heavy text, link roundups, brief news or short notes, where a free voice serves as well",
};
export const PREMIUM_FIT_LABELS: Record<PremiumFitLevel, string> = { strong: "Strong candidate", good: "Good candidate", weak: "Free voice is fine" };

export function premiumFitRequest(rec: DocRecord) {
  return {
    model: JEV_MODEL,
    state: jevState(rec),
    questions: {
      premium: {
        type: "choice",
        instructions: "How much this document would gain from a paid, studio-quality narration voice instead of a free one, judged by its writing and structure rather than its subject",
        criteria: { ...PREMIUM_FITS } as Record<string, string | null>,
      },
    },
  };
}

/** True when Jev's verdict was made from the current text. */
export const hasPremiumFit = (rec: DocRecord) => !!rec.premium && rec.premium.source === summarySource(rec.text);

export async function assessPremiumFit(rec: DocRecord): Promise<PremiumFit> {
  if (!rec.text.trim()) throw new Error("There is nothing to assess.");
  const answer = await askJevChoice(premiumFitRequest(rec), { failed: "Assessing failed", missing: "Jev didn't return an assessment. Please retry." });
  return { fit: answer.choice as PremiumFitLevel, confidence: answer.confidence, model: answer.model, source: summarySource(rec.text), at: Date.now() };
}
