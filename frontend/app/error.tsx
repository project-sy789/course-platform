"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("page error", error);
  }, [error]);

  return (
    <main className="max-w-3xl mx-auto px-6 py-24">
      <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-oxblood mb-6">
        ข่าวด่วน — เกิดเหตุขัดข้องในกองบรรณาธิการ
      </div>
      <h1 className="font-display font-semibold text-[clamp(2.4rem,5.5vw,4rem)] leading-[1] tracking-[-0.02em] mb-6">
        เกิดข้อผิดพลาด<span className="italic font-normal text-oxblood">ที่ไม่คาดคิด</span>
      </h1>
      <p className="lede max-w-xl mb-6 text-[17px]">
        ระบบไม่สามารถแสดงหน้านี้ได้ — ทีมงานได้รับแจ้งแล้ว
        ท่านสามารถลองใหม่ หรือกลับไปหน้าก่อนหน้า
      </p>
      {error?.digest && (
        <p className="font-mono text-[11px] text-muted mb-8">
          รหัสอ้างอิง: {error.digest}
        </p>
      )}
      <div className="flex flex-wrap gap-3 border-t border-rule pt-6">
        <button
          onClick={() => reset()}
          className="border-2 border-ink px-5 py-2 text-[13px] uppercase tracking-[0.18em] hover:bg-ink hover:text-paper transition"
        >
          ลองใหม่ →
        </button>
        <Link
          href="/"
          className="px-5 py-2 text-[13px] uppercase tracking-[0.18em] text-muted hover:text-ink underline underline-offset-4 decoration-1"
        >
          กลับหน้าแรก
        </Link>
      </div>
    </main>
  );
}
