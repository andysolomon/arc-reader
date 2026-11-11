import { useState } from "react";
import { Check } from "lucide-react";
import { Segmented, cn } from "@readaloud/ui";
import { hostOf } from "../lib/fetchUrl";
import type { PlacedLink } from "../lib/linkPlaces";

/**
 * The reading's links as a table. "Read" fills in as playback passes each link, newest first;
 * "All" lists every link in reading order and marks the ones already read.
 */
export function DocumentLinks({ links, read }: {
  /** In reading order */
  links: PlacedLink[];
  /** How many of them are behind the listener */
  read: number;
}) {
  const [view, setView] = useState<"read" | "all">("read");
  const all = view === "all";
  const rows = all ? links : links.slice(0, read).reverse();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Segmented
        value={view}
        onChange={setView}
        label="Links to show"
        options={[{ value: "read", label: `Read ${read}` }, { value: "all", label: `All ${links.length}` }]}
      />
      {rows.length ? (
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <caption className="sr-only">{all ? "All links in this document" : "Links read so far, newest first"}</caption>
          <thead>
            <tr className="border-b border-line text-[11px] font-medium uppercase tracking-[0.08em] text-fg2">
              <th scope="col" className="py-2 pr-3 font-medium">Link</th>
              <th scope="col" className="w-[34%] py-2 pr-3 font-medium">Site</th>
              {all && <th scope="col" className="w-9 py-2 font-medium"><span className="sr-only">Read</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((link, i) => {
              const heard = !all || i < read;
              return (
                <tr key={link.url} className={cn("border-b border-line align-top last:border-b-0", !heard && "text-fg2")}>
                  <td className="py-2.5 pr-3">
                    <a href={link.url} target="_blank" rel="noreferrer noopener" title={link.url} className="break-words text-inherit underline decoration-fg3 underline-offset-2 hover:decoration-current">
                      {link.text === link.url ? link.url.replace(/^https?:\/\/(www\.)?/i, "") : link.text}
                    </a>
                  </td>
                  <td className="break-words py-2.5 pr-3 text-fg2">{hostOf(link.url)}</td>
                  {all && (
                    <td className="py-2.5">
                      {heard ? <Check size={15} strokeWidth={1.5} aria-label="Read" /> : <span className="sr-only">Not read yet</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="m-0 text-[13px] leading-relaxed text-fg2">Links are added here as they are read. Choose All to see every link in this document.</p>
      )}
    </div>
  );
}
