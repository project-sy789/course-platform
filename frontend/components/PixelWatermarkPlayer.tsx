"use client";
import { useEffect, useRef } from "react";
import Hls, { type HlsConfig } from "hls.js";
import { apiFetch, createPlaybackSession, PlaybackSession } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_BASE!;

/**
 * Pixel-watermark player. Renders the HLS stream into an off-screen
 * <video> element, copies each frame onto a visible <canvas>, and stamps
 * the watermark *into the pixel buffer* before display. The visible
 * surface is the canvas; the underlying <video> never appears.
 *
 * Why this is stronger than WatermarkOverlay:
 *   - Screen recorders (OBS, Quicktime, screencapture) capture the canvas,
 *     and the watermark is now part of the picture, not a sibling element
 *     that can be cropped out.
 *   - Devtools deletion of an overlay element does nothing — there is no
 *     overlay; the watermark lives in the same frame buffer as the video.
 *
 * What it costs:
 *   - ~30% more CPU because the GPU's hardware-accelerated path for
 *     <video> is bypassed; we draw frames in JS at requestVideoFrameCallback
 *     cadence (or rAF on browsers that don't support it).
 *   - Picture-in-picture and AirPlay no longer work — the <video> is hidden.
 *   - On very low-end Android the canvas may drop frames.
 *
 * Use only on courses with `pixel_watermark = true` (admin opt-in).
 */
type Props = {
  videoId: string;
  lessonId?: string;
  userEmail: string;
  userId: string;
};

type ProgressResp = {
  position_seconds: number;
  duration_seconds: number;
  completed: boolean;
};

export default function PixelWatermarkPlayer({
  videoId, lessonId, userEmail, userId,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    let hls: Hls | null = null;
    let cancelled = false;
    let progressIv: ReturnType<typeof setInterval> | null = null;
    let drawHandle: number | null = null;
    let useVfc = false;

    (async () => {
      const sess = await createPlaybackSession(videoId);
      if (cancelled || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false })!;

      let resumeAt = 0;
      if (lessonId) {
        try {
          const prog = await apiFetch<ProgressResp>(
            `/api/v1/lessons/${lessonId}/progress`,
          );
          if (prog && prog.position_seconds > 5 && !prog.completed) {
            resumeAt = prog.position_seconds;
          }
        } catch { /* first-time viewer */ }
      }

      // Mount the same hls.js plumbing as SecurePlayer. The <video> tag is
      // hidden via CSS — only the canvas is visible.
      let currentSess: PlaybackSession = sess;
      if (Hls.isSupported()) {
        const BaseLoader: any = (Hls.DefaultConfig as HlsConfig).loader;
        class KeyLoader extends BaseLoader {
          load(context: any, config: any, callbacks: any) {
            if (context.type === "key") {
              context.url = `${API}${currentSess.key_url_template}`;
            }
            return super.load(context, config, callbacks);
          }
        }
        hls = new Hls({
          loader: KeyLoader,
          xhrSetup: (xhr, url) => {
            if (url.startsWith(API) || url.startsWith("/")) {
              xhr.withCredentials = true;
            }
          },
        });
        hls.loadSource(`${API}${sess.manifest_url}`);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = `${API}${sess.manifest_url}`;
      }

      if (resumeAt > 0) {
        video.addEventListener("loadedmetadata", () => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(resumeAt, video.duration - 1);
          }
        }, { once: true });
      }

      // Sync canvas backing-store size to the video's intrinsic dimensions
      // and the CSS box. Re-run on resize so the pixel ratio stays sane.
      const fit = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(canvas);

      // Watermark state. We jitter the position every 5–10s so a recording
      // can't be cropped to a fixed area to remove the mark.
      let pos = { x: 24, y: 32 };
      let target = { x: 24, y: 32 };
      let lastJump = 0;
      let stamp = "";
      const refreshStamp = () => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      refreshStamp();
      const stampIv = setInterval(refreshStamp, 60_000);

      const baseText = `${userEmail} · ${userId.slice(0, 8)}`;

      const drawFrame = (now: number) => {
        if (cancelled) return;
        const cw = canvas.width;
        const ch = canvas.height;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          // Fit the frame into the canvas preserving aspect ratio.
          const vr = video.videoWidth / video.videoHeight;
          const cr = cw / ch;
          let dw = cw, dh = ch, dx = 0, dy = 0;
          if (vr > cr) { dh = cw / vr; dy = (ch - dh) / 2; }
          else { dw = ch * vr; dx = (cw - dw) / 2; }
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(video, dx, dy, dw, dh);

          // Position jitter — pick a new target every 5–10s and ease toward it.
          if (now - lastJump > 5000 + Math.random() * 5000) {
            target = {
              x: Math.max(20, Math.random() * (cw - 360)),
              y: Math.max(40, Math.random() * (ch - 60)),
            };
            lastJump = now;
          }
          pos.x += (target.x - pos.x) * 0.04;
          pos.y += (target.y - pos.y) * 0.04;

          // Burn the watermark into the pixel buffer. Two passes (dark
          // outline + light fill) keep it readable over any background.
          const fontPx = Math.max(14, Math.floor(ch / 60));
          ctx.font = `${fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(0,0,0,0.45)";
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          const text = `${baseText} · ${stamp}`;
          ctx.strokeText(text, pos.x, pos.y);
          ctx.fillText(text, pos.x, pos.y);
        }
        if (useVfc) {
          drawHandle = (video as any).requestVideoFrameCallback(
            (_t: DOMHighResTimeStamp) => drawFrame(performance.now()),
          );
        } else {
          drawHandle = requestAnimationFrame((t) => drawFrame(t));
        }
      };

      // Prefer requestVideoFrameCallback when the browser exposes it — we
      // get exactly one draw per video frame, no over-drawing on pause.
      if (typeof (video as any).requestVideoFrameCallback === "function") {
        useVfc = true;
        drawHandle = (video as any).requestVideoFrameCallback(
          (_t: DOMHighResTimeStamp) => drawFrame(performance.now()),
        );
      } else {
        drawHandle = requestAnimationFrame((t) => drawFrame(t));
      }

      // Progress reporting + simple controls live alongside.
      if (lessonId) {
        const sendProgress = () => {
          if (!video.duration || !Number.isFinite(video.duration)) return;
          const p = Math.floor(video.currentTime);
          if (Math.abs(p - lastSentRef.current) < 5) return;
          lastSentRef.current = p;
          apiFetch(`/api/v1/lessons/${lessonId}/progress`, {
            method: "PUT",
            body: JSON.stringify({
              position_seconds: p,
              duration_seconds: Math.floor(video.duration),
            }),
          }).catch(() => {});
        };
        progressIv = setInterval(() => {
          if (!video.paused) sendProgress();
        }, 10_000);
        video.addEventListener("pause", sendProgress);
        video.addEventListener("ended", sendProgress);
      }

      return () => {
        clearInterval(stampIv);
        ro.disconnect();
      };
    })();

    return () => {
      cancelled = true;
      if (progressIv) clearInterval(progressIv);
      if (drawHandle != null && !useVfc) cancelAnimationFrame(drawHandle);
      hls?.destroy();
    };
  }, [videoId, lessonId, userEmail, userId]);

  // Custom transport controls — the underlying <video> is hidden so its
  // native controls aren't reachable.
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  return (
    <div className="relative w-full h-full bg-black select-none">
      <video
        ref={videoRef}
        // Hidden but still in the document — hls.js needs an attached element.
        // `pointer-events: none` so users can't right-click the raw video.
        className="absolute opacity-0 pointer-events-none w-1 h-1"
        playsInline
        crossOrigin="anonymous"
      />
      <canvas
        ref={canvasRef}
        onClick={togglePlay}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full bg-black cursor-pointer"
        aria-label="วิดีโอ (กดเพื่อเล่น/หยุด)"
      />
    </div>
  );
}
