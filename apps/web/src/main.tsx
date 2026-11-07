import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { reloadWhenIdle } from "./lib/appUpdate";
import { usePlayer } from "./state/player";
import "./styles.css";

registerSW({ immediate: true, onNeedReload: () => reloadWhenIdle(usePlayer) });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
