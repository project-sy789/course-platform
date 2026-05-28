"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatTHB } from "@/lib/format";
import { CourseCover } from "@/components/CourseCover";

type Course = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_baht: number;
  cover_url?: string | null;
  is_featured?: boolean;
};

// Editorial fallback so the layout reads well before the backend is wired up
// (or when the homepage is rendered with no courses yet). Real data from
// /api/v1/courses replaces this whenever the fetch succeeds.
const PLACEHOLDER: Course[] = [
  {
    id: "p1",
    slug: "thai-history-modern",
    title: "ประวัติศาสตร์ไทยสมัยใหม่",
    description:
      "อ่านการเปลี่ยนผ่านของสยามตั้งแต่รัชสมัยที่ ๕ จนถึงปัจจุบัน ผ่านเอกสารชั้นต้น แผนที่ และภาพถ่ายต้นฉบับที่หาดูได้ยาก",
    price_baht: 129000,
  },
  {
    id: "p2",
    slug: "literature-rattanakosin",
    title: "วรรณคดีรัตนโกสินทร์",
    description:
      "วิเคราะห์งานนิพนธ์สำคัญในช่วงต้นกรุง พร้อมเปรียบเทียบกับวรรณกรรมร่วมสมัยในภูมิภาคเอเชียตะวันออกเฉียงใต้",
    price_baht: 89000,
  },
  {
    id: "p3",
    slug: "field-economics",
    title: "เศรษฐศาสตร์ภาคสนาม",
    description:
      "หลักเศรษฐศาสตร์จุลภาคที่นำมาใช้กับชีวิตประจำวัน ผ่านกรณีศึกษาจากตลาดสด ร้านโชห่วย และเศรษฐกิจชุมชน",
    price_baht: 0,
  },
  {
    id: "p4",
    slug: "buddhist-philosophy",
    title: "ปรัชญาพุทธในชีวิตประจำวัน",
    description:
      "อ่านพระไตรปิฎกในแง่มุมที่นำมาใช้ได้จริง ไม่ใช่เพื่อท่องจำ — เพื่อเข้าใจการตัดสินใจของตัวเอง",
    price_baht: 59000,
  },
];

function priceTag(baht: number) {
  if (baht === 0) return "เปิดให้อ่านฟรี";
  return formatTHB(baht);
}

const THAI_NUM = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
function thaiNum(n: number): string {
  return String(n).split("").map((d) => THAI_NUM[Number(d)] ?? d).join("");
}

const FEATURED_COUNT = 3;
const ROTATE_MS = 6000;

function FeaturedCarousel({ items }: { items: Course[] }) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchX = useRef<number | null>(null);

  function go(next: number, direction: 1 | -1) {
    setDir(direction);
    setIdx(((next % items.length) + items.length) % items.length);
  }
  const prev = () => go(idx - 1, -1);
  const next = () => go(idx + 1, 1);

  useEffect(() => {
    if (paused || items.length < 2) return;
    timerRef.current = setTimeout(() => go(idx + 1, 1), ROTATE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, paused, items.length]);

  // Keyboard ← / → flips pages whenever the carousel is in view.
  useEffect(() => {
    if (items.length < 2) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length]);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 40) return; // ignore tiny drags
    if (dx < 0) next(); else prev();
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* layered slides — only `idx` is opacity-100; others fade out with a
          horizontal drift so the change reads like a newspaper page turning */}
      <div className="relative min-h-[28rem] md:min-h-[34rem] overflow-hidden">
        {items.map((c, i) => {
          const active = i === idx;
          const isPrev = !active && (
            dir === 1 ? i === (idx - 1 + items.length) % items.length
                      : i === (idx + 1) % items.length
          );
          const offset = active ? 0 : (isPrev ? -28 : 28);
          return (
            <article
              key={c.id}
              aria-hidden={!active}
              className="absolute inset-0 grid md:grid-cols-12 gap-8 md:gap-12 transition-all duration-[700ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]"
              style={{
                opacity: active ? 1 : 0,
                transform: `translateX(${offset}px)`,
                pointerEvents: active ? "auto" : "none",
              }}
            >
              <div className="md:col-span-7">
                <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-3">
                  คอร์สแนะนำ — ฉบับเปิดเล่ม
                </div>
                <h2 className="font-display font-semibold leading-[1.02] tracking-[-0.02em] text-[clamp(2rem,5.2vw,4rem)]">
                  <Link href={`/courses/${c.slug}`}>{c.title}</Link>
                </h2>
                {c.description && (
                  <p className="dropcap font-serif text-[17px] leading-[1.7] mt-6 text-ink/90">
                    {c.description}
                  </p>
                )}
                <div className="mt-6 flex items-center gap-6 text-[13px]">
                  <Link
                    href={`/courses/${c.slug}`}
                    className="font-medium underline underline-offset-[6px] decoration-1 decoration-oxblood"
                  >
                    อ่านต่อ →
                  </Link>
                  <span className="text-muted font-mono text-[12px]">
                    {priceTag(c.price_baht)}
                  </span>
                </div>
              </div>
              <aside className="md:col-span-5">
                <Link href={`/courses/${c.slug}`} className="block">
                  <CourseCover
                    slug={c.slug}
                    title={c.title}
                    variant="hero"
                    kicker="คอร์สแนะนำ"
                    coverUrl={c.cover_url}
                    className="w-full aspect-[3/4] shadow-[0_2px_24px_rgba(28,24,20,0.12)]"
                  />
                </Link>
              </aside>
            </article>
          );
        })}
      </div>

      {/* page navigation — typeset like a newspaper jump-line */}
      {items.length > 1 && (
        <div className="relative z-10 mt-4 flex items-center gap-6 text-[12px] text-muted">
          <button
            onClick={() => go(idx - 1, -1)}
            aria-label="ฉบับก่อนหน้า"
            className="font-mono hover:text-ink transition-colors"
          >
            ← ก่อนหน้า
          </button>
          <span className="font-mono tracking-[0.18em]">
            ฉบับ {thaiNum(idx + 1)} / {thaiNum(items.length)}
          </span>
          <span className="grow flex items-center gap-1.5">
            <span className="grow border-t border-rule/30" />
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i, i > idx ? 1 : -1)}
                aria-label={`ไปฉบับ ${i + 1}`}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === idx ? "bg-oxblood" : "bg-rule/40 hover:bg-ink/60"
                }`}
              />
            ))}
            <span className="grow border-t border-rule/30" />
          </span>
          <button
            onClick={() => go(idx + 1, 1)}
            aria-label="ฉบับถัดไป"
            className="font-mono hover:text-ink transition-colors"
          >
            ถัดไป →
          </button>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    apiFetch<Course[]>("/api/v1/courses")
      .then((data) => {
        if (data && data.length > 0) {
          setCourses(data);
        } else {
          setCourses(PLACEHOLDER);
          setUsedFallback(true);
        }
      })
      .catch(() => {
        setCourses(PLACEHOLDER);
        setUsedFallback(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const flagged = courses.filter((c) => c.is_featured);
  const featured = (flagged.length > 0 ? flagged : courses).slice(
    0, Math.min(FEATURED_COUNT, courses.length),
  );
  const rest = courses;

  return (
    <main className="max-w-6xl mx-auto px-6 pt-10 pb-16">
      {/* Section eyebrow */}
      <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.22em] text-muted mb-8">
        <span>สารบัญฉบับปัจจุบัน</span>
        <span className="grow border-t border-rule/40" />
        <span>หน้า ๑</span>
      </div>

      {/* Lead story — newspaper-style carousel */}
      {loading ? (
        <p className="text-muted">กำลังจัดหน้า…</p>
      ) : featured.length > 0 ? (
        <div className="pb-10 border-b border-rule">
          <FeaturedCarousel items={featured} />
        </div>
      ) : (
        <p className="text-muted">ยังไม่มีคอร์สเปิดสอนในเล่มนี้</p>
      )}

      {/* Table of contents — numbered editorial list. */}
      {rest.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline gap-4 mb-6">
            <h3 className="font-display text-2xl">สารบัญ</h3>
            <span className="grow border-t border-rule/40" />
            <span className="font-mono text-[11px] text-muted">
              {rest.length.toString().padStart(2, "0")} เรื่อง
            </span>
          </div>

          <ol className="border-t border-rule">
            {rest.map((c, i) => (
              <li key={c.id} className="border-b border-rule">
                <Link
                  href={`/courses/${c.slug}`}
                  className="grid grid-cols-[64px_3rem_1fr_auto] gap-5 py-5 items-center group"
                >
                  <CourseCover
                    slug={c.slug}
                    title={c.title}
                    variant="thumb"
                    kicker={`${(i + 1).toString().padStart(2, "0")}`}
                    coverUrl={c.cover_url}
                    className="w-16 h-[5.3rem] shadow-[0_1px_8px_rgba(28,24,20,0.10)]"
                  />
                  <span className="font-mono text-muted text-sm tabular-nums">
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <span>
                    <span className="font-display text-[22px] leading-tight group-hover:text-oxblood transition-colors">
                      {c.title}
                    </span>
                    {c.description && (
                      <span className="block text-muted text-[14px] leading-snug mt-1 max-w-prose">
                        {c.description}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[12px] text-muted whitespace-nowrap self-center">
                    {priceTag(c.price_baht)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Editor's note — small italic line near the bottom, only when we
          fell back to placeholders. Acknowledges to the reader why the
          page looks alive even though the server isn't returning courses. */}
      {usedFallback && !loading && (
        <p className="mt-10 text-[12px] italic text-muted max-w-prose">
          หมายเหตุจากบรรณาธิการ — เนื้อหาที่แสดงเป็นตัวอย่างการจัดหน้า
          ระบบยังไม่ได้รับข้อมูลจริงจากเซิร์ฟเวอร์ในขณะนี้
        </p>
      )}
    </main>
  );
}
