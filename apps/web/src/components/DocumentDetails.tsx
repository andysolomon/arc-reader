import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Library, Sparkles, Star, X } from "lucide-react";
import { Button, IconButton, Input, cn } from "@readaloud/ui";
import type { DocMeta, DocRecord } from "../lib/db";
import { categoryNames, citation } from "../lib/category";
import { writeClipboardText } from "../lib/clipboard";
import { hasSummary, summaryModelLabel } from "../lib/summary";
import { dateLabel } from "../lib/dates";
import { useLibrary } from "../state/library";
import { useCategories } from "../state/categories";
import { useJev } from "../state/llm";
import { toast } from "../state/toast";
import { useFavorites } from "../state/favorites";
import { usePremiumContext } from "../state/premium";
import { estimatePremium, pendingNote, spentOn } from "../lib/premiumEstimate";
import { PREMIUM_FIT_LABELS, hasPremiumFit } from "../lib/premiumFit";
import { formatUsd } from "../lib/usage";
import { catalogue } from "../lib/postTitle";

const fieldClass = "h-9 w-full min-w-0 bg-bg px-3 text-[14px]";

/** Catalogue record above the Reader text: link, bibliographic details, category, summary and notes. Edits save when a field loses focus. */
export function DocumentDetails({ record, summaryAvailable, onShowSummary, onClose }: {
  record: DocRecord;
  /** Summaries can be made or read on this server */
  summaryAvailable: boolean;
  onShowSummary: () => void;
  onClose: () => void;
}) {
  const update = useLibrary((s) => s.update);
  const library = useLibrary((s) => s.items);
  const jevReady = useJev((s) => !!s.config?.configured);
  const pending = useCategories((s) => !!s.pending[record.id]);
  const error = useCategories((s) => s.errors[record.id]);
  const listId = useId();
  useEffect(() => { void useJev.getState().load(); }, []);

  const meta = record.meta ?? {};
  const saveMeta = (key: keyof DocMeta, value: string) => {
    const next: DocMeta = { ...meta, [key]: value.trim() || undefined };
    const kept = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as DocMeta;
    void update(record.id, { meta: Object.keys(kept).length ? kept : undefined });
  };
  const names = categoryNames(library.flatMap((it) => (it.rec.category ? [it.rec.category.name] : [])));
  const category = record.category;
  const copyCitation = async () => {
    try {
      await writeClipboardText(citation(record));
      toast("Citation copied");
    } catch {
      toast("Couldn't copy the citation");
    }
  };

  return (
    <section aria-label="Details" className="mb-10 rounded-card border border-line bg-bg2 px-5 pb-5 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <Library size={16} strokeWidth={1.5} className="text-fg2" aria-hidden />
        <h2 className="m-0 flex-1 text-[13px] font-normal text-fg2">Details</h2>
        <Button leading={<Copy size={14} strokeWidth={1.5} />} onClick={() => void copyCitation()}>Copy citation</Button>
        <IconButton label="Hide details" size={32} onClick={onClose}>
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
        <Row label="Title">
          {(id) => <Field id={id} value={catalogue(record).title} onSave={(v) => { if (v.trim()) void update(record.id, { title: v.trim() }); }} />}
        </Row>
        <Row label="Link">
          {(id) => (
            <div className="flex items-center gap-1">
              <Field id={id} type="url" value={meta.url ?? ""} placeholder="https://…" onSave={(v) => saveMeta("url", v)} />
              {meta.url && /^https?:\/\//i.test(meta.url) && (
                <a href={meta.url} target="_blank" rel="noreferrer noopener" aria-label="Open the original" title="Open the original" className="grid size-9 shrink-0 place-items-center rounded-control text-fg2 hover:bg-bg3 hover:text-fg">
                  <ExternalLink size={16} strokeWidth={1.5} />
                </a>
              )}
            </div>
          )}
        </Row>
        <Row label="Author">{(id) => <Field id={id} value={catalogue(record).author ?? ""} onSave={(v) => saveMeta("author", v)} />}</Row>
        <Row label="Published">{(id) => <Field id={id} value={meta.published ?? ""} placeholder="YYYY-MM-DD" onSave={(v) => saveMeta("published", v)} />}</Row>
        <Row label="Site">{(id) => <Field id={id} value={meta.site ?? ""} placeholder={record.domain} onSave={(v) => saveMeta("site", v)} />}</Row>
        <Row label="Category" top>
          {(id) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Field id={id} value={category?.name ?? ""} list={listId} placeholder="Uncategorized" onSave={(v) => { if (v.trim() !== (category?.name ?? "")) void useCategories.getState().choose(record.id, v); }} />
                <datalist id={listId}>{names.map((name) => <option key={name} value={name} />)}</datalist>
                {jevReady && (
                  <Button leading={<Sparkles size={14} strokeWidth={1.5} />} loading={pending} onClick={() => void useCategories.getState().suggest(record)} className="shrink-0">
                    {category ? "Ask Jev again" : "Ask Jev"}
                  </Button>
                )}
              </div>
              <p className={cn("m-0 text-[12px]", error ? "text-danger" : "text-fg2")} aria-live="polite">
                {error ?? (pending ? "Jev is reading…"
                  : category?.by === "jev" ? `Filed by Jev${category.confidence !== undefined ? ` · ${Math.round(category.confidence * 100)}% confident` : ""}. Type to change it.`
                  : category ? "Chosen by you." : jevReady ? "Pick a shelf, type a new one, or ask Jev." : "Pick a shelf or type a new one. Add a TypeSafe key in Settings to have Jev file documents.")}
              </p>
            </div>
          )}
        </Row>
        <Row label="Premium" top>{() => <PremiumAssessment record={record} jevReady={jevReady} />}</Row>
        {summaryAvailable && (
          <Row label="Summary">
            {() => (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-fg2">
                <span>{hasSummary(record) ? `Saved · ${summaryModelLabel(record.summary!.model)}` : record.summary ? "Out of date" : "Not summarized yet"}</span>
                <Button variant="link" onClick={onShowSummary}>{hasSummary(record) ? "Show summary" : "Summarize"}</Button>
              </div>
            )}
          </Row>
        )}
        <Row label="Description" top>
          {(id) => <Field id={id} multiline value={meta.description ?? ""} onSave={(v) => saveMeta("description", v)} />}
        </Row>
        <Row label="Notes" top>
          {(id) => <Field id={id} multiline rows={4} value={meta.notes ?? ""} placeholder="Your notes for later research" onSave={(v) => saveMeta("notes", v)} />}
        </Row>
        <Row label="Added">
          {() => <span className="text-[14px] text-fg2">{dateLabel(record.createdAt)} · {record.domain}</span>}
        </Row>
      </div>
    </section>
  );
}

/** Favorite, and for favorites what a paid narration would cost and whether Jev thinks it is worth it. */
function PremiumAssessment({ record, jevReady }: { record: DocRecord; jevReady: boolean }) {
  const context = usePremiumContext();
  const assessing = useFavorites((s) => s.assessing[record.id]);
  const error = useFavorites((s) => s.errors[record.id]);
  const favorite = !!record.favoritedAt;
  const estimate = favorite ? estimatePremium(record, context.calibration, { explainable: context.explainable }) : null;
  const note = estimate && pendingNote(estimate.narration);
  const spent = spentOn(context.spend[record.id]);
  const fit = hasPremiumFit(record) ? record.premium! : null;
  return (
    <div className="flex flex-col gap-2 pt-1 text-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <Button leading={<Star size={14} strokeWidth={1.5} fill={favorite ? "currentColor" : "none"} />} onClick={() => void useFavorites.getState().toggle(record)}>
          {favorite ? "Favorited" : "Favorite"}
        </Button>
        {favorite && jevReady && (
          <Button variant="ghost" leading={<Sparkles size={14} strokeWidth={1.5} />} loading={!!assessing} onClick={() => void useFavorites.getState().assess(record)}>
            {fit ? "Ask Jev again" : "Ask Jev"}
          </Button>
        )}
      </div>
      {!favorite && <p className="m-0 text-[12px] text-fg2">Favorite this to estimate a premium read before any paid audio is made.</p>}
      {estimate && (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Premium read estimates">
            {estimate.options.map((option) => (
              <li key={option.id} className="flex flex-col">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-fg">{option.label}</span>
                  <span className="font-mono tabular-nums text-fg">≈{formatUsd(option.costUsd)}</span>
                  {formatUsd(option.lowUsd) !== formatUsd(option.highUsd) && <span className="text-[12px] tabular-nums text-fg2">{formatUsd(option.lowUsd)}–{formatUsd(option.highUsd)}</span>}
                </span>
                <span className="text-[12px] text-fg2">{option.basis}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12px] text-fg2">
            The whole document read once: {estimate.narration.requests.toLocaleString()} passages, {estimate.narration.characters.toLocaleString()} characters.
            {note && ` ${note}.`}
            {spent && ` Spent so far on this device: ${formatUsd(spent.costUsd)}${spent.unpriced ? " plus unpriced audio" : ""}.`}
          </p>
        </>
      )}
      {favorite && (
        <p className={cn("m-0 text-[12px]", error ? "text-danger" : "text-fg2")} aria-live="polite">
          {error ?? assessing ?? (fit
            ? `Jev: ${PREMIUM_FIT_LABELS[fit.fit]}${fit.confidence !== undefined ? ` · ${Math.round(fit.confidence * 100)}% confident` : ""}.`
            : jevReady ? "Jev hasn't judged whether this deserves a paid voice yet." : "Add a TypeSafe key in Settings to have Jev judge whether this deserves a paid voice.")}
        </p>
      )}
    </div>
  );
}

function Row({ label, top, children }: { label: string; top?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className={cn("text-[13px] text-fg2", top && "sm:self-start sm:pt-2")}>{label}</label>
      <div className="min-w-0">{children(id)}</div>
    </>
  );
}

/** Edits a draft and saves on blur or Enter. Keeps up with changes synced from elsewhere while not being edited. */
function Field({ id, value, onSave, multiline, rows = 2, ...rest }: {
  id: string; value: string; onSave: (value: string) => void; multiline?: boolean; rows?: number;
  type?: string; placeholder?: string; list?: string;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  /** Escape discards the draft; the blur that follows must not save it. */
  const discard = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value); }, [value]);
  const common = {
    id, value: draft,
    onFocus: () => { editing.current = true; },
    onBlur: () => {
      editing.current = false;
      if (discard.current) { discard.current = false; return; }
      if (draft !== value) onSave(draft);
    },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
  };
  if (multiline) {
    return <textarea {...common} rows={rows} placeholder={rest.placeholder} className="w-full min-w-0 resize-y rounded-control border border-line bg-bg px-3 py-2 text-[14px] leading-relaxed [@media(pointer:coarse)]:text-[16px] text-fg transition-colors focus:border-fg3 focus-visible:outline-offset-0" />;
  }
  return (
    <Input
      {...common}
      {...rest}
      spellCheck={rest.type === "url" ? false : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          discard.current = true;
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={fieldClass}
    />
  );
}
