import { useState } from "react";
import { BookOpen, ClipboardList, FileText, Globe } from "lucide-react";
import { cn } from "@readaloud/ui";
import type { DocRecord } from "../lib/db";

/** Site favicon for articles, via the server so the browser never reports library sites elsewhere. */
export function SourceIcon({ rec }: { rec: Pick<DocRecord, "source" | "domain"> }) {
  const [failed, setFailed] = useState(false);
  const site = (rec.source === "url" || rec.source === "share") && rec.domain.includes(".") && !/[\s/]/.test(rec.domain);
  if (site && !failed) {
    return <img src={`/api/favicon?host=${encodeURIComponent(rec.domain)}`} alt="" width={16} height={16} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-4 shrink-0 rounded-[4px]" />;
  }
  const Icon = site ? Globe : rec.source === "file" ? FileText : ClipboardList;
  return <Icon size={14} strokeWidth={1.5} className="shrink-0 text-fg2" aria-hidden />;
}

const MARK = "grid size-6 shrink-0 place-items-center rounded-[7px]";

/** The tile that leads a document wherever it is listed: where it came from. */
export function SourceMark({ rec, className }: { rec: Pick<DocRecord, "source" | "domain">; className?: string }) {
  return (
    <span className={cn(MARK, "bg-bg3 ring-1 ring-line", className)}>
      <SourceIcon rec={rec} />
    </span>
  );
}

/** The tile that leads a book or course, which stands in for its chapters. */
export function BookMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn(MARK, "bg-[color-mix(in_oklch,var(--accent)_18%,transparent)] text-accent", className)}>
      <BookOpen size={14} strokeWidth={1.75} />
    </span>
  );
}
