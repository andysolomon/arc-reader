import { isNativeApp } from "./native";

export type Saved = "shared" | "downloaded" | "cancelled";

/**
 * Hand a file to the person. The iPhone app has no downloads, so it opens the share sheet
 * (Save to Files, AirDrop, another app); browsers download it.
 *
 * Sharing reports whether the person finished, so "shared" means the file went somewhere.
 * A download can't be followed, so "downloaded" only means the browser was given it.
 */
export async function saveFile(file: File): Promise<Saved> {
  if (isNativeApp()) {
    // The app's web view has no downloads, so a link would do nothing at all.
    if (typeof navigator.share !== "function" || navigator.canShare?.({ files: [file] }) === false) throw new Error("This device can’t share files from the app. Open ReadAloud in Safari to save it.");
    try {
      await navigator.share({ files: [file], title: file.name });
      return "shared";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "cancelled";
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // The download reads the file after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}
