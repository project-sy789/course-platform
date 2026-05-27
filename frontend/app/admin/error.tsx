"use client";
import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("admin error", error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-oxblood mb-4">
        เกิดข้อผิดพลาดในกองบรรณาธิการ
      </div>
      <h1 className="font-display text-3xl mb-4">ระบบหลังบ้านสะดุด</h1>
      <p className="lede text-muted mb-6">
        คำสั่งล่าสุดไม่สำเร็จ — ลองใหม่หรือรีเฟรชหน้าเพื่อดึงข้อมูลล่าสุด
      </p>
      {error?.digest && (
        <p className="font-mono text-[11px] text-muted mb-6">
          รหัสอ้างอิง: {error.digest}
        </p>
      )}
      <button
        onClick={() => reset()}
        className="border-2 border-ink px-5 py-2 text-[13px] uppercase tracking-[0.18em] hover:bg-ink hover:text-paper transition"
      >
        ลองใหม่ →
      </button>
    </div>
  );
}
