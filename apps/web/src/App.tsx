import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { applyTheme, getTheme } from "@readaloud/tokens";
import { Shell } from "./components/Shell";
import { Compose } from "./routes/Compose";
import { Reader } from "./routes/Reader";
import { ReadNew } from "./routes/ReadNew";
import { LibraryPage } from "./routes/Library";
import { StudioPage } from "./routes/Studio";
import { VoicesPage } from "./routes/Voices";
import { SettingsPage } from "./routes/Settings";
import { LinuxPage } from "./routes/Linux";
import { AuthPage } from "./routes/Auth";
import { syncStatusBar } from "./lib/native";
import { useThemeId } from "./state/settings";
import { useLibrary } from "./state/library";
import { useVoices } from "./state/voices";
import { startLibrarySync } from "./lib/librarySync";
import { usePreparation } from "./state/preparation";

function ThemeSync() {
  const id = useThemeId();
  useEffect(() => {
    const theme = getTheme(id);
    applyTheme(id);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.colors.bg);
    void syncStatusBar(theme.scheme, theme.colors.bg);
  }, [id]);
  return null;
}

/**
 * The front door. A phone opens on its documents; a wider screen already lists them in the
 * sidebar, so it opens ready to add one. Decided once per visit, so turning or resizing the
 * screen never swaps the page under you.
 */
function Home() {
  const [phone] = useState(() => window.matchMedia("(max-width: 639.98px)").matches);
  return phone ? <LibraryPage /> : <Compose />;
}

export default function App() {
  useEffect(() => {
    void useLibrary.getState().refresh();
    void useVoices.getState().load();
    // iOS aborts requests while the app is in the background, which can leave saved voices unnamed.
    const reloadVoices = () => {
      if (document.visibilityState === "visible" && !useVoices.getState().voices.some((v) => v.kind === "profile")) void useVoices.getState().loadServer();
    };
    document.addEventListener("visibilitychange", reloadVoices);
    const stopSync = startLibrarySync(() => {
      void useLibrary.getState().refresh();
      void usePreparation.getState().refreshShared().then(() => useLibrary.getState().refresh());
    });
    return () => { document.removeEventListener("visibilitychange", reloadVoices); stopSync(); };
  }, []);
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <ThemeSync />
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="/compose" element={<Compose />} />
            <Route path="/read/new" element={<ReadNew />} />
            <Route path="/read/:id" element={<Reader />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/:tool" element={<StudioPage />} />
            <Route path="/voices" element={<VoicesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/linux" element={<LinuxPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
