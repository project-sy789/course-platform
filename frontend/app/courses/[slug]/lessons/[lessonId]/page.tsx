"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SecurePlayer from "@/components/SecurePlayer";
import WatermarkOverlay from "@/components/WatermarkOverlay";
import DevToolsGuard from "@/components/DevToolsGuard";
import { apiFetch, ApiError } from "@/lib/api";

type Me = { id: string; email: string; is_active: boolean };
type Lesson = { id: string; title: string; position: number; video_id: string; course_id: string };
type Material = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LessonPage({
  params,
}: {
  params: { slug: string; lessonId: string };
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
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
    apiFetch<Material[]>(`/api/v1/lessons/${params.lessonId}/materials`)
      .then(setMaterials)
      .catch(() => setMaterials([]));
  }, [params.lessonId]);

  if (error) return <main className="p-8 text-red-400">Error: {error}</main>;
  if (!me || !lesson) return <main className="p-8 opacity-60">Loading…</main>;

  return (
    <main className="min-h-screen">
      <DevToolsGuard onDetect={() => setPaused(true)} />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-4">{lesson.title}</h1>
        <div className="relative aspect-video bg-black rounded-xl overflow-hidden select-none">
          {!paused && <SecurePlayer videoId={lesson.video_id} lessonId={lesson.id} />}
          <WatermarkOverlay userEmail={me.email} userId={me.id} />
        </div>
        <p className="mt-3 text-xs opacity-50">
          Signed in as {me.email}. Playback is logged for this session.
        </p>

        {materials.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60 mb-3">
              Lesson materials
            </h2>
            <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 overflow-hidden">
              {materials.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-900"
                >
                  <div className="min-w-0">
                    <div className="truncate">{m.filename}</div>
                    <div className="text-xs opacity-50">
                      {m.content_type} · {formatBytes(m.size_bytes)}
                    </div>
                  </div>
                  <a
                    href={`/api/v1/materials/${m.id}/download`}
                    className="text-sm rounded-md bg-white text-black font-medium px-3 py-1.5"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs opacity-40">
              Files you download are tagged with your account identifier.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
