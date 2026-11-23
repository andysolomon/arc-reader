import { useMemo, useState } from "react";
import { BookOpen, ClipboardList, FileText, Globe, Library as LibraryIcon } from "lucide-react";
import { cn } from "@readaloud/ui";
import type { DocRecord } from "../lib/db";
import { useWorking } from "../state/preparation";
import { useCovers } from "../state/covers";
import { useSettings } from "../state/settings";
import { CoverThumb } from "./Cover";

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

const MARK = "relative grid size-6 shrink-0 place-items-center rounded-[7px]";
/** While audio is being made, an arc circles the tile; the words beside it say so for screen readers. */
const ORBIT = "mark-orbit";
const NONE: readonly string[] = [];

/** The tile that leads a document wherever it is listed: where it came from. */
export function SourceMark({ rec, className }: { rec: Pick<DocRecord, "id" | "source" | "domain">; className?: string }) {
  const working = useWorking(useMemo(() => [rec.id], [rec.id]));
  return (
    <span className={cn(MARK, "bg-bg3 ring-1 ring-line", working && ORBIT, className)}>
      <SourceIcon rec={rec} />
    </span>
  );
}

/** What leads a document in the Library: its cover once it has one, until then where it came from. */
export function DocMark({ rec, className }: { rec: Pick<DocRecord, "id" | "source" | "domain">; className?: string }) {
  const url = useCovers((s) => s.shelf[rec.id]?.url);
  const shown = useSettings((s) => s.showCovers);
  const working = useWorking(useMemo(() => [rec.id], [rec.id]));
  if (!url || !shown) return <SourceMark rec={rec} className={className} />;
  // Taller than a line of title: in a list row it stands beside the title, facts and status together.
  return <span className={cn("relative row-span-3 grid shrink-0 self-start", working && ORBIT, className)}><CoverThumb url={url} /></span>;
}

/** The tile that leads a series, which stands in for its volumes. */
export function SeriesMark({ docIds = NONE, className }: { docIds?: readonly string[]; className?: string }) {
  const working = useWorking(docIds);
  return (
    <span aria-hidden className={cn(MARK, "bg-[color-mix(in_oklch,var(--accent)_18%,transparent)] text-accent", working && ORBIT, className)}>
      <LibraryIcon size={14} strokeWidth={1.75} />
    </span>
  );
}

/** The tile that leads a book or course, which stands in for its chapters. */
export function BookMark({ docIds = NONE, className }: { docIds?: readonly string[]; className?: string }) {
  const working = useWorking(docIds);
  return (
    <span aria-hidden className={cn(MARK, "bg-[color-mix(in_oklch,var(--accent)_18%,transparent)] text-accent", working && ORBIT, className)}>
      <BookOpen size={14} strokeWidth={1.75} />
    </span>
  );
}
