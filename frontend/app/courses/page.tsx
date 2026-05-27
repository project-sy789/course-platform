"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB } from "@/lib/format";
import { ErrorNote, Eyebrow, Loading, Page, PageTitle } from "@/components/ui";

type CourseRow = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
};

export default function CoursesIndexPage() {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CourseRow[]>("/api/v1/courses")
      .then(setCourses)
      .catch((e: ApiError) => setError(e?.message ?? "failed"));
  }, []);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!courses) return <Page><Loading /></Page>;

  return (
    <Page width="column">
      <Eyebrow>สารบัญคอร์ส</Eyebrow>
      <PageTitle>คอร์สเรียนทั้งหมด</PageTitle>
      <p className="lede max-w-2xl mb-10">
        บรรณาธิการคัดสรรหลักสูตรภาษาไทยจากครูผู้เชี่ยวชาญ
        ครอบคลุมประวัติศาสตร์ วรรณคดี เศรษฐศาสตร์ และปรัชญา
      </p>

      <ol className="border-t border-rule">
        {courses.map((c, i) => (
          <li
            key={c.id}
            className="border-b border-rule py-6 grid grid-cols-12 gap-6 items-baseline"
          >
            <div className="col-span-2 sm:col-span-1 font-mono text-[12px] text-muted tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="col-span-10 sm:col-span-8">
              <Link
                href={`/courses/${c.slug}`}
                className="font-display text-[1.6rem] leading-tight hover:text-oxblood"
              >
                {c.title}
              </Link>
              {c.description && (
                <p className="lede mt-2 max-w-2xl">{c.description}</p>
              )}
            </div>
            <div className="col-span-12 sm:col-span-3 text-right">
              <div className="font-mono text-[13px]">
                {c.price_cents === 0 ? "ไม่มีค่าใช้จ่าย" : formatTHB(c.price_cents)}
              </div>
              <Link
                href={`/courses/${c.slug}`}
                className="text-[12px] uppercase tracking-[0.18em] text-oxblood hover:underline underline-offset-4 decoration-1 mt-1 inline-block"
              >
                อ่านต่อ →
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </Page>
  );
}
