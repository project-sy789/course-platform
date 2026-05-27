"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";

type Settings = {
  email: {
    smtp_host: string;
    smtp_port: number;
    smtp_use_tls: boolean;
    smtp_user: string | null;
    smtp_password_set: boolean;
    smtp_from: string;
    frontend_url: string;
  };
  storage: {
    r2_account_id_tail: string;
    r2_bucket: string | null;
    r2_public_base: string;
    r2_creds_set: boolean;
  };
  backup: {
    aws_region: string;
    aws_bucket: string | null;
    storage_class: string;
    aws_creds_set: boolean;
  };
  payments: {
    method: string;
    currency: string;
    slipok_configured: boolean;
    receiver_bank_set: boolean;
  };
  security: {
    kek_set: boolean;
    jwt_secret_set: boolean;
    jwt_ttl_min: number;
    pb_session_ttl_sec: number;
    key_rate_limit_per_min: number;
    max_concurrent_sessions: number;
    e2e_bypass_set: boolean;
  };
  cors_origins: string[];
};

function Status({ ok, labelOk = "พร้อมใช้งาน", labelNo = "ยังไม่ตั้งค่า" }: {
  ok: boolean; labelOk?: string; labelNo?: string;
}) {
  return (
    <span className={
      "text-xs px-2 py-0.5 rounded " +
      (ok ? "bg-emerald-950/50 text-emerald-300" : "bg-neutral-900 text-neutral-400")
    }>
      {ok ? labelOk : labelNo}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="opacity-60">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Settings>("/api/v1/admin/settings")
      .then(setS)
      .catch((e: ApiError) => setErr(e.message));
  }, []);

  async function sendTest() {
    setBusy(true); setTestMsg(null);
    try {
      await apiFetch("/api/v1/admin/settings/test-email", {
        method: "POST",
        body: JSON.stringify({ to: testTo }),
      });
      setTestMsg("ส่งแล้ว — ตรวจกล่องจดหมาย (รวมถึงโฟลเดอร์ Spam)");
    } catch (e: any) {
      setTestMsg(`ส่งไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <main className="p-8 text-red-400">เกิดข้อผิดพลาด: {err}</main>;
  if (!s) return <main className="p-8 opacity-60">กำลังโหลด…</main>;

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">การตั้งค่าระบบ</h1>
        <Link href="/admin" className="text-sm underline opacity-70">← แอดมิน</Link>
      </header>

      <p className="text-sm opacity-60">
        หน้านี้แสดงค่าที่โหลดจาก environment ของคอนเทนเนอร์ API
        ค่าที่เป็นความลับ (คีย์, รหัสผ่าน) จะถูกซ่อนเสมอ
        แก้ค่าผ่าน <code className="text-xs">.env</code> แล้ว <code className="text-xs">docker compose up -d</code> ใหม่
      </p>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">อีเมล (SMTP / Postfix)</h2>
          <Status ok={!!s.email.smtp_host} />
        </div>
        <Row label="SMTP host" value={s.email.smtp_host || "—"} />
        <Row label="Port" value={s.email.smtp_port} />
        <Row label="TLS" value={s.email.smtp_use_tls ? "เปิด" : "ปิด"} />
        <Row label="ผู้ส่ง (From)" value={s.email.smtp_from} />
        <Row label="ผู้ใช้ SMTP" value={s.email.smtp_user ?? "—"} />
        <Row label="รหัสผ่าน SMTP" value={<Status ok={s.email.smtp_password_set} labelOk="ตั้งแล้ว" labelNo="ว่าง"/>} />
        <Row label="ลิงก์หน้าเว็บใน email" value={s.email.frontend_url} />

        <div className="mt-4 border-t border-neutral-800 pt-4 space-y-2">
          <p className="text-sm opacity-70">ทดสอบส่งอีเมลผ่าน relay ที่ตั้งค่าไว้:</p>
          <div className="flex gap-2">
            <input
              type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
              placeholder="ปลายทาง"
              className="flex-1 rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm"
            />
            <button
              onClick={sendTest} disabled={busy || !testTo}
              className="rounded-md bg-white text-black font-medium px-4 text-sm disabled:opacity-50"
            >
              {busy ? "…" : "ส่งทดสอบ"}
            </button>
          </div>
          {testMsg && <p className="text-xs opacity-70">{testMsg}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">วิดีโอ Storage (Cloudflare R2)</h2>
          <Status ok={s.storage.r2_creds_set} />
        </div>
        <Row label="Bucket" value={s.storage.r2_bucket ?? "—"} />
        <Row label="Public base URL" value={s.storage.r2_public_base || "—"} />
        <Row label="Account ID (ท้าย)" value={s.storage.r2_account_id_tail || "—"} />
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">สำรองข้อมูล (S3 Glacier)</h2>
          <Status ok={s.backup.aws_creds_set} />
        </div>
        <Row label="Region" value={s.backup.aws_region} />
        <Row label="Bucket" value={s.backup.aws_bucket ?? "—"} />
        <Row label="Storage class" value={s.backup.storage_class} />
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">การชำระเงิน (โอนเงิน + สลิป)</h2>
          <Status ok={s.payments.receiver_bank_set} />
        </div>
        <Row label="วิธีการ" value={s.payments.method} />
        <Row label="สกุลเงิน" value={s.payments.currency.toUpperCase()} />
        <Row label="ตั้งค่าบัญชีผู้รับ" value={<Status ok={s.payments.receiver_bank_set} labelOk="ตั้งแล้ว" labelNo="ว่าง"/>} />
        <Row label="SlipOK auto-verify" value={<Status ok={s.payments.slipok_configured} labelOk="เปิด" labelNo="ปิด — รีวิวด้วย admin"/>} />
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-1">
        <h2 className="font-medium mb-3">ความปลอดภัย</h2>
        <Row label="KEK (เข้ารหัสคีย์วิดีโอ)" value={<Status ok={s.security.kek_set} labelOk="ตั้งแล้ว" labelNo="ว่าง"/>} />
        <Row label="JWT secret" value={<Status ok={s.security.jwt_secret_set} labelOk="ตั้งแล้ว" labelNo="ว่าง"/>} />
        <Row label="อายุ JWT (นาที)" value={s.security.jwt_ttl_min} />
        <Row label="อายุ playback session (วินาที)" value={s.security.pb_session_ttl_sec} />
        <Row label="จำกัดเรียก key/นาที" value={s.security.key_rate_limit_per_min} />
        <Row label="เซสชันสูงสุดต่อบัญชี" value={s.security.max_concurrent_sessions} />
        <Row label="E2E bypass token"
             value={<Status ok={s.security.e2e_bypass_set}
                            labelOk="เปิด — ห้ามใช้ใน production!"
                            labelNo="ปิด"/>} />
      </section>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-1">
        <h2 className="font-medium mb-3">CORS</h2>
        {s.cors_origins.length === 0 ? (
          <p className="text-sm opacity-50">ยังไม่มี origin อนุญาต</p>
        ) : (
          <ul className="text-sm font-mono">
            {s.cors_origins.map((o) => (
              <li key={o} className="py-0.5">{o}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
