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
      setStatus("fail"); setError("Missing token in URL"); return;
    }
    apiFetch(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`,
             { method: "POST" })
      .then(() => setStatus("ok"))
      .catch((e) => { setStatus("fail"); setError(e.message); });
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-neutral-800 p-6 text-center">
        {status === "verifying" && <p className="opacity-60">Verifying…</p>}
        {status === "ok" && (
          <>
            <h1 className="text-xl font-semibold mb-2">Email verified</h1>
            <p className="opacity-70 mb-4">You can now sign in.</p>
            <Link href="/login" className="underline">Go to login</Link>
          </>
        )}
        {status === "fail" && (
          <>
            <h1 className="text-xl font-semibold text-red-400 mb-2">Verification failed</h1>
            <p className="opacity-70 mb-4">{error ?? "Token may be expired or already used."}</p>
            <Link href="/login" className="underline">Back to login</Link>
          </>
        )}
      </div>
    </main>
  );
}
