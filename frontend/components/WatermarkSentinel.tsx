"use client";
import { useEffect } from "react";

/**
 * Watch the watermark canvas for tampering. If a thief opens devtools and
 * deletes the canvas node, sets it `display:none`, drops its opacity, or
 * detaches it from the DOM, we call `onTamper` so the page can pause
 * playback and surface a warning.
 *
 * This isn't a crypto-grade defence — anything running locally can be
 * patched. It's the "every additional minute is friction" layer: a
 * MutationObserver fires synchronously, so by the time the patched DOM is
 * visible the playback has already paused.
 *
 * Usage: place this inside the same parent that wraps SecurePlayer +
 * WatermarkOverlay, with `overlaySelector` pointing at the canvas.
 */
type Props = {
  overlaySelector: string;
  onTamper: (reason: string) => void;
};

export default function WatermarkSentinel({ overlaySelector, onTamper }: Props) {
  useEffect(() => {
    let cancelled = false;
    const fire = (reason: string) => {
      if (cancelled) return;
      cancelled = true;
      onTamper(reason);
    };

    const overlay = document.querySelector<HTMLElement>(overlaySelector);
    if (!overlay) {
      // Overlay never mounted — treat as tamper.
      fire("overlay missing");
      return;
    }
    const parent = overlay.parentElement!;

    // 1. Watch the parent for child removals — catches the canvas being
    //    detached entirely from the DOM tree.
    const treeObs = new MutationObserver((muts) => {
      for (const m of muts) {
        m.removedNodes.forEach((n) => {
          if (n === overlay) fire("overlay removed from tree");
        });
      }
    });
    treeObs.observe(parent, { childList: true });

    // 2. Watch the overlay itself for style/attribute mutation. CSS is the
    //    cheap way to defeat the watermark — opacity 0, display none, z-index
    //    behind the player. We re-check on every change.
    const styleObs = new MutationObserver(() => {
      const cs = getComputedStyle(overlay);
      const opacity = parseFloat(cs.opacity);
      if (cs.display === "none" || cs.visibility === "hidden") {
        fire("overlay hidden");
        return;
      }
      if (opacity < 0.1) {
        fire(`overlay opacity ${opacity}`);
        return;
      }
      const z = parseInt(cs.zIndex || "0", 10);
      if (z < 1) {
        fire(`overlay z-index ${z}`);
        return;
      }
    });
    styleObs.observe(overlay, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });

    // 3. Periodic sanity poll — covers the case where someone replaces the
    //    canvas with a same-tag fake node (treeObs sees an add+remove pair
    //    that may technically pass), or shrinks it to 1×1 px via JS.
    const poll = window.setInterval(() => {
      const live = document.querySelector<HTMLElement>(overlaySelector);
      if (!live || live !== overlay) {
        fire("overlay swapped");
        return;
      }
      const r = overlay.getBoundingClientRect();
      if (r.width < 50 || r.height < 20) {
        fire(`overlay shrunk ${r.width}x${r.height}`);
      }
    }, 1500);

    return () => {
      treeObs.disconnect();
      styleObs.disconnect();
      window.clearInterval(poll);
    };
  }, [overlaySelector, onTamper]);

  return null;
}
