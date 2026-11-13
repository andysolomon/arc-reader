import { Check } from "lucide-react";
import { cn } from "@readaloud/ui";
import { hostOf } from "../lib/fetchUrl";
import type { PlacedLink } from "../lib/linkPlaces";

/** Every link in the reading as a table, in reading order, listed from the start and checked off as playback passes each one. */
export function DocumentLinks({ links, read }: {
  /** In reading order */
  links: PlacedLink[];
  /** How many of them are behind the listener */
  read: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="m-0 text-[13px] text-fg2">{links.length === 1 ? "1 link" : `${links.length} links`} · {read} read</p>
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <caption className="sr-only">Links in this document, in reading order</caption>
        <thead>
          <tr className="border-b border-line text-[11px] font-medium uppercase tracking-[0.08em] text-fg2">
            <th scope="col" className="py-2 pr-3 font-medium">Link</th>
            <th scope="col" className="w-[34%] py-2 pr-3 font-medium">Site</th>
            <th scope="col" className="w-9 py-2 font-medium"><span className="sr-only">Read</span></th>
          </tr>
        </thead>
        <tbody>
          {links.map((link, i) => {
            const heard = i < read;
            return (
              <tr key={link.url} className={cn("border-b border-line align-top last:border-b-0", !heard && "text-fg2")}>
                <td className="py-2.5 pr-3">
                  <a href={link.url} target="_blank" rel="noreferrer noopener" title={link.url} className="break-words text-inherit underline decoration-fg3 underline-offset-2 hover:decoration-current">
                    {link.text === link.url ? link.url.replace(/^https?:\/\/(www\.)?/i, "") : link.text}
                  </a>
                </td>
                <td className="break-words py-2.5 pr-3 text-fg2">{hostOf(link.url)}</td>
                <td className="py-2.5">
                  {heard ? <Check size={15} strokeWidth={1.5} aria-label="Read" /> : <span className="sr-only">Not read yet</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
