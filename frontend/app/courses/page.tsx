"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB } from "@/lib/format";
import { ErrorNote, Eyebrow, Loading, Page, PageTitle } from "@/components/ui";
import { CourseCover } from "@/components/CourseCover";

type CourseRow = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_baht: number;
  cover_url?: string | null;
};

const PER_PAGE = 20;
const THAI_NUM = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
const thaiNum = (n: number) =>
  String(n).split("").map((d) => THAI_NUM[Number(d)] ?? d).join("");

export default function CoursesIndexPage() {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    apiFetch<CourseRow[]>("/api/v1/courses")
      .then(setCourses)
      .catch((e: ApiError) => setError(e?.message ?? "failed"));
  }, []);

  const filtered = useMemo(() => {
    if (!courses) return [];
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q),
    );
  }, [courses, query]);

  // Reset paging whenever the search changes — otherwise you can land on
  // page ๔ of a query that only has ๑ result.
  useEffect(() => { setPage(1); }, [query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PER_PAGE;
  const pageItems = filtered.slice(startIdx, startIdx + PER_PAGE);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!courses) return <Page><Loading /></Page>;

  return (
    <Page width="column">
      <Eyebrow>สารบัญคอร์ส</Eyebrow>
      <PageTitle>คอร์สเรียนทั้งหมด</PageTitle>

      {/* Search bar — editorial-styled, sits between title and the index */}
      <div className="mb-8 border-y border-rule py-3 flex items-center gap-4">
        <span className="text-[11px] uppercase tracking-[0.22em] text-muted whitespace-nowrap">
          ค้นในเล่ม
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ชื่อคอร์ส คำสำคัญ หรือคำในคำโปรย"
          className="flex-1 bg-transparent border-0 outline-none
                     font-serif text-[16px] placeholder:text-muted/60
                     focus:placeholder:text-muted/40"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1"
          >
            ล้าง
          </button>
        )}
        <span className="font-mono text-[11px] text-muted whitespace-nowrap tabular-nums">
          {thaiNum(filtered.length)} / {thaiNum(courses.length)} เรื่อง
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted italic py-10">
          ไม่พบคอร์สที่ตรงกับ "{query}" — ลองคำค้นอื่น
        </p>
      ) : (
        <>
          <ol className="border-t border-rule">
            {pageItems.map((c, i) => {
              const absoluteIdx = startIdx + i;
              return (
                <li
                  key={c.id}
                  className="border-b border-rule py-6 grid grid-cols-12 gap-6 items-center"
                >
                  <Link
                    href={`/courses/${c.slug}`}
                    className="col-span-3 sm:col-span-2 block"
                  >
                    <CourseCover
                      slug={c.slug}
                      title={c.title}
                      variant="thumb"
                      kicker={`${(absoluteIdx + 1).toString().padStart(2, "0")}`}
                      coverUrl={c.cover_url}
                      className="w-full aspect-[3/4] shadow-[0_1px_8px_rgba(28,24,20,0.10)]"
                    />
                  </Link>
                  <div className="col-span-9 sm:col-span-7">
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
                      {c.price_baht === 0 ? "ไม่มีค่าใช้จ่าย" : formatTHB(c.price_baht)}
                    </div>
                    <Link
                      href={`/courses/${c.slug}`}
                      className="text-[12px] uppercase tracking-[0.18em] text-oxblood hover:underline underline-offset-4 decoration-1 mt-1 inline-block"
                    >
                      อ่านต่อ →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>

          {totalPages > 1 && (
            <nav className="mt-8 flex items-center gap-6 text-[12px] text-muted">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="font-mono hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← ฉบับก่อน
              </button>
              <span className="font-mono tracking-[0.18em]">
                ฉบับ {thaiNum(safePage)} / {thaiNum(totalPages)}
              </span>
              <span className="grow flex items-center gap-1.5">
                <span className="grow border-t border-rule/30" />
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    aria-label={`ไปฉบับ ${n}`}
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      n === safePage ? "bg-oxblood" : "bg-rule/40 hover:bg-ink/60"
                    }`}
                  />
                ))}
                <span className="grow border-t border-rule/30" />
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="font-mono hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ฉบับถัดไป →
              </button>
            </nav>
          )}
        </>
      )}
    </Page>
  );
}
