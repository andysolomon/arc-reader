import { useEffect, useState } from "react";
import { Button, Dialog } from "@readaloud/ui";
import { audioCache, audioLimitFor, type AudioUsage } from "../lib/db";
import { deviceStorage, formatBytes, keepStorage, type DeviceStorage } from "../lib/storage";
import { isNativeApp } from "../lib/native";
import { hasFish, hasOpenAI } from "../engine/providers";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";

function Row({ label, hint, children, last }: { label: string; hint: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3.5 ${last ? "" : "border-b border-line"}`}>
      <div className="min-w-0">
        <div>{label}</div>
        <div className="text-[13px] text-fg2">{hint}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

const Amount = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-[13px] tabular-nums text-fg2">{children}</span>;

/** What ReadAloud keeps on this device, how much it may keep, and a way to give the space back. */
export function StorageSettings() {
  const [audio, setAudio] = useState<AudioUsage | null>(null);
  const [device, setDevice] = useState<DeviceStorage>({});
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const [usage, storage] = await Promise.all([audioCache.usage().catch(() => null), deviceStorage()]);
      if (!live) return;
      setAudio(usage);
      setDevice(storage);
    };
    void refresh();
    // Passages arrive in bursts while a reading is prepared, so measure at most once a second.
    const unsubscribe = audioCache.subscribe(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void refresh(); }, 1000);
    });
    window.addEventListener("focus", refresh);
    return () => { live = false; unsubscribe(); clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, []);

  const limit = formatBytes(audioLimitFor(device.allowed));
  const passages = audio ? (audio.clips === 1 ? "1 passage" : `${audio.clips.toLocaleString()} passages`) : "";
  const policy = `Up to ${limit} is kept; the oldest is removed first.`;

  const remove = async () => {
    setRemoving(true);
    try {
      await audioCache.clear();
      setAudio({ clips: 0, bytes: 0 });
      setDevice(await deviceStorage());
      void useLibrary.getState().refresh();
      toast("Downloaded audio removed");
    } catch {
      toast("Couldn't remove the downloaded audio");
    }
    setRemoving(false);
    setConfirming(false);
  };

  const keep = async () => {
    setAsking(true);
    const kept = await keepStorage();
    setAsking(false);
    setDevice((d) => ({ ...d, kept }));
    if (!kept) toast(isNativeApp() ? "This device didn't allow it" : "The browser didn't allow it. It usually does once ReadAloud is installed as an app.", 6000);
  };

  return (
    <div role="region" aria-label="Storage" className="flex flex-col rounded-panel border border-line bg-bg2">
      <Row
        label="Downloaded audio"
        hint={audio === null ? "Measuring…" : audio.clips ? `${passages} saved to replay and to listen offline. ${policy}` : `Nothing saved yet. ${policy}`}
        last={device.used === undefined && device.kept === undefined}
      >
        {audio && <Amount>{formatBytes(audio.bytes)}</Amount>}
        <Button variant="danger" disabled={!audio?.clips} onClick={() => setConfirming(true)} className="bg-bg">Remove</Button>
      </Row>
      {device.used !== undefined && (
        <Row
          label="Everything on this device"
          hint={`Documents, audio, settings and the app itself.${device.allowed ? ` This browser allows up to ${formatBytes(device.allowed)}.` : ""}`}
          last={device.kept === undefined}
        >
          <Amount>{formatBytes(device.used)}</Amount>
        </Row>
      )}
      {device.kept !== undefined && (
        <Row
          label="Keep when space runs low"
          hint={device.kept
            ? "The browser won’t clear what ReadAloud saved to free up space."
            : "Until this is on, the browser may clear what ReadAloud saved, including downloaded audio and changes that haven’t synced, when the device runs low on space."}
          last
        >
          {device.kept ? <Amount>On</Amount> : <Button loading={asking} onClick={() => void keep()} className="bg-bg">Turn on</Button>}
        </Row>
      )}
      <Dialog open={confirming} onClose={() => { if (!removing) setConfirming(false); }} title="Remove downloaded audio?">
        <p className="text-sm text-fg2">
          {audio ? `${formatBytes(audio.bytes)} of saved audio` : "Saved audio"} is removed from this device. Your documents and your place in each stay.
          {" "}Listening again makes or downloads the audio again{hasOpenAI() || hasFish() ? ", and paid voices bill for it again" : ""}.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setConfirming(false)} disabled={removing}>Cancel</Button>
          <Button variant="danger" loading={removing} onClick={() => void remove()}>Remove audio</Button>
        </div>
      </Dialog>
    </div>
  );
}
