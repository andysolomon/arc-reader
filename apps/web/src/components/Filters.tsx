import type { ReactNode } from "react";
import { X } from "lucide-react";
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

export interface ActiveFilter { name: string; label?: ReactNode; clear: () => void }

/** The filters in force, each removable where the list starts; nothing when none are. */
export function ActiveFilters({ filters, clearAll, children }: { filters: ActiveFilter[]; clearAll?: { count: number; onClear: () => void }; children?: ReactNode }) {
  if (!filters.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
    {filters.map((filter) => (
      <button key={filter.name} type="button" aria-label={`Remove filter: ${filter.name}`} title="Remove filter" onClick={filter.clear} className="inline-flex h-8 max-w-full items-center gap-1 rounded-pill border border-line bg-bg2 pl-3 pr-2 text-[13px] text-fg transition-colors duration-fast hover:bg-bg3">
        <span className="truncate">{filter.label ?? filter.name}</span>
        <X size={14} strokeWidth={1.5} className="shrink-0 text-fg2" aria-hidden />
      </button>
    ))}
    {clearAll && clearAll.count > 1 && <ClearFilters {...clearAll} />}
    {children}
  </div>;
}
