"use client";
import { useEffect, useRef } from "react";
import Hls, { type HlsConfig } from "hls.js";
import { createPlaybackSession } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_BASE!;

type Props = { videoId: string };

export default function SecurePlayer({ videoId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let hls: Hls | null = null;
    let cancelled = false;

    (async () => {
      const sess = await createPlaybackSession(videoId);
      if (cancelled || !videoRef.current) return;

      const video = videoRef.current;

      if (Hls.isSupported()) {
        const BaseLoader: any = (Hls.DefaultConfig as HlsConfig).loader;

        class KeyRewritingLoader extends BaseLoader {
          load(context: any, config: any, callbacks: any) {
            // Force the key URL to our backend, regardless of what the manifest says.
            // Defends against a tampered manifest that tries to redirect the key fetch.
            if (context.type === "key") {
              context.url = `${API}${sess.key_url_template}`;
            }
            return super.load(context, config, callbacks);
          }
        }

        hls = new Hls({
          loader: KeyRewritingLoader,
          xhrSetup: (xhr, url) => {
            // Send credentials only when calling our own API (key endpoint).
            if (url.startsWith(API)) {
              xhr.withCredentials = true;
            }
          },
        });
        hls.loadSource(sess.manifest_url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS — manifest's #EXT-X-KEY URI must already point at backend.
        // Pre-bake the URI at encode time, or proxy the manifest through backend per request.
        video.src = sess.manifest_url;
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [videoId]);

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
