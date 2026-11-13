import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { reloadOnNewBuild, reloadWhenIdle } from "./lib/appUpdate";
import { isBundledApp, isNativeApp, lockZoom } from "./lib/native";
import { usePlayer } from "./state/player";
import "./styles.css";

// The service worker caches the site for the browser PWA. The iOS shell never
// registers one: on its bundled files a worker can intercept them and leave a
// blank screen, and loaded from the server the shell should show each deploy,
// not a cached copy.
if (isNativeApp()) {
  lockZoom();
  void navigator.serviceWorker?.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  if (!isBundledApp()) reloadOnNewBuild(usePlayer);
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
