"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatTHB } from "@/lib/format";

type Course = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
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
    price_cents: 129000,
  },
  {
    id: "p2",
    slug: "literature-rattanakosin",
    title: "วรรณคดีรัตนโกสินทร์",
    description:
      "วิเคราะห์งานนิพนธ์สำคัญในช่วงต้นกรุง พร้อมเปรียบเทียบกับวรรณกรรมร่วมสมัยในภูมิภาคเอเชียตะวันออกเฉียงใต้",
    price_cents: 89000,
  },
  {
    id: "p3",
    slug: "field-economics",
    title: "เศรษฐศาสตร์ภาคสนาม",
    description:
      "หลักเศรษฐศาสตร์จุลภาคที่นำมาใช้กับชีวิตประจำวัน ผ่านกรณีศึกษาจากตลาดสด ร้านโชห่วย และเศรษฐกิจชุมชน",
    price_cents: 0,
  },
  {
    id: "p4",
    slug: "buddhist-philosophy",
    title: "ปรัชญาพุทธในชีวิตประจำวัน",
    description:
      "อ่านพระไตรปิฎกในแง่มุมที่นำมาใช้ได้จริง ไม่ใช่เพื่อท่องจำ — เพื่อเข้าใจการตัดสินใจของตัวเอง",
    price_cents: 59000,
  },
];

function priceTag(satang: number) {
  if (satang === 0) return "เปิดให้อ่านฟรี";
  return formatTHB(satang);
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

  const [lead, ...rest] = courses;

  return (
    <main className="max-w-6xl mx-auto px-6 pt-10 pb-16">
      {/* Section eyebrow */}
      <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.22em] text-muted mb-8">
        <span>สารบัญฉบับปัจจุบัน</span>
        <span className="grow border-t border-rule/40" />
        <span>หน้า ๑</span>
      </div>

      {/* Lead story */}
      {loading ? (
        <p className="text-muted">กำลังจัดหน้า…</p>
      ) : lead ? (
        <article className="grid md:grid-cols-12 gap-8 md:gap-12 pb-10 border-b border-rule">
          <div className="md:col-span-7">
            <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-3">
              คอร์สแนะนำ — ฉบับเปิดเล่ม
            </div>
            <h2 className="font-display font-semibold leading-[1.02] tracking-[-0.02em] text-[clamp(2rem,5.2vw,4rem)]">
              <Link href={`/courses/${lead.slug}`}>{lead.title}</Link>
            </h2>
            {lead.description && (
              <p className="dropcap font-serif text-[17px] leading-[1.7] mt-6 text-ink/90">
                {lead.description}
              </p>
            )}
            <div className="mt-6 flex items-center gap-6 text-[13px]">
              <Link
                href={`/courses/${lead.slug}`}
                className="font-medium underline underline-offset-[6px] decoration-1 decoration-oxblood"
              >
                อ่านต่อ →
              </Link>
              <span className="text-muted font-mono text-[12px]">
                {priceTag(lead.price_cents)}
              </span>
            </div>
          </div>

          {/* Right column — a typeset “byline” block instead of a stock photo. */}
          <aside className="md:col-span-5 md:border-l md:border-rule md:pl-10">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-3">
              ผู้เรียบเรียง
            </div>
            <p className="font-display text-[20px] leading-snug">
              คณาจารย์ผู้สอนจริงในชั้นเรียน ไม่ใช่บรรณาธิการนิรนาม
              อ่านได้บนอุปกรณ์ส่วนตัว สูงสุดสามเครื่อง
            </p>
            <dl className="mt-8 space-y-3 text-[13px]">
              <div className="flex justify-between border-b border-rule/40 pb-2">
                <dt className="text-muted">รูปแบบ</dt>
                <dd>วิดีโอ HLS เข้ารหัส AES-128</dd>
              </div>
              <div className="flex justify-between border-b border-rule/40 pb-2">
                <dt className="text-muted">ระยะเวลา</dt>
                <dd>เข้าถึงตลอดชีพ</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">การชำระเงิน</dt>
                <dd>โอนผ่านธนาคาร / สลิป</dd>
              </div>
            </dl>
          </aside>
        </article>
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
                  className="grid grid-cols-[3rem_1fr_auto] gap-6 py-5 items-baseline group"
                >
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
                    {priceTag(c.price_cents)}
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
