import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLibrary } from "../state/library";
import { useSettings } from "../state/settings";
import { toast } from "../state/toast";
import { fetchReadable, hostOf } from "../lib/fetchUrl";
import { openDocument } from "../lib/openDoc";

/**
 * Web Share Target: /read/new?title=&text=&url=
 * Auto-plays only when "Auto-play on share" is on; otherwise the Reader opens paused.
 */
export function ReadNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const autoplay = useSettings.getState().autoplayShare;
    const create = useLibrary.getState().create;
    (async () => {
      const text = params.get("text")?.trim() ?? "";
      const title = params.get("title")?.trim() || undefined;
      let url = params.get("url")?.trim() ?? "";
      if (!url && /^https?:\/\/\S+$/i.test(text)) url = text;
      try {
        if (url) {
          toast(`Fetching ${hostOf(url)}…`);
          const f = await fetchReadable(url);
          const rec = await create({ text: f.text, title: title ?? f.title, source: "share", domain: f.domain });
          await openDocument(rec, navigate, { autoplay, resume: false, replace: true });
          return;
        }
        if (text) {
          const rec = await create({ text, title, source: "share", domain: "Shared" });
          await openDocument(rec, navigate, { autoplay, resume: false, replace: true });
          return;
        }
        navigate("/", { replace: true });
      } catch {
        toast("Couldn't read what was shared");
        navigate("/", { replace: true });
      }
    })();
  }, [params, navigate]);
  return (
    <section className="flex flex-1 flex-col px-6 pt-12" aria-busy="true" aria-label="Opening shared content">
      <div className="mx-auto flex w-full max-w-measure flex-col gap-3 font-serif text-[19px]">
        <span className="block h-[1.2em] w-full animate-pulse rounded-[6px] bg-bg3 motion-reduce:animate-none" />
        <span className="block h-[1.2em] w-[80%] animate-pulse rounded-[6px] bg-bg3 motion-reduce:animate-none" />
      </div>
    </section>
  );
}
