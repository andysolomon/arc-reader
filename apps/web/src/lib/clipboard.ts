import { isNativeApp } from "./native";

/** Read plain text. The iOS shell uses the system pasteboard; the browser uses the async clipboard API. */
export async function readClipboardText(): Promise<string> {
  if (isNativeApp()) {
    const { Clipboard } = await import("@capacitor/clipboard");
    const { value } = await Clipboard.read();
    return value ?? "";
  }
  return navigator.clipboard.readText();
}

/** Write plain text, using the system pasteboard inside the iOS shell. */
export async function writeClipboardText(text: string): Promise<void> {
  if (isNativeApp()) {
    const { Clipboard } = await import("@capacitor/clipboard");
    await Clipboard.write({ string: text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
