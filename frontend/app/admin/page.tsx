"use client";
import { useEffect, useState } from "react";
import { adminApi, type Stats } from "@/lib/admin";
import { formatNumber } from "@/lib/format";
import { ErrorNote, Loading, Page, PageTitle } from "@/components/ui";

function Stat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="border-b border-rule py-6 px-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </div>
      <div
        className={
          "font-display font-mono tabular-nums text-[clamp(2.4rem,5vw,3.6rem)] " +
          "leading-none mt-2 " +
          (warn ? "text-oxblood" : "text-ink")
        }
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!stats) return <Page><Loading /></Page>;

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — สรุปประจำวัน">
        แดชบอร์ด
      </PageTitle>

      <section>
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">ตัวเลขสะสม</h2>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-rule">
          <Stat label="ผู้ใช้" value={stats.users} />
          <Stat label="คอร์ส" value={stats.courses} />
          <Stat label="บทเรียน" value={stats.lessons} />
          <Stat label="การลงทะเบียน" value={stats.enrollments} />
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline gap-4 mb-2">
          <h2 className="font-display text-2xl">ความเคลื่อนไหวคีย์</h2>
          <span className="font-mono text-[11px] text-muted">๒๔ ชั่วโมงที่ผ่านมา</span>
          <span className="grow border-t border-rule/40" />
        </div>
        <div className="grid grid-cols-2 border-t border-rule">
          <Stat label="คีย์ที่อนุมัติ" value={stats.key_grants_24h} />
          <Stat
            label="คีย์ที่ปฏิเสธ"
            value={stats.key_denials_24h}
            warn={stats.key_denials_24h > 0}
          />
        </div>
        <p className="mt-4 text-[12px] italic text-muted leading-relaxed max-w-prose">
          จำนวนการปฏิเสธคีย์ที่สูงผิดปกติอาจหมายถึงการสุ่มเดารหัส
          การใช้บัญชีร่วมกัน หรือสคริปต์ดูดเนื้อหา —
          เปิดดู&nbsp;
          <a href="/admin/logs" className="underline underline-offset-4 decoration-1 text-ink">
            บันทึกคีย์
          </a>
          &nbsp;เพื่อตรวจสอบเชิงลึก
        </p>
      </section>
    </Page>
  );
}
