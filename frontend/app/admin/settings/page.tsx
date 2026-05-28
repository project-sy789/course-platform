"use client";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { adminApi, EmailProvider, EmailSettingsView } from "@/lib/admin";
import PromptPayQR from "@/components/PromptPayQR";
import {
  Button, ErrorNote, Field, Input, KeyValue, Loading, OkNote, Page, PageTitle,
  Pill, Section, Select, StatusDot,
} from "@/components/ui";

type PaymentSettings = {
  receiver_bank_name: string;
  receiver_bank_account: string;
  receiver_name: string;
  promptpay_id: string;
  slipok_branch_id: string;
  slipok_api_key_set: boolean;
  slipok_enabled: boolean;
  receiver_bank_set: boolean;
  overrides: {
    receiver_bank_name: boolean;
    receiver_bank_account: boolean;
    receiver_name: boolean;
    promptpay_id: boolean;
    slipok_branch_id: boolean;
    slipok_api_key: boolean;
  };
};

type Settings = {
  email: {
    provider: EmailProvider;
    configured: boolean;
    from: string;
    from_name: string | null;
    api_key_set: boolean;
    smtp_host: string; smtp_port: number; smtp_use_tls: boolean;
    smtp_user: string | null; smtp_password_set: boolean;
    frontend_url: string;
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

const PROVIDER_LABEL: Record<EmailProvider, string> = {
  smtp: "SMTP (Postfix หรือ relay ภายนอก)",
  resend: "Resend",
  postmark: "Postmark",
  sendgrid: "SendGrid",
  disabled: "ปิดการส่ง (no-op สำหรับ dev/test)",
};

export default function AdminSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState<EmailSettingsView | null>(null);
  const [emailForm, setEmailForm] = useState({
    provider: "smtp" as EmailProvider,
    from_email: "",
    from_name: "",
    api_key: "",
  });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailOk, setEmailOk] = useState(false);

  const [pay, setPay] = useState<PaymentSettings | null>(null);
  const [payForm, setPayForm] = useState({
    receiver_bank_name: "",
    receiver_bank_account: "",
    receiver_name: "",
    promptpay_id: "",
    slipok_branch_id: "",
    slipok_api_key: "",
  });
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [payOk, setPayOk] = useState(false);

  function loadEmail() {
    adminApi.getEmailSettings()
      .then((e) => {
        setEmail(e);
        setEmailForm({
          provider: e.provider,
          from_email: e.from_email,
          from_name: e.from_name,
          api_key: "",
        });
      })
      .catch((e: any) => setErr(e.message));
  }

  function loadPay() {
    adminApi.getPaymentSettings()
      .then((p) => {
        setPay(p);
        setPayForm({
          receiver_bank_name: p.receiver_bank_name,
          receiver_bank_account: p.receiver_bank_account,
          receiver_name: p.receiver_name,
          promptpay_id: p.promptpay_id,
          slipok_branch_id: p.slipok_branch_id,
          slipok_api_key: "",
        });
      })
      .catch((e: any) => setErr(e.message));
  }

  function refreshTopSummary() {
    apiFetch<Settings>("/api/v1/admin/settings").then(setS).catch(() => {});
  }

  useEffect(() => {
    apiFetch<Settings>("/api/v1/admin/settings")
      .then(setS)
      .catch((e: ApiError) => setErr(e.message));
    loadEmail();
    loadPay();
  }, []);

  async function saveEmail() {
    setEmailBusy(true); setEmailMsg(null); setEmailOk(false);
    try {
      const body: any = {
        provider: emailForm.provider,
        from_email: emailForm.from_email.trim() || undefined,
        from_name: emailForm.from_name,
      };
      if (emailForm.api_key.trim()) {
        body.api_key = emailForm.api_key.trim();
      }
      await adminApi.updateEmailSettings(body);
      setEmailOk(true); setEmailMsg("บันทึกแล้ว");
      setEmailForm((f) => ({ ...f, api_key: "" }));
      loadEmail();
      refreshTopSummary();
    } catch (e: any) {
      setEmailMsg(`บันทึกไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally { setEmailBusy(false); }
  }

  async function clearEmailKey() {
    if (!window.confirm("ลบ API key ของผู้ให้บริการอีเมลออกจาก DB? ระบบจะกลับไปใช้ค่าจาก .env (ถ้ามี)")) return;
    setEmailBusy(true); setEmailMsg(null); setEmailOk(false);
    try {
      await adminApi.updateEmailSettings({ clear_api_key: true });
      setEmailOk(true); setEmailMsg("ลบ API key เรียบร้อย");
      loadEmail();
      refreshTopSummary();
    } catch (e: any) {
      setEmailMsg(`ลบไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally { setEmailBusy(false); }
  }

  async function savePay() {
    setPayBusy(true); setPayMsg(null); setPayOk(false);
    try {
      // Empty api-key field = "leave key alone". To clear, use the explicit
      // button below.
      const body: any = {
        receiver_bank_name: payForm.receiver_bank_name,
        receiver_bank_account: payForm.receiver_bank_account,
        receiver_name: payForm.receiver_name,
        promptpay_id: payForm.promptpay_id,
        slipok_branch_id: payForm.slipok_branch_id,
      };
      if (payForm.slipok_api_key.trim()) {
        body.slipok_api_key = payForm.slipok_api_key.trim();
      }
      await adminApi.updatePaymentSettings(body);
      setPayOk(true); setPayMsg("บันทึกแล้ว");
      setPayForm((f) => ({ ...f, slipok_api_key: "" }));
      loadPay();
      refreshTopSummary();
    } catch (e: any) {
      setPayMsg(`บันทึกไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally { setPayBusy(false); }
  }

  async function clearSlipokKey() {
    if (!window.confirm("ลบคีย์ SlipOK ออกจาก DB? ระบบจะกลับไปใช้ค่าจาก .env (ถ้ามี)")) return;
    setPayBusy(true); setPayMsg(null); setPayOk(false);
    try {
      await adminApi.updatePaymentSettings({ clear_slipok_api_key: true });
      setPayOk(true); setPayMsg("ลบคีย์ SlipOK เรียบร้อย");
      loadPay();
      refreshTopSummary();
    } catch (e: any) {
      setPayMsg(`ลบไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally { setPayBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setTestMsg(null); setTestOk(false);
    try {
      await adminApi.sendTestEmail(testTo);
      setTestOk(true);
      setTestMsg("ส่งแล้ว — ตรวจกล่องจดหมาย รวมถึงโฟลเดอร์ขยะ");
    } catch (e: any) {
      setTestMsg(`ส่งไม่สำเร็จ: ${e?.message ?? "unknown"}`);
    } finally { setBusy(false); }
  }

  if (err) return <Page><ErrorNote>{err}</ErrorNote></Page>;
  if (!s) return <Page><Loading /></Page>;

  const isSmtp = emailForm.provider === "smtp";
  const isDisabled = emailForm.provider === "disabled";
  const apiKeyRequired = !isSmtp && !isDisabled;

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — ห้องเครื่อง">
        การตั้งค่าระบบ
      </PageTitle>

      <p className="text-[13px] text-muted leading-relaxed -mt-6 mb-2 max-w-prose">
        การตั้งค่าระบบส่วนใหญ่อ่านจากตัวแปรสภาพแวดล้อมของคอนเทนเนอร์ API
        (แก้ผ่านไฟล์ <code className="font-mono text-ink">.env</code> แล้ว{" "}
        <code className="font-mono text-ink">docker compose up -d</code> ใหม่)
        — ส่วน <span className="text-ink">อีเมล</span> และ{" "}
        <span className="text-ink">การชำระเงิน</span> แก้ได้ทันทีในหน้านี้
        และเก็บใน DB; ค่าใน .env ใช้เป็น fallback เมื่อ DB ว่าง
      </p>

      <Section
        title="อีเมล"
        hint="เลือกผู้ให้บริการ — SMTP / Resend / Postmark / SendGrid — และตั้งค่าผู้ส่ง ใช้ส่งอีเมลยืนยัน รีเซ็ตรหัสผ่าน และใบกำกับภาษี"
      >
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <StatusDot
            ok={s.email.configured}
            labelOk={`พร้อมส่ง · ${s.email.provider}`}
            labelNo="ยังไม่พร้อมส่ง"
          />
          <span className="grow border-t border-rule/30 mx-1" />
          <Pill tone={isDisabled ? "warn" : s.email.configured ? "ok" : "neutral"}>
            {isDisabled ? "ปิดอยู่" : `provider: ${s.email.provider}`}
          </Pill>
        </div>

        {email && (
          <>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
              <Field label="ผู้ให้บริการ" hint="เปลี่ยนแล้วมีผลกับการส่งครั้งถัดไป">
                <Select
                  value={emailForm.provider}
                  onChange={(e) => setEmailForm({ ...emailForm, provider: e.target.value as EmailProvider })}
                >
                  {(Object.keys(PROVIDER_LABEL) as EmailProvider[]).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
                  ))}
                </Select>
              </Field>
              <Field
                label="API key"
                hint={
                  isSmtp ? "ไม่จำเป็น — SMTP ใช้ user/pass จาก .env"
                  : isDisabled ? "ไม่จำเป็น — โหมดปิดส่ง"
                  : email.api_key_set
                    ? "ตั้งค่าไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม หรือพิมพ์ใหม่เพื่อทับ"
                    : "ยังไม่ได้ตั้ง — พิมพ์เพื่อเพิ่ม"
                }
              >
                <Input
                  type="password"
                  className="font-mono"
                  disabled={!apiKeyRequired}
                  placeholder={
                    !apiKeyRequired ? "—" :
                    email.api_key_set ? "•••••••• (เก็บไว้แล้ว)" : "re_… / SG.… / token"
                  }
                  value={emailForm.api_key}
                  onChange={(e) => setEmailForm({ ...emailForm, api_key: e.target.value })}
                />
              </Field>
              <Field label="อีเมลผู้ส่ง" hint="ต้อง verify โดเมนกับ provider แล้ว">
                <Input
                  type="email"
                  className="font-mono"
                  placeholder="no-reply@example.com"
                  value={emailForm.from_email}
                  onChange={(e) => setEmailForm({ ...emailForm, from_email: e.target.value })}
                />
              </Field>
              <Field label="ชื่อผู้ส่ง" hint="ปรากฏใน inbox ก่อนอีเมล (เว้นว่างก็ได้)">
                <Input
                  placeholder="สถาบัน"
                  value={emailForm.from_name}
                  onChange={(e) => setEmailForm({ ...emailForm, from_name: e.target.value })}
                />
              </Field>
            </div>

            {apiKeyRequired && email.api_key_set && (
              <button
                onClick={clearEmailKey}
                disabled={emailBusy}
                className="mt-3 text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1 disabled:opacity-50"
              >
                ลบ API key ออกจาก DB (กลับไปใช้ .env)
              </button>
            )}

            {isSmtp && (
              <dl className="border-t border-rule mt-6">
                <KeyValue k="SMTP host" v={s.email.smtp_host || "—"} />
                <KeyValue k="Port" v={s.email.smtp_port} />
                <KeyValue k="TLS" v={s.email.smtp_use_tls ? "เปิด" : "ปิด"} />
                <KeyValue k="ผู้ใช้ SMTP" v={s.email.smtp_user ?? "—"} />
                <KeyValue k="รหัสผ่าน SMTP"
                  v={<StatusDot ok={s.email.smtp_password_set} labelOk="ตั้งแล้ว" labelNo="ว่าง" />} />
                <KeyValue k="ลิงก์ในอีเมล" v={s.email.frontend_url} />
              </dl>
            )}

            {emailMsg && (emailOk ? <OkNote>{emailMsg}</OkNote> : <ErrorNote>{emailMsg}</ErrorNote>)}

            <div className="mt-6 flex items-center gap-4">
              <Button onClick={saveEmail} disabled={emailBusy}>
                {emailBusy ? "กำลังบันทึก…" : "บันทึก →"}
              </Button>
              <span className="text-[11px] text-muted italic">
                เปลี่ยน provider แล้วบันทึกได้เลย ไม่ต้อง restart
              </span>
            </div>
          </>
        )}

        <div className="border-t border-rule pt-4 mt-8">
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
        hint="ผู้รับโอน + การตรวจสลิปอัตโนมัติด้วย SlipOK — แก้ได้ในหน้านี้, มีผลทันที"
      >
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <StatusDot ok={s.payments.receiver_bank_set} />
          <span className="text-[12px] text-muted">บัญชีผู้รับ</span>
          <span className="grow border-t border-rule/30 mx-1" />
          <Pill tone={s.payments.slipok_configured ? "ok" : "neutral"}>
            {s.payments.slipok_configured
              ? "SlipOK เปิด — ตรวจอัตโนมัติ"
              : "SlipOK ปิด — แอดมินรีวิวเอง"}
          </Pill>
        </div>

        {pay && (
          <>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
              <Field label="ชื่อธนาคาร" hint="เช่น ไทยพาณิชย์ (SCB)">
                <Input
                  value={payForm.receiver_bank_name}
                  onChange={(e) => setPayForm({ ...payForm, receiver_bank_name: e.target.value })}
                />
              </Field>
              <Field label="เลขบัญชี" hint="ตัวเลข ขีด หรือเว้นวรรค ก็ได้">
                <Input
                  className="font-mono"
                  value={payForm.receiver_bank_account}
                  onChange={(e) => setPayForm({ ...payForm, receiver_bank_account: e.target.value })}
                />
              </Field>
              <Field label="ชื่อบัญชี" hint="ตามที่ปรากฏในสมุดบัญชี / สลิป">
                <Input
                  value={payForm.receiver_name}
                  onChange={(e) => setPayForm({ ...payForm, receiver_name: e.target.value })}
                />
              </Field>
              <Field label="PromptPay ID" hint="เลขบัตร ปชช. ๑๓ หลัก หรือเบอร์ ๑๐ หลัก (ใส่หรือเว้นว่างก็ได้)">
                <Input
                  className="font-mono"
                  value={payForm.promptpay_id}
                  onChange={(e) => setPayForm({ ...payForm, promptpay_id: e.target.value })}
                />
                {payForm.promptpay_id.trim() && (
                  <div className="mt-3">
                    <PromptPayQR promptpayId={payForm.promptpay_id} amountBaht={null} size={160} />
                    <p className="text-[11px] text-muted mt-2 max-w-[14rem]">
                      ตัวอย่าง QR (ไม่ใส่ยอด) — ถ้าสแกนติดในแอปธนาคารแสดงว่ารูปแบบถูก
                    </p>
                  </div>
                )}
              </Field>
            </div>

            <div className="border-t border-rule mt-8 pt-6">
              <p className="text-[12px] uppercase tracking-[0.18em] text-muted mb-4">
                SlipOK API
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
                <Field label="Branch ID" hint="ดูได้จาก dashboard ของ SlipOK">
                  <Input
                    className="font-mono"
                    value={payForm.slipok_branch_id}
                    onChange={(e) => setPayForm({ ...payForm, slipok_branch_id: e.target.value })}
                  />
                </Field>
                <Field
                  label="API Key"
                  hint={pay.slipok_api_key_set
                    ? "ตั้งค่าไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม หรือพิมพ์ใหม่เพื่อทับ"
                    : "ยังไม่ได้ตั้ง — พิมพ์เพื่อเพิ่ม"}
                >
                  <Input
                    type="password"
                    className="font-mono"
                    placeholder={pay.slipok_api_key_set ? "•••••••• (เก็บไว้แล้ว)" : "x-authorization key"}
                    value={payForm.slipok_api_key}
                    onChange={(e) => setPayForm({ ...payForm, slipok_api_key: e.target.value })}
                  />
                </Field>
              </div>
              {pay.slipok_api_key_set && (
                <button
                  onClick={clearSlipokKey}
                  disabled={payBusy}
                  className="mt-3 text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1 disabled:opacity-50"
                >
                  ลบคีย์ออกจาก DB (กลับไปใช้ .env)
                </button>
              )}
            </div>

            {payMsg && (payOk ? <OkNote>{payMsg}</OkNote> : <ErrorNote>{payMsg}</ErrorNote>)}

            <div className="mt-6 flex items-center gap-4">
              <Button onClick={savePay} disabled={payBusy}>
                {payBusy ? "กำลังบันทึก…" : "บันทึก →"}
              </Button>
              <span className="text-[11px] text-muted italic">
                ค่าที่เป็น <span className="text-ink">ตัวเข้ม</span> คือค่าที่ override .env
                ในตาราง DB; เคลียร์ช่องเป็นว่างแล้วกดบันทึก = ใช้ .env แทน
              </span>
            </div>
          </>
        )}
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
