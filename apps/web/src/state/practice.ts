import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isBand, type Band } from "../lib/practice/bands";
import { wordKey } from "../lib/practice/words";
import { dayOf, daysBetween } from "../lib/practice/score";

/** Clean reads in a row that move a word from "to go" to "mastered". */
export const CLEAN_TO_MASTER = 3;
const HISTORY_LIMIT = 100;

export interface BankWord {
  /** As it first appeared, so names keep their capitals. */
  word: string;
  missed: number;
  /** Clean reads since it was last missed. */
  clean: number;
  lastAt: number;
}

export interface Round {
  at: number;
  passageId: string;
  band: Band;
  accuracy: number;
  wcpm: number;
  phrasing: number;
  points: number;
}

export interface PracticeData {
  band: Band;
  points: number;
  streak: { days: number; lastDay: string | null };
  history: Round[];
  words: Record<string, BankWord>;
}

export const EMPTY: PracticeData = { band: "9-12", points: 0, streak: { days: 0, lastDay: null }, history: [], words: {} };

/** The streak as of `day`: unbroken if the last round was today or yesterday. */
export function currentStreak(data: Pick<PracticeData, "streak">, day: string): number {
  const { days, lastDay } = data.streak;
  return lastDay && daysBetween(lastDay, day) <= 1 ? days : 0;
}

export interface RoundInput {
  passageId: string;
  accuracy: number;
  wcpm: number;
  phrasing: number;
  points: number;
  /** Words read cleanly this round. */
  clean: string[];
  /** Words missed this round. */
  missed: string[];
}

/** A finished round: points, the day's streak, and the word bank brought up to date. */
export function applyRound(data: PracticeData, input: RoundInput, now: number): PracticeData {
  const today = dayOf(now);
  const { days, lastDay } = data.streak;
  const streakDays = lastDay === today ? days : lastDay && daysBetween(lastDay, today) === 1 ? days + 1 : 1;
  const words = { ...data.words };
  for (const word of input.missed) {
    const key = wordKey(word);
    const was = words[key];
    words[key] = { word: was?.word ?? word, missed: (was?.missed ?? 0) + 1, clean: 0, lastAt: now };
  }
  const missedKeys = new Set(input.missed.map(wordKey));
  for (const word of input.clean) {
    const key = wordKey(word);
    const was = words[key];
    if (was && !missedKeys.has(key) && was.clean < CLEAN_TO_MASTER) words[key] = { ...was, clean: was.clean + 1, lastAt: now };
  }
  const round: Round = { at: now, passageId: input.passageId, band: data.band, accuracy: input.accuracy, wcpm: input.wcpm, phrasing: input.phrasing, points: input.points };
  return {
    ...data,
    points: data.points + input.points,
    streak: { days: streakDays, lastDay: today },
    history: [...data.history, round].slice(-HISTORY_LIMIT),
    words,
  };
}

/** "Try this word" on its own: a clean read counts toward mastery, a miss resets it. */
export function applyWordAttempt(data: PracticeData, word: string, ok: boolean, now: number): PracticeData {
  const key = wordKey(word);
  const was = data.words[key];
  if (!was && ok) return data;
  const next: BankWord = ok
    ? { ...was!, clean: Math.min(CLEAN_TO_MASTER, was!.clean + 1), lastAt: now }
    : { word: was?.word ?? word, missed: (was?.missed ?? 0) + 1, clean: 0, lastAt: now };
  return { ...data, words: { ...data.words, [key]: next } };
}

export const toGo = (words: Record<string, BankWord>) =>
  Object.values(words).filter((w) => w.clean < CLEAN_TO_MASTER).sort((a, b) => b.missed - a.missed || b.lastAt - a.lastAt);
export const mastered = (words: Record<string, BankWord>) => Object.values(words).filter((w) => w.clean >= CLEAN_TO_MASTER).length;

/**
 * Readers sharing this browser. The current reader's progress is the top-level PracticeData, so
 * everything else reads it directly; the others wait in `others` until switched to.
 */
export interface Readers {
  readerId: string;
  readerName: string;
  others: Record<string, PracticeData & { name: string }>;
}
export const NAME_MAX = 24;
const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const dataOf = ({ band, points, streak, history, words }: PracticeData): PracticeData => ({ band, points, streak, history, words });

/** Keep the current reader under `others` and make `id` current. */
export function switchTo(state: PracticeData & Readers, id: string): PracticeData & Readers {
  const next = state.others[id];
  if (!next || id === state.readerId) return state;
  const { name, ...data } = next;
  const others = { ...state.others, [state.readerId]: { ...dataOf(state), name: state.readerName } };
  delete others[id];
  return { ...state, ...data, readerId: id, readerName: name, others };
}

/** A new reader, made current, starting at the current reader's level. */
export function addReader(state: PracticeData & Readers, name: string, id: string): PracticeData & Readers {
  const clean = cleanName(name);
  if (!clean) return state;
  const others = { ...state.others, [state.readerId]: { ...dataOf(state), name: state.readerName } };
  return { ...state, ...EMPTY, band: state.band, readerId: id, readerName: clean, others };
}

/** Remove a reader; removing the current one switches to another first. The last reader stays. */
export function removeReader(state: PracticeData & Readers, id: string): PracticeData & Readers {
  const ids = Object.keys(state.others);
  if (id === state.readerId) {
    if (!ids.length) return state;
    const switched = switchTo(state, ids[0]);
    const others = { ...switched.others };
    delete others[id];
    return { ...switched, others };
  }
  if (!state.others[id]) return state;
  const others = { ...state.others };
  delete others[id];
  return { ...state, others };
}

export function readerList(state: PracticeData & Readers) {
  return [{ id: state.readerId, name: state.readerName, streak: state.streak, points: state.points }, ...Object.entries(state.others).map(([id, r]) => ({ id, name: r.name, streak: r.streak, points: r.points }))]
    .sort((a, b) => a.name.localeCompare(b.name));
}

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `reader-${Date.now().toString(36)}`);

interface Actions {
  setBand: (band: Band) => void;
  finishRound: (input: RoundInput) => void;
  tryWord: (word: string, ok: boolean) => void;
  addReader: (name: string) => void;
  switchReader: (id: string) => void;
  renameReader: (name: string) => void;
  removeReader: (id: string) => void;
}

export const DEFAULT_READER: Readers = { readerId: "reader-1", readerName: "Reader", others: {} };

export const usePractice = create<PracticeData & Readers & Actions>()(persist((set) => ({
  ...EMPTY,
  ...DEFAULT_READER,
  setBand: (band) => set({ band }),
  finishRound: (input) => set((s) => applyRound(s, input, Date.now())),
  tryWord: (word, ok) => set((s) => applyWordAttempt(s, word, ok, Date.now())),
  addReader: (name) => set((s) => addReader(s, name, newId())),
  switchReader: (id) => set((s) => switchTo(s, id)),
  renameReader: (name) => set((s) => (cleanName(name) ? { readerName: cleanName(name) } : {})),
  removeReader: (id) => set((s) => removeReader(s, id)),
}), {
  name: "readaloud:practice",
  version: 2,
  // Version 1 had one reader's progress and no readers.
  migrate: (persisted, version) => (version < 2 ? { ...(persisted as object), ...DEFAULT_READER } : persisted) as PracticeData & Readers,
  partialize: ({ band, points, streak, history, words, readerId, readerName, others }) => ({ band, points, streak, history, words, readerId, readerName, others }),
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<PracticeData & Readers>;
    return { ...current, ...p, band: isBand(p.band) ? p.band : current.band };
  },
}));
