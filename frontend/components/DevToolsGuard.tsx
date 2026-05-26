"use client";
import { useEffect, useState } from "react";

// Honest note: DevTools detection is heuristic. A skilled user can bypass it.
// Treat it as friction, not a security boundary.
export default function DevToolsGuard({ onDetect }: { onDetect: () => void }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const trigger = (why: string) => {
      console.warn("[guard]", why);
      setBlocked(true);
      onDetect();
    };

    // 1. Window dimension heuristic (docked devtools)
    const checkSize = () => {
      const w = window.outerWidth - window.innerWidth;
      const h = window.outerHeight - window.innerHeight;
      if (w > 200 || h > 200) trigger("size");
    };
    const sizeIv = setInterval(checkSize, 1000);

    // 2. debugger-statement timing heuristic
    const timingIv = setInterval(() => {
      const t0 = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      if (performance.now() - t0 > 100) trigger("timing");
    }, 2000);

    // 3. Block common shortcuts
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(k)) ||
        (e.metaKey && e.altKey && ["I", "J", "C"].includes(k)) ||
        (e.ctrlKey && k === "U")
      ) {
        e.preventDefault();
        trigger("shortcut");
      }
    };
    window.addEventListener("keydown", onKey);

    // 4. Page-wide right-click block
    const onCtx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", onCtx);

    return () => {
      clearInterval(sizeIv);
      clearInterval(timingIv);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, [onDetect]);

  if (!blocked) return null;
  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex items-center justify-center text-center p-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Playback paused</h1>
        <p className="opacity-80">Developer tools detected. Close them and reload to continue.</p>
      </div>
    </div>
  );
}
