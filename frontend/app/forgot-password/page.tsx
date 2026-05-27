"use client";
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

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
    <main className="max-w-md mx-auto px-6 pt-16 pb-24">
      <div className="border-b border-rule pb-4 mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2">
          กู้คืนบัญชี
        </div>
        <h1 className="font-display font-semibold text-[2.2rem] leading-none tracking-[-0.02em]">
          ลืมรหัสผ่าน
        </h1>
      </div>

      {sent ? (
        <div className="space-y-4">
          <p className="text-[15px] leading-relaxed">
            หากอีเมลนี้ลงทะเบียนไว้ในระบบ
            เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ในไม่กี่นาที
            กรุณาตรวจกล่องจดหมาย รวมถึงโฟลเดอร์ขยะ
          </p>
          <p className="text-[12px] italic text-muted">
            ลิงก์รีเซ็ตใช้งานได้ครั้งเดียว และหมดอายุใน ๑๕ นาที
          </p>
          <Link href="/login" className="inline-block text-[14px] underline underline-offset-4">
            ← กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <p className="text-[14px] text-muted leading-relaxed">
            กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์รีเซ็ตรหัสผ่านที่ใช้งานได้ครั้งเดียว
          </p>
          <Field label="อีเมล">
            <Input type="email" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" />
          </Field>
          <div className="flex items-center justify-between pt-2">
            <Link href="/login"
              className="text-[13px] text-muted underline underline-offset-4 decoration-1">
              ← ย้อนกลับ
            </Link>
            <Button type="submit" disabled={busy}>
              {busy ? "…" : "ส่งลิงก์รีเซ็ต"}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
