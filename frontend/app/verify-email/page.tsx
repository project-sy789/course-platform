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
      setStatus("fail"); setError("ไม่พบโทเค็นใน URL"); return;
    }
    apiFetch(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`,
             { method: "POST" })
      .then(() => setStatus("ok"))
      .catch((e) => { setStatus("fail"); setError(e.message); });
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-neutral-800 p-6 text-center">
        {status === "verifying" && <p className="opacity-60">กำลังยืนยัน…</p>}
        {status === "ok" && (
          <>
            <h1 className="text-xl font-semibold mb-2">ยืนยันอีเมลสำเร็จ</h1>
            <p className="opacity-70 mb-4">เข้าสู่ระบบได้แล้ว</p>
            <Link href="/login" className="underline">ไปหน้าเข้าสู่ระบบ</Link>
          </>
        )}
        {status === "fail" && (
          <>
            <h1 className="text-xl font-semibold text-red-400 mb-2">ยืนยันอีเมลไม่สำเร็จ</h1>
            <p className="opacity-70 mb-4">{error ?? "ลิงก์อาจหมดอายุหรือถูกใช้ไปแล้ว"}</p>
            <Link href="/login" className="underline">กลับไปเข้าสู่ระบบ</Link>
          </>
        )}
      </div>
    </main>
  );
}
