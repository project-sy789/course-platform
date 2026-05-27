"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<"verifying" | "ok" | "fail">("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("fail"); setError("ไม่พบโทเค็นในลิงก์"); return;
    }
    apiFetch(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`,
             { method: "POST" })
      .then(() => setStatus("ok"))
      .catch((e) => { setStatus("fail"); setError(e.message); });
  }, []);

  return (
    <main className="max-w-md mx-auto px-6 pt-16 pb-24">
      {status === "verifying" && (
        <p className="font-display italic text-[18px] text-muted">กำลังยืนยัน…</p>
      )}

      {status === "ok" && (
        <article>
          <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-3">
            ยืนยันแล้ว
          </div>
          <h1 className="font-display font-semibold text-[2.4rem] leading-none tracking-[-0.02em] mb-4">
            ยินดีต้อนรับ
          </h1>
          <p className="text-[15px] leading-relaxed mb-6">
            อีเมลของคุณได้รับการยืนยันเรียบร้อย
            ระบบเปิดสิทธิ์การเข้าใช้งานเต็มรูปแบบให้แล้ว
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition"
          >
            เข้าสู่ระบบ →
          </Link>
        </article>
      )}

      {status === "fail" && (
        <article>
          <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-3">
            ขออภัย
          </div>
          <h1 className="font-display font-semibold text-[2.4rem] leading-none tracking-[-0.02em] mb-4">
            ยืนยันไม่สำเร็จ
          </h1>
          <p className="text-[15px] leading-relaxed text-muted mb-6">
            {error ?? "ลิงก์อาจหมดอายุหรือถูกใช้งานไปแล้ว"}
          </p>
          <Link href="/login" className="text-[14px] underline underline-offset-4">
            ← กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </article>
      )}
    </main>
  );
}
