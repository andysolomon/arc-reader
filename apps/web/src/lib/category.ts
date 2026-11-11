import { readingBlocks } from "./codeBlocks";
import { visualNarration } from "./visuals";
import type { DocCategory, DocRecord } from "./db";
import { hasSummary } from "./summary";

export const JEV_MODEL = "jev-latest";
/** About 6,000 tokens: enough to judge the subject, well inside Jev's 32k per question. */
const EXCERPT_CHARS = 24_000;

/** The library's shelves. Jev picks one by its description; categories you name yourself join the list. */
export const CATEGORIES: Record<string, string> = {
  "AI agents": "Building autonomous or tool-using AI agents: harnesses, orchestration, memory, agent architectures",
  "AI evaluation": "Evals, benchmarks, and measuring whether models or AI systems work",
  "Prompting and context": "Prompt engineering, context engineering, and getting better output from language models",
  "Machine learning research": "Models, training, architectures, datasets, and ML research results",
  "AI industry": "AI companies, product launches, funding, and the business of AI",
  "AI safety and policy": "Alignment, risks, regulation, and the governance of AI",
  "Software architecture": "System design, architectural patterns, and structuring large software systems",
  "Software engineering": "Engineering practice: testing, code quality, refactoring, process, and teams",
  "Programming languages and tools": "Languages, frameworks, libraries, editors, and developer tools",
  "Data and databases": "Databases, data engineering, analytics, and search",
  "Infrastructure and operations": "Cloud, DevOps, deployment, reliability, and performance",
  "Security and privacy": "Computer security, vulnerabilities, cryptography, and privacy",
  "Web and mobile": "Frontend, web platform, and mobile app development",
  "Design and UX": "Product design, interface design, typography, and user experience",
  "Product and startups": "Product management, startups, founders, and growth",
  "Business and management": "Companies, strategy, leadership, careers, and work",
  "Economics and finance": "Economics, markets, investing, and personal finance",
  "Science": "Natural sciences, mathematics, and research outside computing",
  "Health and medicine": "Health, medicine, fitness, and psychology",
  "Politics and society": "Politics, current affairs, law, and social issues",
  "History": "Historical events, people, and periods",
  "Philosophy and ideas": "Philosophy, ethics, essays of ideas, and ways of thinking",
  "Education and learning": "Teaching, learning, study methods, and education",
  "Culture and arts": "Art, music, film, games, media, and culture",
  "Fiction and literature": "Stories, novels, poetry, and writing about literature",
  "Personal writing": "Personal notes, journals, letters, drafts, and recordings of your own",
};

/** Built-in shelves first, then names used in the library, without case-only duplicates. */
export function categoryNames(used: Iterable<string>): string[] {
  const names = new Map(Object.keys(CATEGORIES).map((name) => [name.toLowerCase(), name]));
  for (const name of used) {
    const trimmed = name.trim();
    if (trimmed && !names.has(trimmed.toLowerCase())) names.set(trimmed.toLowerCase(), trimmed);
  }
  return [...names.values()];
}

/** What Jev reads about a document: its catalogue details, summary, and an excerpt of the narration. */
export function jevState(rec: DocRecord): Record<string, string> {
  const { url, author, site, description } = rec.meta ?? {};
  return Object.fromEntries(Object.entries({
    title: rec.title, link: url, site, author, description,
    summary: hasSummary(rec) ? rec.summary!.text : undefined,
    text: readingBlocks(rec.text).map((block) => block.kind === "visual"
      ? visualNarration(block.visual, rec.visualDescriptions).text : block.text).join("\n\n").slice(0, EXCERPT_CHARS),
  }).filter((entry): entry is [string, string] => !!entry[1]));
}

/** Jev's request: the document as state, one Choice over every shelf. */
export function categoryRequest(rec: DocRecord, used: Iterable<string>) {
  return {
    model: JEV_MODEL,
    state: jevState(rec),
    questions: {
      category: {
        type: "choice",
        instructions: "Which shelf of a personal research library this document belongs on, judged by its main subject",
        // Names you added carry no description; Jev reads the name itself.
        criteria: Object.fromEntries(categoryNames(used).map((name) => [name, CATEGORIES[name] ?? null])),
      },
    },
  };
}

export interface JevChoice { choice: string; confidence?: number; model?: string }

/** Ask Jev one Choice question and check the answer is one of the offered choices. */
export async function askJevChoice(
  request: { model: string; state: Record<string, string>; questions: Record<string, { type: string; instructions: string; criteria: Record<string, string | null> }> },
  messages: { failed: string; missing: string },
): Promise<JevChoice> {
  const [question, { criteria }] = Object.entries(request.questions)[0];
  const response = await fetch("/api/jev/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify(request),
  });
  const data = await response.json().catch(() => null) as { model?: string; answers?: Record<string, ChoiceAnswer>; error?: { message?: string }; detail?: unknown } | null;
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null;
    throw new Error(data?.error?.message || detail || `${messages.failed} (HTTP ${response.status}). Please retry.`);
  }
  const answer = data?.answers?.[question];
  if (!answer?.choice || !Object.hasOwn(criteria, answer.choice)) throw new Error(messages.missing);
  const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? Math.min(1, Math.max(0, answer.confidence)) : undefined;
  return { choice: answer.choice, confidence, model: data?.model?.slice(0, 200) };
}

interface ChoiceAnswer { choice?: string; confidence?: number }

export async function suggestCategory(rec: DocRecord, used: Iterable<string>): Promise<DocCategory> {
  if (!rec.text.trim() && !rec.title.trim()) throw new Error("There is nothing to categorize.");
  const answer = await askJevChoice(categoryRequest(rec, used), { failed: "Categorizing failed", missing: "Jev didn't return a category. Please retry." });
  return { name: answer.choice, by: "jev", confidence: answer.confidence, model: answer.model, at: Date.now() };
}

/** Plain citation for notes and papers: Author (Date). Title. Site. Link */
export function citation(rec: DocRecord): string {
  const { author, published, site, url } = rec.meta ?? {};
  const title = rec.title.trim().replace(/[.\s]+$/, "");
  return [author && `${author}${published ? ` (${published})` : ""}.`, !author && published && `(${published}).`, `${title}.`, site && `${site}.`, url]
    .filter(Boolean).join(" ");
}
