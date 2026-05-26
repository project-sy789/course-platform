"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

type CourseDetail = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
  lessons: { id: string; title: string; position: number; is_preview: boolean }[];
};

export default function CoursePage({ params }: { params: { slug: string } }) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CourseDetail>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch((e) => setError(e?.message ?? "failed"));
  }, [params.slug]);

  if (error) return <main className="p-8">Error: {error}</main>;
  if (!course) return <main className="p-8 opacity-60">Loading…</main>;

  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href="/" className="text-sm underline opacity-70">← Courses</Link>
      <h1 className="text-2xl font-semibold mt-4">{course.title}</h1>
      {course.description && <p className="opacity-70 mt-2">{course.description}</p>}

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
                <span className="text-xs bg-neutral-800 px-2 py-0.5 rounded">Preview</span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
