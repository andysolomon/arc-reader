import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * On-device voice for the iOS shell. The native side is AVSpeechSynthesizer
 * (see ios/App/App/AppDelegate.swift), using the app audio session so reading
 * continues with the screen locked. WKWebView's Web Speech API is not used:
 * it often stays silent, and it stops as soon as the app leaves the foreground.
 */
interface DeviceSpeechPlugin {
  speak(options: { text: string; lang: string; rate: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "boundary",
    listenerFunc: (event: { charIndex: number; charLength: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const DeviceSpeech = registerPlugin<DeviceSpeechPlugin>("DeviceSpeech");

export function listenDeviceSpeech(onBoundary: (charIndex: number) => void): Promise<PluginListenerHandle> {
  return DeviceSpeech.addListener("boundary", (event) => onBoundary(event.charIndex));
}

/** Resolves when the utterance finishes or is stopped. `rate` is a Web Speech rate (1 = normal). */
export function speakOnDevice(text: string, lang: string, rate: number): Promise<void> {
  return DeviceSpeech.speak({ text, lang: lang || "en-US", rate });
}

export function stopDeviceSpeech(): Promise<void> {
  return DeviceSpeech.stop();
}
