"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SecurePlayer from "@/components/SecurePlayer";
import PixelWatermarkPlayer from "@/components/PixelWatermarkPlayer";
import WatermarkOverlay from "@/components/WatermarkOverlay";
import WatermarkSentinel from "@/components/WatermarkSentinel";
import DevToolsGuard from "@/components/DevToolsGuard";
import { apiFetch, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { ErrorNote, Loading, Page } from "@/components/ui";

type Me = { id: string; email: string; is_active: boolean };
type Lesson = { id: string; title: string; position: number; video_id: string; course_id: string };
type CourseSummary = { pixel_watermark: boolean };
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
  const [course, setCourse] = useState<CourseSummary | null>(null);
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
    apiFetch<CourseSummary>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch(() => setCourse({ pixel_watermark: false }));
  }, [params.lessonId, params.slug]);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!me || !lesson) return <Page><Loading /></Page>;

  return (
    <Page>
      <DevToolsGuard onDetect={() => setPaused(true)} />
      <WatermarkSentinel
        overlaySelector="[data-watermark='overlay']"
        onTamper={(reason) => { setPaused(true); setTamperReason(reason); }}
      />

      <Link
        href={`/courses/${params.slug}`}
        className="text-[13px] text-muted underline underline-offset-4 decoration-1 inline-block mb-6"
      >
        ← สารบัญคอร์ส
      </Link>

      <header className="border-b border-rule pb-4 mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2 font-mono">
          บทที่ {lesson.position.toString().padStart(2, "0")}
        </div>
        <h1 className="font-display font-semibold leading-[1.04] tracking-[-0.02em] text-[clamp(1.6rem,3.6vw,2.4rem)]">
          {lesson.title}
        </h1>
      </header>

      <div className="relative aspect-video bg-ink overflow-hidden select-none border border-ink">
        {!paused && (
          course?.pixel_watermark ? (
            <PixelWatermarkPlayer
              videoId={lesson.video_id}
              lessonId={lesson.id}
              userEmail={me.email}
              userId={me.id}
            />
          ) : (
            <SecurePlayer videoId={lesson.video_id} lessonId={lesson.id} />
          )
        )}
        {!course?.pixel_watermark && (
          <WatermarkOverlay userEmail={me.email} userId={me.id} />
        )}
        {paused && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/95 text-paper text-center p-8">
            <div className="max-w-md">
              <div className="text-[11px] uppercase tracking-[0.22em] text-paper/60 mb-3">
                การเล่นถูกหยุด
              </div>
              <p className="font-display text-[1.6rem] leading-tight mb-3">
                ตรวจพบการแก้ไขหน้าเว็บ
              </p>
              <p className="text-[14px] opacity-80 leading-relaxed">
                ระบบหยุดการเล่นเพื่อปกป้องเนื้อหา
                {tamperReason && <> ({tamperReason})</>}
              </p>
              <p className="text-[12px] opacity-50 mt-4 italic">
                รีเฟรชหน้าเว็บเพื่อเล่นต่อ
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted font-mono">
        ผู้ชม: {me.email} · ระบบบันทึกการรับชมไว้สำหรับเซสชันนี้
      </p>

      {materials.length > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline gap-4 mb-6">
            <h2 className="font-display text-2xl">เอกสารประกอบ</h2>
            <span className="grow border-t border-rule/40" />
            <span className="font-mono text-[11px] text-muted">
              {materials.length.toString().padStart(2, "0")} ไฟล์
            </span>
          </div>
          <ol className="border-t border-rule">
            {materials.map((m, i) => (
              <li key={m.id} className="border-b border-rule">
                <a
                  href={`/api/v1/materials/${m.id}/download`}
                  className="grid grid-cols-[3rem_1fr_auto] gap-6 py-4 items-baseline group"
                >
                  <span className="font-mono text-muted text-sm tabular-nums">
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <span>
                    <span className="font-display text-[16px] group-hover:text-oxblood transition-colors">
                      {m.filename}
                    </span>
                    <span className="block text-[11px] text-muted mt-0.5 font-mono">
                      {m.content_type} · {formatBytes(m.size_bytes)}
                    </span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted whitespace-nowrap">
                    ดาวน์โหลด →
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12px] italic text-muted">
            ไฟล์ที่ดาวน์โหลดจะมีรหัสกำกับเพื่อระบุตัวเจ้าของบัญชี
          </p>
        </section>
      )}
    </Page>
  );
}
