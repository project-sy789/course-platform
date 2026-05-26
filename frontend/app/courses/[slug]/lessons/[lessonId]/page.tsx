"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SecurePlayer from "@/components/SecurePlayer";
import WatermarkOverlay from "@/components/WatermarkOverlay";
import DevToolsGuard from "@/components/DevToolsGuard";
import { apiFetch, ApiError } from "@/lib/api";

type Me = { id: string; email: string; is_active: boolean };
type Lesson = { id: string; title: string; position: number; video_id: string; course_id: string };

export default function LessonPage({
  params,
}: {
  params: { slug: string; lessonId: string };
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Me>("/api/v1/auth/me")
      .then(setMe)
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/login");
        else setError(e.message);
      });
  }, [router]);

  useEffect(() => {
    apiFetch<Lesson>(`/api/v1/lessons/${params.lessonId}`)
      .then(setLesson)
      .catch((e: ApiError) => setError(e.message));
  }, [params.lessonId]);

  if (error) return <main className="p-8 text-red-400">Error: {error}</main>;
  if (!me || !lesson) return <main className="p-8 opacity-60">Loading…</main>;

  return (
    <main className="min-h-screen">
      <DevToolsGuard onDetect={() => setPaused(true)} />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-4">{lesson.title}</h1>
        <div className="relative aspect-video bg-black rounded-xl overflow-hidden select-none">
          {!paused && <SecurePlayer videoId={lesson.video_id} />}
          <WatermarkOverlay userEmail={me.email} userId={me.id} />
        </div>
        <p className="mt-3 text-xs opacity-50">
          Signed in as {me.email}. Playback is logged for this session.
        </p>
      </div>
    </main>
  );
}
