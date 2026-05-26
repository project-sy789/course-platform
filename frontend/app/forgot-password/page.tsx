"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await apiFetch("/api/v1/auth/request-password-reset", {
        method: "POST", body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-neutral-800 p-6 space-y-4">
        <h1 className="text-xl font-semibold">ลืมรหัสผ่าน</h1>
        {sent ? (
          <p className="text-sm opacity-80">
            หากอีเมลนี้ลงทะเบียนไว้ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ในไม่กี่นาที กรุณาตรวจกล่องจดหมาย
          </p>
        ) : (
          <>
            <p className="text-sm opacity-70">
              กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ใช้งานครั้งเดียว
            </p>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2"
            />
            <button disabled={busy}
                    className="w-full rounded-md bg-white text-black font-medium py-2 disabled:opacity-50">
              {busy ? "…" : "ส่งลิงก์รีเซ็ต"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
