import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useLang } from "./lib/i18n";
import { useRoute } from "./lib/router";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";
import { useGame } from "./state/store";

function Toast() {
  const toast = useGame((s) => s.toast);
  return (
    <div className="toast-host" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            initial={{ y: -16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0 }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  const route = useRoute((s) => s.route);
  const lang = useLang((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
  return (
    <>
      {route.name === "room" ? <RoomPage key={route.code} code={route.code} /> : <Home />}
      <Toast />
    </>
  );
}
