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
    let target = { x: 50, y: 50 };
    let lastJump = 0;

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
      const interval = 5000 + Math.random() * 5000; // 5–10s
      if (t - lastJump > interval) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        target = {
          x: 20 + Math.random() * Math.max(20, w - 360),
          y: 20 + Math.random() * Math.max(20, h - 60),
        };
        lastJump = t;
      }
      pos.x += (target.x - pos.x) * 0.04;
      pos.y += (target.y - pos.y) * 0.04;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "16px ui-sans-serif, system-ui, -apple-system, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.30)";
      ctx.fillStyle = "rgba(255,255,255,0.30)";
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
