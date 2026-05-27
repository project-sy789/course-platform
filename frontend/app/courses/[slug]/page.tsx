"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB } from "@/lib/format";
import { ErrorNote, Loading, Page, Pill } from "@/components/ui";

function accessLabel(days: number | null | undefined): string {
  if (days == null) return "เข้าถึงได้ตลอดชีพ";
  if (days % 365 === 0) return `เข้าถึงได้ ${days / 365} ปี`;
  if (days % 30 === 0) return `เข้าถึงได้ ${days / 30} เดือน`;
  return `เข้าถึงได้ ${days} วัน`;
}

type CourseDetail = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
  access_duration_days?: number | null;
  lessons: { id: string; title: string; position: number; is_preview: boolean }[];
};

type CourseProgress = {
  course_slug: string;
  completed_lessons: number;
  total_lessons: number;
  lessons: {
    lesson_id: string;
    position: number;
    position_seconds: number;
    duration_seconds: number;
    completed: boolean;
  }[];
};

export default function CoursePage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CourseDetail>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch((e: ApiError) => setError(e?.message ?? "failed"));
    // Progress is logged-in-only — silently ignore 401/403 for guests.
    apiFetch<CourseProgress>(`/api/v1/courses/${params.slug}/progress`)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [params.slug]);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!course) return <Page><Loading /></Page>;

  const isFree = course.price_cents === 0;

  const progressByLesson = new Map(
    progress?.lessons.map((l) => [l.lesson_id, l]) ?? [],
  );
  const totalDone = progress?.completed_lessons ?? 0;
  const totalCount = progress?.total_lessons ?? course.lessons.length;
  const pct = totalCount > 0 ? Math.round((totalDone / totalCount) * 100) : 0;
  const nextLesson = progress
    ? progress.lessons.find((l) => !l.completed) ?? progress.lessons[0]
    : null;
  const hasAnyProgress =
    !!progress && progress.lessons.some((l) => l.position_seconds > 0 || l.completed);

  return (
    <Page width="column">
      <Link href="/" className="text-[13px] text-muted underline underline-offset-4 decoration-1 inline-block mb-6">
        ← สารบัญทั้งหมด
      </Link>

      <article className="grid md:grid-cols-12 gap-8 md:gap-12 pb-10 border-b border-rule">
        <div className="md:col-span-8">
          <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-3">
            คอร์สเรียน
          </div>
          <h1 className="font-display font-semibold leading-[1.04] tracking-[-0.02em] text-[clamp(2rem,4.6vw,3.4rem)]">
            {course.title}
          </h1>
          {course.description && (
            <p className="font-display text-[17px] leading-[1.7] mt-6 text-ink/90 max-w-prose">
              {course.description}
            </p>
          )}
          <div className="mt-6 flex items-center gap-4 text-[13px]">
            <Pill tone="neutral">{accessLabel(course.access_duration_days)}</Pill>
            <Pill tone="neutral">{course.lessons.length} บทเรียน</Pill>
          </div>
        </div>

        <aside className="md:col-span-4 md:border-l md:border-rule md:pl-8">
          {hasAnyProgress && nextLesson ? (
            <>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-3">
                ความคืบหน้า
              </div>
              <p className="font-display text-[32px] leading-none font-mono tabular-nums">
                {pct}%
              </p>
              <p className="text-[12px] text-muted mt-1">
                {totalDone} / {totalCount} บทเรียนจบแล้ว
              </p>
              <div className="mt-3 h-[3px] bg-rule/40">
                <div
                  className="h-full bg-oxblood transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <button
                onClick={() => router.push(`/courses/${course.slug}/lessons/${nextLesson.lesson_id}`)}
                className="mt-6 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition"
              >
                เรียนต่อ →
              </button>
            </>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-3">
                ราคา
              </div>
              {isFree ? (
                <p className="font-display text-[32px] leading-none">เรียนฟรี</p>
              ) : (
                <>
                  <p className="font-display text-[36px] leading-none font-mono tabular-nums">
                    {formatTHB(course.price_cents)}
                  </p>
                  <p className="text-[12px] text-muted mt-1">รวมภาษีมูลค่าเพิ่มแล้ว</p>
                  <button
                    onClick={() => router.push(`/checkout/${course.slug}`)}
                    className="mt-6 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition"
                  >
                    สั่งซื้อคอร์สนี้ →
                  </button>
                </>
              )}
            </>
          )}
        </aside>
      </article>

      <section className="mt-14">
        <div className="flex items-baseline gap-4 mb-6">
          <h2 className="font-display text-2xl">สารบัญบทเรียน</h2>
          <span className="grow border-t border-rule/40" />
          <span className="font-mono text-[11px] text-muted">
            {course.lessons.length.toString().padStart(2, "0")} บท
          </span>
        </div>

        <ol className="border-t border-rule">
          {course.lessons.map((l) => {
            const p = progressByLesson.get(l.id);
            const partial =
              p && !p.completed && p.position_seconds > 0 && p.duration_seconds > 0
                ? Math.min(100, Math.round((p.position_seconds / p.duration_seconds) * 100))
                : 0;
            return (
              <li key={l.id} className="border-b border-rule">
                <Link
                  href={`/courses/${course.slug}/lessons/${l.id}`}
                  className="grid grid-cols-[3rem_1fr_auto] gap-6 py-4 items-baseline group"
                >
                  <span className="font-mono text-muted text-sm tabular-nums">
                    {p?.completed
                      ? <span className="text-oxblood" aria-label="เรียนจบแล้ว">✓</span>
                      : l.position.toString().padStart(2, "0")}
                  </span>
                  <span>
                    <span className="font-display text-[18px] group-hover:text-oxblood transition-colors">
                      {l.title}
                    </span>
                    {partial > 0 && (
                      <span className="block mt-1 text-[11px] text-muted font-mono">
                        ดูแล้ว {partial}%
                      </span>
                    )}
                  </span>
                  {l.is_preview && <Pill tone="ok">ดูฟรี</Pill>}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    </Page>
  );
}
