"use client";
import { useEffect, useRef } from "react";
import Hls, { type HlsConfig } from "hls.js";
import { apiFetch, createPlaybackSession, PlaybackSession } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_BASE!;

type Props = {
  videoId: string;
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
    // Single-flight guard so a burst of expired-key errors doesn't trigger
    // N concurrent session re-mints.
    let renewing: Promise<PlaybackSession> | null = null;
    let recoverAttempts = 0;
    const MAX_RECOVERS = 5;

    const mountHls = (sess: PlaybackSession, resumeAt: number) => {
      if (!videoRef.current) return;
      const video = videoRef.current;

      if (Hls.isSupported()) {
        const BaseLoader: any = (Hls.DefaultConfig as HlsConfig).loader;

        class KeyRewritingLoader extends BaseLoader {
          load(context: any, config: any, callbacks: any) {
            if (context.type === "key") {
              // Always pull the freshest key URL from the current session.
              context.url = `${API}${currentSess.key_url_template}`;
            }
            return super.load(context, config, callbacks);
          }
        }

        // Mutable holder so the loader closure picks up renewed sessions
        // without us having to rebuild the Hls instance.
        // eslint-disable-next-line prefer-const
        let currentSess: PlaybackSession = sess;

        hls = new Hls({
          loader: KeyRewritingLoader as unknown as HlsConfig["loader"],
          xhrSetup: (xhr, url) => {
            if (url.startsWith(API) || url.startsWith("/")) {
              xhr.withCredentials = true;
            }
          },
          // hls.js's built-in retries cover the common case of one bad packet.
          // We layer session-re-mint on top for the "everything 403'd because
          // the session expired" case.
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 4,
        });

        hls.on(Hls.Events.ERROR, async (_evt, data) => {
          // Network errors with HTTP 403/404 on key/manifest/fragment are
          // the signature of a single-use token that lost the race with
          // hls.js's internal retry. Renew the session and reload from the
          // current playback position — much better UX than ending playback.
          if (!data.fatal) return;
          const status: number | undefined = data.response?.code;
          const isTokenExpiry =
            (data.type === "networkError") &&
            (status === 403 || status === 404);
          if (!isTokenExpiry || recoverAttempts >= MAX_RECOVERS) {
            // Out of recovers — surface the failure rather than burn cycles.
            hls?.destroy();
            return;
          }
          recoverAttempts += 1;
          try {
            if (!renewing) renewing = createPlaybackSession(videoId);
            const fresh = await renewing;
            renewing = null;
            currentSess = fresh;
            const at = video.currentTime || 0;
            // stopLoad + new source preserves the attached media element;
            // we reseek after the new manifest is parsed.
            hls?.stopLoad();
            hls?.loadSource(`${API}${fresh.manifest_url}`);
            hls?.startLoad(at);
          } catch {
            renewing = null;
            hls?.destroy();
          }
        });

        hls.loadSource(`${API}${sess.manifest_url}`);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = `${API}${sess.manifest_url}`;
        // Safari error → re-mint a session and reload src. Limited retry
        // budget so a permanently-failing video doesn't loop forever.
        const onErr = async () => {
          if (recoverAttempts >= MAX_RECOVERS) return;
          recoverAttempts += 1;
          try {
            const fresh = await createPlaybackSession(videoId);
            const at = video.currentTime || 0;
            video.src = `${API}${fresh.manifest_url}`;
            video.addEventListener(
              "loadedmetadata",
              () => { video.currentTime = at; },
              { once: true },
            );
          } catch { /* give up silently */ }
        };
        video.addEventListener("error", onErr);
      }

      if (resumeAt > 0) {
        const seek = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(resumeAt, video.duration - 1);
          }
        };
        video.addEventListener("loadedmetadata", seek, { once: true });
      }
    };

    (async () => {
      const sess = await createPlaybackSession(videoId);
      if (cancelled || !videoRef.current) return;

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

      mountHls(sess, resumeAt);

      if (!lessonId) return;
      const video = videoRef.current!;

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
