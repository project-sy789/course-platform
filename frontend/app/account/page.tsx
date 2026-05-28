"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB, formatThaiDate } from "@/lib/format";
import {
  Button, ErrorNote, Field, Hairline, Input, Loading, OkNote, Page,
  PageTitle, Pill, Section, Textarea,
} from "@/components/ui";

type Me = { id: string; email: string; email_verified: boolean };
type TaxInfo = {
  tax_name: string | null;
  tax_id: string | null;
  tax_address: string | null;
  tax_branch: string | null;
};
type PaymentRow = {
  id: string;
  amount_baht: number;
  subtotal_baht: number | null;
  vat_baht: number | null;
  currency: string;
  status: string;
  invoice_number: string | null;
  created_at: string;
};

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [tax, setTax] = useState<TaxInfo>({
    tax_name: "", tax_id: "", tax_address: "", tax_branch: "",
  });
  const [taxSaved, setTaxSaved] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  useEffect(() => {
    apiFetch<Me>("/api/v1/auth/me")
      .then(setMe)
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/login");
        else setError(e.message);
      });
    apiFetch<TaxInfo>("/api/v1/account/tax-info").then((t) =>
      setTax({
        tax_name: t.tax_name ?? "", tax_id: t.tax_id ?? "",
        tax_address: t.tax_address ?? "", tax_branch: t.tax_branch ?? "",
      })
    ).catch(() => {});
    apiFetch<PaymentRow[]>("/api/v1/payments").then(setPayments).catch(() => setPayments([]));
  }, [router]);

  async function saveTax(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setTaxSaved(false);
    try {
      await apiFetch("/api/v1/account/tax-info", {
        method: "PUT", body: JSON.stringify(tax),
      });
      setTaxSaved(true);
    } catch (e: any) { setError(e?.message ?? "save failed"); }
    finally { setBusy(false); }
  }

  function downloadInvoice(p: PaymentRow) {
    const url = `${process.env.NEXT_PUBLIC_API_BASE}/api/v1/payments/${p.id}/invoice`;
    window.open(url, "_blank");
  }

  async function exportData() {
    setBusy(true); setError(null);
    try {
      const data = await apiFetch<unknown>("/api/v1/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `account-${me?.email ?? "data"}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e?.message ?? "export failed"); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (!me) return;
    if (!confirm("การลบบัญชีจะล้างข้อมูลส่วนตัวและออกจากระบบทุกอุปกรณ์ ดำเนินการต่อ?")) return;
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/v1/account/delete", {
        method: "POST", body: JSON.stringify({ confirm_email: confirmEmail }),
      });
      router.push("/login");
    } catch (e: any) { setError(e?.message ?? "delete failed"); setBusy(false); }
  }

  async function logoutAll() {
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/v1/auth/logout-all", { method: "POST" });
      router.push("/login");
    } catch (e: any) { setError(e?.message ?? "failed"); setBusy(false); }
  }

  if (!me) return <Page><Loading /></Page>;

  return (
    <Page width="column">
      <PageTitle kicker="ส่วนของผู้อ่าน">บัญชีของฉัน</PageTitle>
      <ErrorNote>{error}</ErrorNote>

      <Section
        title="โปรไฟล์"
        hint="อีเมลที่ใช้สมัครและสถานะการยืนยันตัวตน"
      >
        <p className="font-display text-[20px] leading-snug">{me.email}</p>
        <div className="mt-3">
          {me.email_verified
            ? <Pill tone="ok">ยืนยันอีเมลแล้ว</Pill>
            : <Pill tone="warn">ยังไม่ได้ยืนยันอีเมล</Pill>}
        </div>
      </Section>

      <Section
        title="ใบกำกับภาษี"
        hint="ข้อมูลที่จะปรากฏในใบกำกับเมื่อคุณซื้อคอร์ส ระบบจะใช้ข้อมูลล่าสุดที่บันทึกไว้"
      >
        <form onSubmit={saveTax} className="space-y-5">
          <Field label="ชื่อ-นามสกุล หรือนิติบุคคล">
            <Input value={tax.tax_name ?? ""}
              onChange={(e) => setTax({ ...tax, tax_name: e.target.value })} />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี" hint="๑๓ หลัก">
            <Input inputMode="numeric" maxLength={13} className="font-mono"
              value={tax.tax_id ?? ""}
              onChange={(e) => setTax({ ...tax, tax_id: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="ที่อยู่">
            <Textarea rows={3} value={tax.tax_address ?? ""}
              onChange={(e) => setTax({ ...tax, tax_address: e.target.value })} />
          </Field>
          <Field label="สาขา">
            <Input placeholder="สำนักงานใหญ่" value={tax.tax_branch ?? ""}
              onChange={(e) => setTax({ ...tax, tax_branch: e.target.value })} />
          </Field>
          {taxSaved && <OkNote>บันทึกแล้ว</OkNote>}
          <Button disabled={busy}>{busy ? "…" : "บันทึก"}</Button>
        </form>
      </Section>

      <Section
        title="ประวัติการชำระเงิน"
        hint="รายการที่ผ่านมาและใบกำกับภาษีย้อนหลัง"
      >
        {payments.length === 0 ? (
          <p className="text-muted italic">ยังไม่มีรายการ</p>
        ) : (
          <ol className="border-t border-rule">
            {payments.map((p) => (
              <li key={p.id} className="border-b border-rule py-4 flex items-baseline gap-6">
                <div className="grow">
                  <p className="font-display text-[16px]">
                    {formatThaiDate(p.created_at)} —{" "}
                    <span className="font-mono">{formatTHB(p.amount_baht)}</span>
                  </p>
                  <p className="text-[12px] text-muted mt-1 font-mono">
                    {p.status}
                    {p.invoice_number && <> · เลขที่ {p.invoice_number}</>}
                  </p>
                </div>
                {p.status === "paid" && p.invoice_number && (
                  <Button tone="ghost" onClick={() => downloadInvoice(p)}>
                    ใบกำกับภาษี
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        title="อุปกรณ์และเซสชัน"
        hint="จัดการอุปกรณ์ที่เคยเข้าสู่ระบบ หากเห็นรายการที่ไม่รู้จักให้เพิกถอนทันที"
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/account/devices"
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition">
            จัดการอุปกรณ์ →
          </Link>
          <Button tone="ghost" onClick={logoutAll} disabled={busy}>
            ออกจากระบบทุกที่
          </Button>
        </div>
      </Section>

      <Section
        title="ดาวน์โหลดข้อมูลของฉัน"
        hint="สำเนาข้อมูลทั้งหมดในรูปแบบ JSON ตามสิทธิ์เจ้าของข้อมูล"
      >
        <Button tone="ghost" onClick={exportData} disabled={busy}>
          ดาวน์โหลด JSON
        </Button>
      </Section>

      <Section
        tone="danger"
        title="ลบบัญชี"
        hint="ล้างข้อมูลส่วนตัวและสิทธิ์เรียนทั้งหมด ส่วนข้อมูลการเงินจะเก็บไว้ตามกฎหมายบัญชี"
      >
        <p className="text-[13px] text-muted leading-relaxed mb-4">
          พิมพ์อีเมล <span className="font-mono text-ink">{me.email}</span> เพื่อยืนยัน
        </p>
        <Field label="ยืนยันอีเมล">
          <Input type="email" value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={me.email} />
        </Field>
        <div className="mt-4">
          <Button tone="danger" onClick={deleteAccount}
            disabled={busy || confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()}>
            ลบบัญชีถาวร
          </Button>
        </div>
      </Section>

      <Hairline />
    </Page>
  );
}
