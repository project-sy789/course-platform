"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SecurePlayer from "@/components/SecurePlayer";
import WatermarkOverlay from "@/components/WatermarkOverlay";
import WatermarkSentinel from "@/components/WatermarkSentinel";
import DevToolsGuard from "@/components/DevToolsGuard";
import { apiFetch, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";

type Me = { id: string; email: string; is_active: boolean };
type Lesson = { id: string; title: string; position: number; video_id: string; course_id: string };
type Material = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

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
  const [tamperReason, setTamperReason] = useState<string | null>(null);
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

  if (error) return <main className="p-8 text-red-400">เกิดข้อผิดพลาด: {error}</main>;
  if (!me || !lesson) return <main className="p-8 opacity-60">กำลังโหลด…</main>;

  return (
    <main className="min-h-screen">
      <DevToolsGuard onDetect={() => setPaused(true)} />
      <WatermarkSentinel
        overlaySelector="[data-watermark='overlay']"
        onTamper={(reason) => {
          setPaused(true);
          setTamperReason(reason);
        }}
      />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-4">{lesson.title}</h1>
        <div className="relative aspect-video bg-black rounded-xl overflow-hidden select-none">
          {!paused && <SecurePlayer videoId={lesson.video_id} lessonId={lesson.id} />}
          <WatermarkOverlay userEmail={me.email} userId={me.id} />
          {paused && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 text-center p-6">
              <div>
                <p className="text-lg font-semibold mb-2">หยุดการเล่นชั่วคราว</p>
                <p className="text-sm opacity-70">
                  ตรวจพบการแก้ไขหน้าเว็บหรือเปิดเครื่องมือนักพัฒนา
                  {tamperReason ? ` (${tamperReason})` : ""}
                </p>
                <p className="text-xs opacity-50 mt-2">
                  รีเฟรชหน้าเพื่อเล่นต่อ
                </p>
              </div>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs opacity-50">
          เข้าสู่ระบบด้วย {me.email} ระบบบันทึกการรับชมไว้สำหรับเซสชันนี้
        </p>

        {materials.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60 mb-3">
              เอกสารประกอบบทเรียน
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
                    ดาวน์โหลด
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs opacity-40">
              ไฟล์ที่คุณดาวน์โหลดจะมีรหัสกำกับติดไว้เพื่อระบุเจ้าของบัญชี
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
