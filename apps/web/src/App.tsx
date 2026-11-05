import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { applyTheme, getTheme } from "@readaloud/tokens";
import { Shell } from "./components/Shell";
import { Compose } from "./routes/Compose";
import { Reader } from "./routes/Reader";
import { ReadNew } from "./routes/ReadNew";
import { LibraryPage } from "./routes/Library";
import { VoicesPage } from "./routes/Voices";
import { SettingsPage } from "./routes/Settings";
import { LinuxPage } from "./routes/Linux";
import { AuthPage } from "./routes/Auth";
import { useThemeId } from "./state/settings";
import { useLibrary } from "./state/library";

function ThemeSync() {
  const id = useThemeId();
  useEffect(() => {
    applyTheme(id);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getTheme(id).colors.bg);
  }, [id]);
  return null;
}

export default function App() {
  useEffect(() => {
    void useLibrary.getState().refresh();
  }, []);
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <ThemeSync />
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Compose />} />
            <Route path="/read/new" element={<ReadNew />} />
            <Route path="/read/:id" element={<Reader />} />
            <Route path="/library" element={<LibraryPage />} />
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
