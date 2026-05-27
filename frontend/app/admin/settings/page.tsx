"use client";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import {
  Button, ErrorNote, Input, KeyValue, Loading, OkNote, Page, PageTitle,
  Section, StatusDot,
} from "@/components/ui";

type Settings = {
  email: {
    smtp_host: string; smtp_port: number; smtp_use_tls: boolean;
    smtp_user: string | null; smtp_password_set: boolean;
    smtp_from: string; frontend_url: string;
  };
  storage: {
    r2_account_id_tail: string; r2_bucket: string | null;
    r2_public_base: string; r2_creds_set: boolean;
  };
  backup: {
    aws_region: string; aws_bucket: string | null;
    storage_class: string; aws_creds_set: boolean;
  };
  payments: {
    method: string; currency: string;
    slipok_configured: boolean; receiver_bank_set: boolean;
  };
  security: {
    kek_set: boolean; jwt_secret_set: boolean; jwt_ttl_min: number;
    pb_session_ttl_sec: number; key_rate_limit_per_min: number;
    max_concurrent_sessions: number; e2e_bypass_set: boolean;
  };
  cors_origins: string[];
};

export default function AdminSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Settings>("/api/v1/admin/settings")
      .then(setS)
      .catch((e: ApiError) => setErr(e.message));
  }, []);

  async function sendTest() {
    setBusy(true); setTestMsg(null); setTestOk(false);
    try {
      await apiFetch("/api/v1/admin/settings/test-email", {
        method: "POST", body: JSON.stringify({ to: testTo }),
      });
      setTestOk(true);
      setTestMsg("ส่งแล้ว — ตรวจกล่องจดหมาย รวมถึงโฟลเดอร์ขยะ");
    } catch (e: any) {
      setTestMsg(`ส่งไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally { setBusy(false); }
  }

  if (err) return <Page><ErrorNote>{err}</ErrorNote></Page>;
  if (!s) return <Page><Loading /></Page>;

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — ห้องเครื่อง">
        การตั้งค่าระบบ
      </PageTitle>

      <p className="text-[13px] text-muted leading-relaxed -mt-6 mb-2 max-w-prose">
        หน้านี้แสดงค่าที่อ่านจากตัวแปรสภาพแวดล้อมของคอนเทนเนอร์ API
        ค่าที่เป็นความลับ (คีย์ลับ รหัสผ่าน) จะถูกซ่อนเสมอ
        การแก้ไขทำผ่านไฟล์ <code className="font-mono text-ink">.env</code> แล้ว{" "}
        <code className="font-mono text-ink">docker compose up -d</code> ใหม่
      </p>

      <Section
        title="อีเมล"
        hint="SMTP / Postfix relay ที่ใช้ส่งอีเมลยืนยัน รีเซ็ตรหัสผ่าน และใบกำกับภาษี"
      >
        <div className="mb-3">
          <StatusDot ok={!!s.email.smtp_host} />
        </div>
        <dl className="border-t border-rule mb-6">
          <KeyValue k="SMTP host" v={s.email.smtp_host || "—"} />
          <KeyValue k="Port" v={s.email.smtp_port} />
          <KeyValue k="TLS" v={s.email.smtp_use_tls ? "เปิด" : "ปิด"} />
          <KeyValue k="ผู้ส่ง" v={s.email.smtp_from} />
          <KeyValue k="ผู้ใช้ SMTP" v={s.email.smtp_user ?? "—"} />
          <KeyValue k="รหัสผ่าน SMTP"
            v={<StatusDot ok={s.email.smtp_password_set} labelOk="ตั้งแล้ว" labelNo="ว่าง" />} />
          <KeyValue k="ลิงก์ในอีเมล" v={s.email.frontend_url} />
        </dl>
        <div className="border-t border-rule pt-4">
          <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">
            ทดสอบส่งอีเมล
          </p>
          <div className="flex gap-3 items-end">
            <Input type="email" placeholder="ปลายทาง"
              value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <Button tone="ghost" onClick={sendTest} disabled={busy || !testTo}>
              {busy ? "…" : "ส่ง"}
            </Button>
          </div>
          {testMsg && (testOk ? <OkNote>{testMsg}</OkNote> : <ErrorNote>{testMsg}</ErrorNote>)}
        </div>
      </Section>

      <Section
        title="วิดีโอ Storage"
        hint="Cloudflare R2 — เก็บ HLS manifest และ segment เข้ารหัส"
      >
        <div className="mb-3">
          <StatusDot ok={s.storage.r2_creds_set} />
        </div>
        <dl className="border-t border-rule">
          <KeyValue k="Bucket" v={s.storage.r2_bucket ?? "—"} />
          <KeyValue k="Public base URL" v={s.storage.r2_public_base || "—"} />
          <KeyValue k="Account ID (ท้าย)" v={s.storage.r2_account_id_tail || "—"} />
        </dl>
      </Section>

      <Section
        title="สำรองข้อมูล"
        hint="S3 Glacier — สำเนาฐานข้อมูลและไฟล์สื่อระยะยาว"
      >
        <div className="mb-3">
          <StatusDot ok={s.backup.aws_creds_set} />
        </div>
        <dl className="border-t border-rule">
          <KeyValue k="Region" v={s.backup.aws_region} />
          <KeyValue k="Bucket" v={s.backup.aws_bucket ?? "—"} />
          <KeyValue k="Storage class" v={s.backup.storage_class} />
        </dl>
      </Section>

      <Section
        title="การชำระเงิน"
        hint="ระบบรับโอนผ่านธนาคาร + ตรวจสลิปด้วย SlipOK"
      >
        <div className="mb-3">
          <StatusDot ok={s.payments.receiver_bank_set} />
        </div>
        <dl className="border-t border-rule">
          <KeyValue k="วิธีการ" v={s.payments.method} />
          <KeyValue k="สกุลเงิน" v={s.payments.currency.toUpperCase()} />
          <KeyValue k="บัญชีผู้รับ"
            v={<StatusDot ok={s.payments.receiver_bank_set} labelOk="ตั้งแล้ว" labelNo="ว่าง" />} />
          <KeyValue k="SlipOK auto-verify"
            v={<StatusDot ok={s.payments.slipok_configured}
                          labelOk="เปิด"
                          labelNo="ปิด — แอดมินรีวิวเอง" />} />
        </dl>
      </Section>

      <Section
        title="ความปลอดภัย"
        hint="คีย์เข้ารหัส อายุเซสชัน และการจำกัดอัตราการเรียก"
      >
        <dl className="border-t border-rule">
          <KeyValue k="KEK (เข้ารหัสคีย์วิดีโอ)"
            v={<StatusDot ok={s.security.kek_set} labelOk="ตั้งแล้ว" labelNo="ว่าง" />} />
          <KeyValue k="JWT secret"
            v={<StatusDot ok={s.security.jwt_secret_set} labelOk="ตั้งแล้ว" labelNo="ว่าง" />} />
          <KeyValue k="อายุ JWT" v={`${s.security.jwt_ttl_min} นาที`} />
          <KeyValue k="อายุ playback session" v={`${s.security.pb_session_ttl_sec} วินาที`} />
          <KeyValue k="จำกัดเรียก key" v={`${s.security.key_rate_limit_per_min} ครั้ง/นาที`} />
          <KeyValue k="เซสชันสูงสุดต่อบัญชี" v={s.security.max_concurrent_sessions} />
          <KeyValue k="E2E bypass"
            v={<StatusDot ok={s.security.e2e_bypass_set}
                          labelOk="เปิด — ห้ามใช้ใน production"
                          labelNo="ปิด" />} />
        </dl>
      </Section>

      <Section title="CORS" hint="Origin ที่อนุญาตให้เรียก API ข้ามโดเมน">
        {s.cors_origins.length === 0 ? (
          <p className="text-muted italic">ยังไม่มี origin อนุญาต</p>
        ) : (
          <ul className="border-t border-rule">
            {s.cors_origins.map((o) => (
              <li key={o} className="border-b border-rule/40 py-2 font-mono text-[13px]">
                {o}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
