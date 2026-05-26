"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

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
    if (!token) { setError("Missing token"); return; }
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
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 p-6 space-y-4">
        <h1 className="text-xl font-semibold">Reset password</h1>
        {done ? (
          <>
            <p className="text-sm opacity-80">Password updated.</p>
            <Link href="/login" className="block text-center underline">Sign in</Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={busy || !token}
                    className="w-full rounded-md bg-white text-black font-medium py-2 disabled:opacity-50">
              {busy ? "…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
