/** Reading levels for Practice, each with the passage length that suits it. */
export type Band = "6-8" | "9-12" | "college" | "advanced";

export interface BandInfo {
  id: Band;
  title: string;
  /** Passage length in words (whitespace-separated), inclusive. */
  min: number;
  max: number;
}

export const BANDS: BandInfo[] = [
  { id: "6-8", title: "Grades 6–8", min: 50, max: 80 },
  { id: "9-12", title: "Grades 9–12", min: 70, max: 110 },
  { id: "college", title: "College", min: 90, max: 150 },
  { id: "advanced", title: "Advanced", min: 90, max: 150 },
];

export const bandInfo = (band: Band): BandInfo => BANDS.find((b) => b.id === band) ?? BANDS[1];
export const isBand = (value: unknown): value is Band => BANDS.some((b) => b.id === value);
