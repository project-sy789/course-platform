"use client";
import { useEffect, useState } from "react";

/**
 * DevTools detection + anti-tamper guard. Heuristic, not a security boundary.
 *
 * Layers:
 *   1. Window dimension delta (docked devtools)
 *   2. Periodic `debugger;` timing — devtools open ⇒ pause takes >100ms
 *   3. Keyboard shortcut block (F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C, Ctrl+U)
 *   4. Right-click block
 *   5. `console.log` getter trap — devtools pretty-prints inspected objects
 *      by reading their properties, which fires our getter even if no human
 *      typed anything
 *   6. `Function.prototype.toString` integrity check — common bypass scripts
 *      monkey-patch this to hide their hooks; we keep a reference at module
 *      load and re-verify it periodically
 */
export default function DevToolsGuard({ onDetect }: { onDetect: () => void }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let fired = false;
    const trigger = (why: string) => {
      if (fired) return;
      fired = true;
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

    // 2. debugger-statement timing heuristic. Wrapped in a Function() so the
    //    raw `debugger` token isn't trivially greppable by an obfuscation-stripper.
    const dbgPing = new Function("t0", "debugger; return performance.now() - t0;");
    const timingIv = setInterval(() => {
      const t0 = performance.now();
      try {
        const delta = dbgPing(t0);
        if (delta > 100) trigger("timing");
      } catch { /* devtools blocked execution — also suspicious */ }
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

    // 5. console.log getter trap. Drop a sentinel object into console.log —
    //    if devtools is open and "Preserve log" or auto-inspect is on, it
    //    reads `.id` to render the object, which fires our getter.
    const trap = {} as { id?: string };
    Object.defineProperty(trap, "id", {
      get() { trigger("console-inspect"); return ""; },
    });
    // Logging the trap itself shouldn't visibly print anything users care
    // about. The .toString override gives us a clean string in case devtools
    // is closed (no inspect → getter never fires).
    (trap as unknown as { toString: () => string }).toString = () => "";
    // Re-arm on a short cadence so devtools opened mid-session still fires.
    const trapIv = setInterval(() => {
      // eslint-disable-next-line no-console
      console.log(trap);
      // Clear immediately so the console isn't polluted.
      // (devtools still inspects the object asynchronously before this hits.)
      // eslint-disable-next-line no-console
      console.clear?.();
    }, 4000);

    // 6. Function.prototype.toString integrity. Hooking libraries (e.g. some
    //    deobfuscators, content-extracting userscripts) replace this to hide
    //    their patches. We freeze a reference at mount and verify the live
    //    method still produces native-code output for a known builtin.
    const FN_TS = Function.prototype.toString;
    const integrityIv = setInterval(() => {
      try {
        const live = Function.prototype.toString;
        // The reference must be identical AND yield "[native code]" for
        // a builtin. Both checks together catch swap + proxy patterns.
        if (live !== FN_TS) return trigger("fn-toString-swapped");
        if (!/\[native code\]/.test(live.call(Array.prototype.push))) {
          trigger("fn-toString-patched");
        }
      } catch {
        trigger("fn-toString-throw");
      }
    }, 3000);

    return () => {
      clearInterval(sizeIv);
      clearInterval(timingIv);
      clearInterval(trapIv);
      clearInterval(integrityIv);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, [onDetect]);

  if (!blocked) return null;
  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex items-center justify-center text-center p-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">หยุดการเล่นชั่วคราว</h1>
        <p className="opacity-80">
          ตรวจพบการเปิดเครื่องมือนักพัฒนา (Developer Tools) กรุณาปิดและรีเฟรชหน้าเพื่อเล่นต่อ
        </p>
      </div>
    </div>
  );
}
