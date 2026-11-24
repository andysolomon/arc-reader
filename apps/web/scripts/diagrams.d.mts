export const ROOT: string;
export const PAGES: string[];
export function pinRefs(html: string, root?: string): { html: string; problems: string[]; count: number };
export function loadModel(page: string): any;
export function filesByDiagram(): { page: string; id: string; title: string; files: Set<string> }[];
export function describesChange(diff: string): boolean;
export function staleDiagrams(range: string): { page: string; id: string; title: string; files: Set<string>; changed: string[] }[];
