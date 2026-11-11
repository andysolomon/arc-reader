import { useEffect, useMemo, useState } from "react";
import { calibrate, type Calibration } from "../lib/premiumEstimate";
import { getDocSpend, getUsageSnapshot, USAGE_EVENT, USAGE_KEY, DOC_SPEND_KEY, type DocSpend } from "../lib/usage";
import { useLibrary } from "./library";
import { useLlm } from "./llm";

export interface PremiumContext {
  calibration: Calibration;
  /** Paid spend per document on this device */
  spend: Record<string, DocSpend[]>;
  /** OpenCode Go is set up, so code and pictures will be explained rather than skipped */
  explainable: boolean;
}

/** Calibration from paid usage and the library, recomputed as new paid audio is made (in any tab). */
export function usePremiumContext(): PremiumContext {
  const items = useLibrary((s) => s.items);
  const llm = useLlm((s) => s.config);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!useLlm.getState().config) void useLlm.getState().load();
    const bump = () => setVersion((v) => v + 1);
    const onStorage = (event: StorageEvent) => { if (event.key === USAGE_KEY || event.key === DOC_SPEND_KEY || event.key === null) bump(); };
    window.addEventListener(USAGE_EVENT, bump);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(USAGE_EVENT, bump); window.removeEventListener("storage", onStorage); };
  }, []);
  return useMemo(() => {
    const spend = getDocSpend();
    return { calibration: calibrate(getUsageSnapshot().rows, spend, items.map((it) => it.rec)), spend, explainable: llm ? llm.configured : true };
  }, [items, llm, version]);
}
