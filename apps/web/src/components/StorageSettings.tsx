import { useEffect, useState } from "react";
import { Button, Dialog, Segmented } from "@readaloud/ui";
import { audioCache, AUDIO_CACHE_ROOM, type AudioUsage } from "../lib/db";
import { audioLimitChoicesFor, audioLimitFor, mostAudioFor, type AudioLimitChoice } from "../lib/audioLimit";
import { deviceStorage, formatBytes, keepStorage, type DeviceStorage } from "../lib/storage";
import { isNativeApp } from "../lib/native";
import { hasFish, hasOpenAI } from "../engine/providers";
import { useLibrary } from "../state/library";
import { useSettings } from "../state/settings";
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
  const choice = useSettings((s) => s.audioLimit);
  /** A smaller amount than the audio already saved, waiting for the person to agree to removing the rest. */
  const [shrinking, setShrinking] = useState<AudioLimitChoice>(choice);
  const [askingToShrink, setAskingToShrink] = useState(false);

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

  const passages = audio ? (audio.clips === 1 ? "1 passage" : `${audio.clips.toLocaleString()} passages`) : "";
  const choices = audioLimitChoicesFor(device.allowed);
  // A saved amount past what the browser now allows works out to the most it allows.
  const shown = choices.includes(choice) ? choice : "max";
  const most = mostAudioFor(device.allowed);
  const limitOf = (next: AudioLimitChoice) => audioLimitFor(device.allowed, next);
  /** Audio removed to fit a smaller amount: making room stops a little below it. */
  const removedFor = (next: AudioLimitChoice) => (audio ? Math.max(0, audio.bytes - limitOf(next) * AUDIO_CACHE_ROOM) : 0);

  const choose = (next: AudioLimitChoice) => {
    if (next === shown) return;
    if (audio && audio.bytes > limitOf(next)) { setShrinking(next); setAskingToShrink(true); }
    else useSettings.getState().set("audioLimit", next);
  };

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
        hint={audio === null ? "Measuring…" : audio.clips ? `${passages} saved to replay and to listen offline.` : "Nothing saved yet."}
      >
        {audio && <Amount>{formatBytes(audio.bytes)}</Amount>}
        <Button variant="danger" disabled={!audio?.clips} onClick={() => setConfirming(true)} className="bg-bg">Remove</Button>
      </Row>
      <div className={`flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${device.used === undefined && device.kept === undefined ? "" : "border-b border-line"}`}>
        <div className="min-w-0">
          <div>Keep up to</div>
          <div className="text-[13px] text-fg2">
            Past this, the oldest audio is removed first.{most ? ` Max is half of what this browser allows: ${formatBytes(most)}.` : ""}
          </div>
        </div>
        <Segmented
          label="Downloaded audio to keep"
          value={shown}
          onChange={choose}
          options={choices.map((c) => ({ value: c, label: c === "max" ? "Max" : `${c} GB` }))}
          className="shrink-0 flex-wrap"
        />
      </div>
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
      <Dialog open={askingToShrink} onClose={() => setAskingToShrink(false)} title={`Keep up to ${formatBytes(limitOf(shrinking))}?`}>
        <p className="text-sm text-fg2">
          The oldest {formatBytes(removedFor(shrinking))} of downloaded audio is removed from this device to fit.
          {" "}Listening to it again makes or downloads it again{hasOpenAI() || hasFish() ? ", and paid voices bill for it again" : ""}.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setAskingToShrink(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { useSettings.getState().set("audioLimit", shrinking); setAskingToShrink(false); }}>Remove older audio</Button>
        </div>
      </Dialog>
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
