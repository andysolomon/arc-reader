import { isNativeApp } from "./native";

/** Write plain text, using the system pasteboard inside the iOS shell. */
export async function writeClipboardText(text: string): Promise<void> {
  if (isNativeApp()) {
    const { Clipboard } = await import("@capacitor/clipboard");
    await Clipboard.write({ string: text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
