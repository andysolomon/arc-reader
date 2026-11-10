import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { reloadWhenIdle } from "./lib/appUpdate";
import { isNativeApp } from "./lib/native";
import { usePlayer } from "./state/player";
import "./styles.css";

// The service worker caches the site for the browser PWA. Inside the iOS shell
// the assets are already in the bundle, and a worker on the capacitor scheme
// can intercept them and leave a blank screen. Never register one there.
if (isNativeApp()) {
  void navigator.serviceWorker?.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
} else {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true, onNeedReload: () => reloadWhenIdle(usePlayer) });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
