"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

type Me = { id: string; email: string; email_verified: boolean };

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Me>("/api/v1/auth/me")
      .then(setMe)
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/login");
        else setError(e.message);
      });
  }, [router]);

  async function exportData() {
    setBusy(true); setError(null);
    try {
      const data = await apiFetch<unknown>("/api/v1/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `account-${me?.email ?? "data"}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "export failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!me) return;
    if (!confirm("การลบบัญชีจะล้างข้อมูลส่วนตัวและออกจากระบบทุกอุปกรณ์ ดำเนินการต่อ?")) return;
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/v1/account/delete", {
        method: "POST",
        body: JSON.stringify({ confirm_email: confirmEmail }),
      });
      router.push("/login");
    } catch (e: any) {
      setError(e?.message ?? "delete failed");
      setBusy(false);
    }
  }

  async function logoutAll() {
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/v1/auth/logout-all", { method: "POST" });
      router.push("/login");
    } catch (e: any) {
      setError(e?.message ?? "failed");
      setBusy(false);
    }
  }

  if (!me) return <main className="p-8 opacity-60">กำลังโหลด…</main>;

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-8">
      <h1 className="text-2xl font-semibold">บัญชีของฉัน</h1>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="rounded-xl border border-neutral-800 p-5 space-y-2">
        <h2 className="font-medium">โปรไฟล์</h2>
        <p className="text-sm opacity-70">{me.email}</p>
        <p className="text-xs opacity-50">
          ยืนยันอีเมลแล้ว: {me.email_verified ? "ใช่" : "ยังไม่"}
        </p>
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-3">
        <h2 className="font-medium">เซสชันการเข้าใช้งาน</h2>
        <p className="text-sm opacity-70">
          ออกจากระบบทุกอุปกรณ์ที่บัญชีนี้กำลังใช้งานอยู่
        </p>
        <button
          onClick={logoutAll} disabled={busy}
          className="rounded-md bg-white text-black font-medium px-4 py-2 disabled:opacity-50"
        >
          ออกจากระบบทุกอุปกรณ์
        </button>
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-3">
        <h2 className="font-medium">ดาวน์โหลดข้อมูลของฉัน</h2>
        <p className="text-sm opacity-70">
          ดาวน์โหลดไฟล์ JSON ของข้อมูลทั้งหมดที่ระบบเก็บไว้สำหรับบัญชีนี้
        </p>
        <button
          onClick={exportData} disabled={busy}
          className="rounded-md bg-white text-black font-medium px-4 py-2 disabled:opacity-50"
        >
          ดาวน์โหลดข้อมูล
        </button>
      </section>

      <section className="rounded-xl border border-red-900/60 p-5 space-y-3">
        <h2 className="font-medium text-red-300">ลบบัญชี</h2>
        <p className="text-sm opacity-70">
          ระบบจะล้างข้อมูลส่วนตัว ลบความคืบหน้าการเรียนและสิทธิ์เรียนทั้งหมด
          ส่วนข้อมูลการชำระเงินจะเก็บไว้ตามกฎหมายบัญชี
          พิมพ์อีเมลของคุณเพื่อยืนยัน
        </p>
        <input
          type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)}
          placeholder={me.email}
          className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-400"
        />
        <button
          onClick={deleteAccount}
          disabled={busy || confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()}
          className="rounded-md bg-red-600 text-white font-medium px-4 py-2 disabled:opacity-40"
        >
          ลบบัญชีของฉัน
        </button>
      </section>
    </main>
  );
}
