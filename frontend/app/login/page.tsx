"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, confirmDeviceOtp, loginRequest } from "@/lib/api";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await apiFetch("/api/v1/auth/register", {
          method: "POST", body: JSON.stringify({ email, password }),
        });
      }
      const r = await loginRequest(email, password);
      if (r.otp_required) setChallenge(r.challenge_token);
      else router.push("/");
    } catch (e: any) {
      setError(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null); setBusy(true);
    try {
      await confirmDeviceOtp(challenge, otp.trim());
      router.push("/");
    } catch (e: any) {
      setError(e?.message ?? "รหัสไม่ถูกต้องหรือหมดอายุ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 pt-16 pb-24">
      {challenge ? (
        <form onSubmit={submitOtp} className="space-y-6">
          <div className="border-b border-rule pb-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2">
              ขั้นตอนที่ ๒ — ยืนยันอุปกรณ์
            </div>
            <h1 className="font-display font-semibold text-[2rem] leading-none tracking-[-0.02em]">
              กรอกรหัสยืนยัน
            </h1>
          </div>
          <p className="text-[14px] text-muted leading-relaxed">
            เราส่งรหัสยืนยัน ๖ หลักไปยังอีเมลของคุณแล้ว ใช้งานได้ภายใน ๑๐ นาที
          </p>
          <input
            inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
            required value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            placeholder="0 0 0 0 0 0"
            className="w-full text-center font-mono text-[2rem] tracking-[0.5em]
                       bg-transparent border-b border-rule
                       focus:border-b-2 focus:border-oxblood outline-none py-3"
          />
          <ErrorNote>{error}</ErrorNote>
          <div className="flex items-center justify-between pt-2">
            <Button type="button" tone="link"
              onClick={() => { setChallenge(null); setOtp(""); }}>
              ← ย้อนกลับ
            </Button>
            <Button type="submit" disabled={busy || otp.length !== 6}>
              {busy ? "กำลังยืนยัน…" : "ยืนยัน"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <div className="border-b border-rule pb-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2">
              {mode === "login" ? "สมาชิกเก่า" : "สมาชิกใหม่"}
            </div>
            <h1 className="font-display font-semibold text-[2.4rem] leading-none tracking-[-0.02em]">
              {mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </h1>
          </div>

          <Field label="อีเมล">
            <Input type="email" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" />
          </Field>

          <Field label="รหัสผ่าน"
            hint={mode === "register" ? "อย่างน้อย ๘ ตัวอักษร" : undefined}>
            <Input type="password" required minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <ErrorNote>{error}</ErrorNote>

          <div className="flex items-center justify-between pt-2">
            <button type="button"
              className="text-[13px] text-muted underline underline-offset-4 decoration-1"
              onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login"
                ? "ยังไม่มีบัญชี? สมัครสมาชิก"
                : "มีบัญชีอยู่แล้ว? เข้าสู่ระบบ"}
            </button>
            <Button type="submit" disabled={busy}>
              {busy ? "…" : mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </Button>
          </div>

          {mode === "login" && (
            <p className="text-center pt-4 border-t border-rule/40">
              <Link href="/forgot-password"
                className="text-[13px] text-muted underline underline-offset-4 decoration-1">
                ลืมรหัสผ่าน?
              </Link>
            </p>
          )}
        </form>
      )}
    </main>
  );
}
