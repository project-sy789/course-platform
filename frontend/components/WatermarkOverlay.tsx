"use client";
import { useEffect, useRef } from "react";

type Props = {
  userEmail: string;
  userId: string;
  clientIp?: string;
};

export default function WatermarkOverlay({ userEmail, userId, clientIp }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const parent = canvas.parentElement!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let pos = { x: 50, y: 50 };
    let lastJump = -Infinity;
    // Hold-then-hop cycle: stationary for HOLD_MS, fade out over FADE_MS,
    // snap to a new spot, fade back in. A stationary mark sits in
    // peripheral vision unobtrusively — it's the constant drift that
    // makes the eye chase it.
    const HOLD_MS = 15000;
    const FADE_MS = 600;

    const baseText = `${userEmail} • ${userId.slice(0, 8)}${clientIp ? " • " + clientIp : ""}`;
    let stamp = "";
    const refreshStamp = () => {
      // Re-stamp every minute so leaked recordings inline a timestamp
      // alongside the user identifier — combined with the random-jump
      // position this lets us tie a leaked clip back to a specific
      // (account, minute).
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    refreshStamp();
    const stampTimer = window.setInterval(refreshStamp, 60_000);

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);

    const draw = (t: number) => {
      const cycle = HOLD_MS + FADE_MS * 2;
      if (t - lastJump > cycle) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        pos = {
          x: 20 + Math.random() * Math.max(20, w - 360),
          y: 20 + Math.random() * Math.max(20, h - 60),
        };
        lastJump = t;
      }
      // Triangle envelope: fade in, hold, fade out.
      const phase = t - lastJump;
      let alpha = 1;
      if (phase < FADE_MS) alpha = phase / FADE_MS;
      else if (phase > FADE_MS + HOLD_MS) alpha = 1 - (phase - FADE_MS - HOLD_MS) / FADE_MS;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "14px ui-sans-serif, system-ui, -apple-system, sans-serif";
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(0,0,0,${0.22 * alpha})`;
      ctx.fillStyle = `rgba(255,255,255,${0.22 * alpha})`;
      const text = `${baseText} • ${stamp}`;
      ctx.strokeText(text, pos.x, pos.y);
      ctx.fillText(text, pos.x, pos.y);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(stampTimer);
      ro.disconnect();
    };
  }, [userEmail, userId, clientIp]);

  return (
    <canvas
      ref={canvasRef}
      data-watermark="overlay"
      className="wm-overlay pointer-events-none absolute inset-0 z-10"
      aria-hidden
    />
  );
}
