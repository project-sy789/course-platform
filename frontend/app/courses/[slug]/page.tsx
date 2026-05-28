"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { addToCart, isInCart, subscribe } from "@/lib/cart";
import { formatTHB, formatBytes } from "@/lib/format";
import { ErrorNote, Loading, Page, Pill } from "@/components/ui";
import { CourseCover } from "@/components/CourseCover";

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
  price_baht: number;
  access_duration_days?: number | null;
  cover_url?: string | null;
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

type CourseMaterial = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

export default function CoursePage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inCart, setInCart] = useState(false);

  useEffect(() => {
    apiFetch<CourseDetail>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch((e: ApiError) => setError(e?.message ?? "failed"));
    apiFetch<CourseProgress>(`/api/v1/courses/${params.slug}/progress`)
      .then(setProgress)
      .catch(() => setProgress(null));
    apiFetch<CourseMaterial[]>(`/api/v1/courses/${params.slug}/materials`)
      .then(setMaterials)
      .catch(() => setMaterials([]));
  }, [params.slug]);

  useEffect(() => {
    if (!course) return;
    setInCart(isInCart({ course_id: course.id }));
    return subscribe(() => setInCart(isInCart({ course_id: course.id })));
  }, [course]);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!course) return <Page><Loading /></Page>;

  const isFree = course.price_baht === 0;

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
          <CourseCover
            slug={course.slug}
            title={course.title}
            variant="hero"
            kicker="คอร์สเรียน"
            coverUrl={course.cover_url}
            className="w-full aspect-[3/2] mb-8 shadow-[0_2px_24px_rgba(28,24,20,0.12)]"
          />
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
                    {formatTHB(course.price_baht)}
                  </p>
                  <p className="text-[12px] text-muted mt-1">รวมภาษีมูลค่าเพิ่มแล้ว</p>
                  <button
                    onClick={() => router.push(`/checkout/${course.slug}`)}
                    className="mt-6 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition"
                  >
                    สั่งซื้อคอร์สนี้ →
                  </button>
                  {inCart ? (
                    <button
                      onClick={() => router.push("/cart")}
                      className="mt-3 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] border border-ink hover:bg-ink hover:text-paper transition"
                    >
                      ดูตะกร้า ({"ในตะกร้าแล้ว"})
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        addToCart({
                          course_id: course.id,
                          course_slug: course.slug,
                          course_title: course.title,
                          unit_price_baht: course.price_baht,
                        });
                      }}
                      className="mt-3 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] border border-rule hover:border-ink transition"
                    >
                      เพิ่มลงตะกร้า ＋
                    </button>
                  )}
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

      {materials.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline gap-4 mb-6">
            <h2 className="font-display text-2xl">เอกสารคอร์ส</h2>
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
                    <span className="font-display text-[17px] group-hover:text-oxblood transition-colors">
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
            เอกสารระดับคอร์สใช้ร่วมกันทุกบท — ทุกการดาวน์โหลดของท่านมีรหัสกำกับ
          </p>
        </section>
      )}
    </Page>
  );
}
