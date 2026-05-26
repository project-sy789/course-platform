"use client";
import { useEffect, useState } from "react";
import { adminApi, type Stats } from "@/lib/admin";
import { formatNumber } from "@/lib/format";

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "warn" ? "border-red-700 bg-red-950/30" : "border-neutral-800"}`}>
      <p className="text-xs uppercase tracking-wide opacity-60">{label}</p>
      <p className="text-2xl font-semibold mt-1">{formatNumber(value)}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-400">เกิดข้อผิดพลาด: {error}</p>;
  if (!stats) return <p className="opacity-60">กำลังโหลด…</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">แดชบอร์ด</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="ผู้ใช้" value={stats.users} />
        <StatCard label="คอร์ส" value={stats.courses} />
        <StatCard label="บทเรียน" value={stats.lessons} />
        <StatCard label="การลงทะเบียน" value={stats.enrollments} />
        <StatCard label="คีย์ที่ออก (24 ชม.)" value={stats.key_grants_24h} />
        <StatCard
          label="คีย์ที่ปฏิเสธ (24 ชม.)"
          value={stats.key_denials_24h}
          tone={stats.key_denials_24h > 0 ? "warn" : undefined}
        />
      </div>
      <p className="mt-6 text-xs opacity-60">
        การปฏิเสธคีย์จำนวนมากอาจหมายถึงการสุ่มเดารหัสผ่านหรือการใช้บัญชีร่วมกัน
        เปิดดู &ldquo;บันทึกการเข้าถึง&rdquo; เพื่อตรวจสอบเชิงลึก
      </p>
    </div>
  );
}
