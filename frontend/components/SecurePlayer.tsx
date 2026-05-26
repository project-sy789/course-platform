"use client";
import { useEffect, useRef } from "react";
import Hls, { type HlsConfig } from "hls.js";
import { apiFetch, createPlaybackSession } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_BASE!;

type Props = {
  videoId: string;
  // Optional: lesson context drives progress tracking + resume-from-last.
  lessonId?: string;
};

type ProgressResp = {
  position_seconds: number;
  duration_seconds: number;
  completed: boolean;
};

export default function SecurePlayer({ videoId, lessonId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    let hls: Hls | null = null;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const sess = await createPlaybackSession(videoId);
      if (cancelled || !videoRef.current) return;
      const video = videoRef.current;

      // Resume from last position (if we have a lesson + prior progress).
      let resumeAt = 0;
      if (lessonId) {
        try {
          const prog = await apiFetch<ProgressResp>(
            `/api/v1/lessons/${lessonId}/progress`,
          );
          if (prog && prog.position_seconds > 5 && !prog.completed) {
            resumeAt = prog.position_seconds;
          }
        } catch {
          /* first-time viewer or no enrollment surfaced via require_enrollment;
             playback session creation would have failed first anyway. */
        }
      }

      if (Hls.isSupported()) {
        const BaseLoader: any = (Hls.DefaultConfig as HlsConfig).loader;

        class KeyRewritingLoader extends BaseLoader {
          load(context: any, config: any, callbacks: any) {
            if (context.type === "key") {
              context.url = `${API}${sess.key_url_template}`;
            }
            return super.load(context, config, callbacks);
          }
        }

        hls = new Hls({
          loader: KeyRewritingLoader,
          xhrSetup: (xhr, url) => {
            if (url.startsWith(API)) xhr.withCredentials = true;
          },
        });
        hls.loadSource(sess.manifest_url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = sess.manifest_url;
      }

      if (resumeAt > 0) {
        const seek = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(resumeAt, video.duration - 1);
          }
        };
        video.addEventListener("loadedmetadata", seek, { once: true });
      }

      if (!lessonId) return;

      // Persist progress every ~10s while playing, plus on pause/unmount.
      // Skipping rapid scrubs keeps DB writes low.
      const sendProgress = () => {
        if (!video.duration || !Number.isFinite(video.duration)) return;
        const pos = Math.floor(video.currentTime);
        if (Math.abs(pos - lastSentRef.current) < 5) return;
        lastSentRef.current = pos;
        apiFetch(`/api/v1/lessons/${lessonId}/progress`, {
          method: "PUT",
          body: JSON.stringify({
            position_seconds: pos,
            duration_seconds: Math.floor(video.duration),
          }),
        }).catch(() => {});
      };

      interval = setInterval(() => {
        if (!video.paused) sendProgress();
      }, 10_000);

      video.addEventListener("pause", sendProgress);
      video.addEventListener("ended", sendProgress);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      hls?.destroy();
    };
  }, [videoId, lessonId]);

  return (
    <video
      ref={videoRef}
      controls
      controlsList="nodownload noplaybackrate noremoteplayback"
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      className="w-full h-full bg-black"
      playsInline
    />
  );
}
