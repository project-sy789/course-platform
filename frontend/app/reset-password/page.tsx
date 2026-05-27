"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) { setError("ไม่พบโทเค็นในลิงก์"); return; }
    setError(null); setBusy(true);
    try {
      await apiFetch("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      });
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="max-w-md mx-auto px-6 pt-16 pb-24">
      <div className="border-b border-rule pb-4 mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2">
          กู้คืนบัญชี — ขั้นสุดท้าย
        </div>
        <h1 className="font-display font-semibold text-[2.2rem] leading-none tracking-[-0.02em]">
          ตั้งรหัสผ่านใหม่
        </h1>
      </div>

      {done ? (
        <div className="space-y-4">
          <p className="text-[15px] leading-relaxed">เปลี่ยนรหัสผ่านสำเร็จแล้ว</p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition"
          >
            เข้าสู่ระบบ →
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <Field label="รหัสผ่านใหม่" hint="อย่างน้อย ๘ ตัวอักษร">
            <Input
              type="password" required minLength={8} autoFocus
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex items-center justify-between pt-2">
            <Link href="/login"
              className="text-[13px] text-muted underline underline-offset-4 decoration-1">
              ← ยกเลิก
            </Link>
            <Button type="submit" disabled={busy || !token}>
              {busy ? "…" : "บันทึก"}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
