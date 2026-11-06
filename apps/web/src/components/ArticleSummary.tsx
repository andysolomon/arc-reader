import { RotateCw, Sparkles, X } from "lucide-react";
import { Button, IconButton, Skeleton } from "@readaloud/ui";
import type { DocRecord } from "../lib/db";
import { hasSummary, summaryModelLabel } from "../lib/summary";
import { useSettings } from "../state/settings";
import { useSummaries } from "../state/summaries";

/** Summary panel above the Reader text. The Reader's header button opens it. */
export function ArticleSummary({ record }: { record: DocRecord }) {
  const model = useSettings((s) => s.summaryModel);
  const set = useSettings((s) => s.set);
  const pending = useSummaries((s) => !!s.pending[record.id]);
  const error = useSummaries((s) => s.errors[record.id]);
  const request = useSummaries((s) => s.request);
  const ready = hasSummary(record);
  const label = summaryModelLabel(ready && !pending ? record.summary!.model : model);

  return (
    <section aria-label="Summary" aria-busy={pending || undefined} className="mb-10 rounded-card border border-line bg-bg2 px-5 pb-4 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={16} strokeWidth={1.5} className="text-fg2" aria-hidden />
        <h2 className="m-0 flex-1 text-[13px] font-normal text-fg2">
          Summary · {label}
        </h2>
        {ready && !pending && (
          <IconButton label="Summarize again" size={32} onClick={() => void request(record)}>
            <RotateCw size={16} strokeWidth={1.5} />
          </IconButton>
        )}
        <IconButton label="Hide summary" size={32} onClick={() => set("showSummary", false)}>
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      </div>
      <div aria-live="polite">
        {pending ? (
          <div className="flex flex-col gap-2.5 py-1">
            <Skeleton width="100%" />
            <Skeleton width="92%" />
            <Skeleton width="70%" />
            <p className="m-0 mt-1 text-[13px] text-fg2">Summarizing with {label}… this can take up to a minute.</p>
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3 py-1">
            <p className="m-0 flex-1 text-[14px] text-danger">{error}</p>
            <Button onClick={() => void request(record)}>Retry</Button>
          </div>
        ) : ready ? (
          <div className="flex flex-col gap-3 font-serif text-[17px] leading-relaxed">
            {record.summary!.text.split(/\n\s*\n/).map((paragraph, i) => <p key={i} className="m-0">{paragraph.trim()}</p>)}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 py-1">
            <p className="m-0 flex-1 text-[14px] text-fg2">
              {record.summary ? "The text has changed since it was summarized." : "Get the main points in about 200 words."}
            </p>
            <Button variant="primary" leading={<Sparkles size={16} strokeWidth={1.5} />} onClick={() => void request(record)}>
              Summarize
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
