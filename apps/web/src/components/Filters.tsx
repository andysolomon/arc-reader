import { Button } from "@readaloud/ui";

/** Voice tiles: two across on a phone, as many as fit beyond that. */
export const VOICE_GRID = "grid grid-cols-2 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-2";

export const filterControlClass = "h-10 w-full min-w-0 rounded-control border border-line bg-bg2 px-3 text-[13px] text-fg";

export function FilterSelect({ label, any, value, options, onChange }: { label: string; any: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-xs text-fg2">{label}
    <select className={filterControlClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{any}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>;
}

export function ClearFilters({ count, onClear }: { count: number; onClear: () => void }) {
  return count ? <Button variant="ghost" size="sm" onClick={onClear}>Clear filters ({count})</Button> : null;
}
