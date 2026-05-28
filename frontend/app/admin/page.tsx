"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, type Dashboard, type Stats } from "@/lib/admin";
import { formatNumber, formatTHB } from "@/lib/format";
import { ErrorNote, Loading, Page, PageTitle, Pill } from "@/components/ui";

function Card({
  label, value, sub, tone = "neutral", href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "warn" | "ok";
  href?: string;
}) {
  const valueClass =
    tone === "warn" ? "text-oxblood"
    : tone === "ok" ? "text-ink"
    : "text-ink";
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className={`font-display font-mono tabular-nums leading-none mt-2 text-[clamp(1.8rem,3.6vw,2.6rem)] ${valueClass}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-2">{sub}</div>}
    </>
  );
  const cls = "block border-b md:border-b-0 md:border-r border-rule last:border-r-0 py-5 px-4 " +
    (href ? "hover:bg-ink/[0.02] transition-colors" : "");
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Sparkline({ data }: { data: { date: string; revenue_baht: number }[] }) {
  if (data.length === 0) return null;
  const w = 600, h = 80, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.revenue_baht));
  const step = (w - pad * 2) / Math.max(1, data.length - 1);
  const points = data.map((d, i) => {
    const x = pad + i * step;
    const y = h - pad - (d.revenue_baht / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastNonZero = [...data].reverse().find((d) => d.revenue_baht > 0);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="text-ink"
          points={points.join(" ")}
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted font-mono mt-1">
        <span>{data[0]?.date}</span>
        <span>สูงสุด {formatTHB(max)}</span>
        <span>{lastNonZero ? `ล่าสุด ${formatTHB(lastNonZero.revenue_baht)}` : "—"}</span>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.dashboard(), adminApi.stats()])
      .then(([d, s]) => { setDash(d); setStats(s); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!dash || !stats) return <Page><Loading /></Page>;

  const alerts: { tone: "warn" | "danger"; text: string; href: string }[] = [];
  if (dash.pending_slips > 0) {
    alerts.push({
      tone: "warn",
      text: `สลิปรอตรวจ ${formatNumber(dash.pending_slips)} รายการ`,
      href: "/admin/slip-uploads",
    });
  }
  if (dash.suspicious_logins_24h > 0) {
    alerts.push({
      tone: "danger",
      text: `เข้าสู่ระบบน่าสงสัย ${formatNumber(dash.suspicious_logins_24h)} ครั้ง (๒๔ ชม.)`,
      href: "/admin/logs",
    });
  }

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — สรุปประจำวัน">แดชบอร์ด</PageTitle>

      {alerts.length > 0 && (
        <section className="mt-2 mb-8 space-y-2">
          {alerts.map((a) => (
            <Link
              key={a.text}
              href={a.href}
              className="flex items-center justify-between border-l-2 border-oxblood bg-oxblood/[0.04] pl-3 pr-4 py-2 hover:bg-oxblood/[0.08] transition-colors"
            >
              <span className="flex items-center gap-3">
                <Pill tone={a.tone}>ต้องดู</Pill>
                <span className="text-[14px]">{a.text}</span>
              </span>
              <span className="text-[12px] text-muted">เปิดดู →</span>
            </Link>
          ))}
        </section>
      )}

      {/* Revenue */}
      <section className="mt-8">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">รายได้</h2>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 border-t border-b border-rule">
          <Card label="วันนี้" value={formatTHB(dash.revenue.today_baht)} />
          <Card label="เดือนนี้" value={formatTHB(dash.revenue.month_baht)} />
          <Card label="สะสมตลอด" value={formatTHB(dash.revenue.total_baht)} />
        </div>
        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1">
            ๓๐ วันล่าสุด
          </div>
          <Sparkline data={dash.sparkline_30d} />
        </div>
      </section>

      {/* Quick counters */}
      <section className="mt-12">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">ตัวชี้วัด</h2>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-b border-rule">
          <Card
            label="ผู้ใช้ใหม่ (๗ วัน)"
            value={formatNumber(dash.new_users_7d)}
            href="/admin/users"
          />
          <Card
            label="คูปองที่ใช้วันนี้"
            value={formatNumber(dash.coupons_today)}
            href="/admin/coupons"
          />
          <Card
            label="สลิปรอตรวจ"
            value={formatNumber(dash.pending_slips)}
            tone={dash.pending_slips > 0 ? "warn" : "neutral"}
            href="/admin/slip-uploads"
          />
          <Card
            label="เข้าระบบน่าสงสัย (๒๔ ชม.)"
            value={formatNumber(dash.suspicious_logins_24h)}
            tone={dash.suspicious_logins_24h > 0 ? "warn" : "neutral"}
            href="/admin/logs"
          />
        </div>
      </section>

      {/* Top courses */}
      <section className="mt-12">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">คอร์สขายดี</h2>
          <span className="font-mono text-[11px] text-muted">๓๐ วันที่ผ่านมา</span>
          <span className="grow border-t border-rule/40" />
        </div>
        {dash.top_courses.length === 0 ? (
          <p className="text-muted italic py-6">ยังไม่มีคำสั่งซื้อในช่วงนี้</p>
        ) : (
          <ol className="border-t border-b border-rule divide-y divide-rule/40">
            {dash.top_courses.map((c, i) => (
              <li key={c.slug} className="flex items-baseline gap-4 px-2 py-3">
                <span className="font-mono text-[12px] text-muted w-6">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Link href={`/admin/courses/${c.slug}`} className="grow text-[14px] hover:underline underline-offset-4">
                  {c.title}
                </Link>
                <span className="font-mono text-[12px] text-muted tabular-nums">
                  {formatNumber(c.sold)} ครั้ง
                </span>
                <span className="font-mono text-[13px] tabular-nums w-28 text-right">
                  {formatTHB(c.revenue_baht)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Cumulative stats + key activity */}
      <section className="mt-12">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">ตัวเลขสะสม</h2>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-b border-rule">
          <Card label="ผู้ใช้" value={formatNumber(stats.users)} />
          <Card label="คอร์ส" value={formatNumber(stats.courses)} />
          <Card label="บทเรียน" value={formatNumber(stats.lessons)} />
          <Card label="การลงทะเบียน" value={formatNumber(stats.enrollments)} />
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">ความเคลื่อนไหวคีย์</h2>
          <span className="font-mono text-[11px] text-muted">๒๔ ชั่วโมงที่ผ่านมา</span>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="grid grid-cols-2 border-t border-b border-rule">
          <Card label="คีย์ที่อนุมัติ" value={formatNumber(stats.key_grants_24h)} />
          <Card
            label="คีย์ที่ปฏิเสธ"
            value={formatNumber(stats.key_denials_24h)}
            tone={stats.key_denials_24h > 0 ? "warn" : "neutral"}
            href="/admin/logs"
          />
        </div>
      </section>

      {/* Tools */}
      <section className="mt-12">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">เครื่องมือ</h2>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="flex flex-wrap gap-3 pt-3 text-[13px]">
          <Link href="/admin/users" className="border border-ink/60 px-3 py-2 hover:bg-ink hover:text-paper transition-colors">
            จัดการผู้ใช้
          </Link>
          <Link href="/admin/audit" className="border border-ink/60 px-3 py-2 hover:bg-ink hover:text-paper transition-colors">
            บันทึกการดำเนินการ
          </Link>
          <a
            href={adminApi.usersCsvUrl()}
            className="border border-ink/60 px-3 py-2 hover:bg-ink hover:text-paper transition-colors"
            download
          >
            ดาวน์โหลด users.csv
          </a>
          <a
            href={adminApi.paymentsCsvUrl()}
            className="border border-ink/60 px-3 py-2 hover:bg-ink hover:text-paper transition-colors"
            download
          >
            ดาวน์โหลด payments.csv
          </a>
        </div>
      </section>
    </Page>
  );
}
