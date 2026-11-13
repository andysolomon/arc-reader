import { useEffect, useState } from "react";
import { Button } from "@readaloud/ui";
import { jsonBody, studioJson } from "../../lib/studio";
import { ErrorNotice, useOperation } from "./shared";

interface ModelTerms {
  repo_id: string;
  info: { license: string; notes: string; evidence_url?: string; source_url?: string };
  acceptance: { accepted: boolean; fingerprint: string; category: string };
}
const MODELS = ["k2-fsa/OmniVoice", "eustlb/higgs-audio-v2-tokenizer"];
export function ModelTerms() {
  const [models, setModels] = useState<ModelTerms[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const op = useOperation();
  useEffect(() => {
    const ac = new AbortController();
    void Promise.all(MODELS.map((repo) => studioJson<ModelTerms>(`/models/licenses/details/${repo}`, { signal: ac.signal })))
      .then(setModels).catch((e: Error) => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, []);
  if (!models.length && !error) return null;
  const pending = models.filter((m) => !m.acceptance.accepted);
  if (!pending.length && !error) return null;
  return <div className="rounded-control border border-line bg-bg2 p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><p>{error ? "Could not check voice model terms." : "Voice generation needs model license acceptance."}</p><Button onClick={() => setOpen(!open)}>{open ? "Hide model terms" : "Review model terms"}</Button></div>
    {open && <div className="mt-4 flex flex-col gap-4">
      <p className="text-fg2">These disclosures come from VoiceStudio. Review the linked terms before confirming that your use is permitted.</p>
      {pending.map((model) => <div key={model.repo_id} className="flex flex-col gap-3 rounded-control border border-line p-4">
        <h3 className="break-all font-semibold">{model.repo_id}</h3><p>{model.info.license} · {model.acceptance.category}</p><p className="text-fg2">{model.info.notes}</p>
        {model.info.evidence_url?.startsWith("https://") && <a className="underline" href={model.info.evidence_url} target="_blank" rel="noreferrer">Read model terms and evidence</a>}
        <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={!!checked[model.repo_id]} onChange={(e) => setChecked((c) => ({ ...c, [model.repo_id]: e.target.checked }))} /><span>I have reviewed these terms and have the rights required for my use of {model.repo_id}.</span></label>
        <Button className="self-start" disabled={!checked[model.repo_id] || op.busy} onClick={() => void op.run(async (signal) => {
          const acceptance = await studioJson<ModelTerms["acceptance"]>("/models/licenses/accept", { ...jsonBody({ repo_id: model.repo_id, fingerprint: model.acceptance.fingerprint, accepted: true }), signal });
          setModels((before) => before.map((m) => m.repo_id === model.repo_id ? { ...m, acceptance } : m));
        })}>Accept terms for this model</Button>
      </div>)}
      <ErrorNotice error={op.error || error} />
    </div>}
  </div>;
}
