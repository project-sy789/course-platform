"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
      await apiFetch(path, { method: "POST", body: JSON.stringify({ email, password }) });
      if (mode === "register") {
        await apiFetch("/api/v1/auth/login", {
          method: "POST", body: JSON.stringify({ email, password }),
        });
      }
      router.push("/");
    } catch (e: any) {
      setError(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 p-6">
        <h1 className="text-xl font-semibold">{mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</h1>

        <label className="block">
          <span className="text-sm opacity-70">อีเมล</span>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>

        <label className="block">
          <span className="text-sm opacity-70">รหัสผ่าน</span>
          <input
            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit" disabled={busy}
          className="w-full rounded-md bg-white text-black font-medium py-2 disabled:opacity-50"
        >
          {busy ? "…" : mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
        </button>

        <button
          type="button"
          className="w-full text-xs underline opacity-70"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีอยู่แล้ว? เข้าสู่ระบบ"}
        </button>

        {mode === "login" && (
          <a href="/forgot-password" className="block text-center text-xs underline opacity-60">
            ลืมรหัสผ่าน?
          </a>
        )}
      </form>
    </main>
  );
}
