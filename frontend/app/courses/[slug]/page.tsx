"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB } from "@/lib/format";

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

export default function CoursePage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CourseDetail>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch((e: ApiError) => setError(e?.message ?? "failed"));
  }, [params.slug]);

  if (error) return <main className="p-8 text-red-400">เกิดข้อผิดพลาด: {error}</main>;
  if (!course) return <main className="p-8 opacity-60">กำลังโหลด…</main>;

  const isFree = course.price_cents === 0;

  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href="/" className="text-sm underline opacity-70">← คอร์สทั้งหมด</Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{course.title}</h1>
          {course.description && <p className="opacity-70 mt-2">{course.description}</p>}
          <p className="mt-2 text-xs inline-block bg-neutral-900 border border-neutral-800 rounded px-2 py-1 opacity-80">
            {accessLabel(course.access_duration_days)}
          </p>
        </div>
        {!isFree && (
          <button
            onClick={() => router.push(`/checkout/${course.slug}`)}
            className="rounded-md bg-white text-black font-medium px-4 py-2 whitespace-nowrap"
          >
            ซื้อ {formatTHB(course.price_cents)}
          </button>
        )}
      </div>

      <ol className="mt-6 divide-y divide-neutral-800 rounded-xl border border-neutral-800 overflow-hidden">
        {course.lessons.map((l) => (
          <li key={l.id}>
            <Link
              href={`/courses/${course.slug}/lessons/${l.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-neutral-900"
            >
              <span>
                <span className="opacity-50 mr-3">{l.position}.</span>
                {l.title}
              </span>
              {l.is_preview && (
                <span className="text-xs bg-neutral-800 px-2 py-0.5 rounded">ดูฟรี</span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
