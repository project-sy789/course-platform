"use client";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB, formatThaiDateTime } from "@/lib/format";
import {
  Button, ErrorNote, Page, PageTitle, Pill,
} from "@/components/ui";

type Slip = {
  id: string;
  user_email: string | null;
  amount_baht: number;
  status: string;
  target: { type: string; title: string; slug?: string } | null;
  slip_ref: string | null;
  verify_response: string | null;
  image_url: string;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

const FILTERS = [
  { key: "pending", label: "รอตรวจสอบ" },
  { key: "auto_approved", label: "อนุมัติอัตโนมัติ" },
  { key: "admin_approved", label: "อนุมัติแล้ว" },
  { key: "rejected", label: "ปฏิเสธ" },
  { key: "all", label: "ทั้งหมด" },
];

function statusPill(s: string) {
  if (s === "pending") return <Pill tone="warn">รอตรวจ</Pill>;
  if (s.includes("approved")) return <Pill tone="ok">อนุมัติ</Pill>;
  return <Pill tone="danger">ปฏิเสธ</Pill>;
}

export default function AdminSlipsPage() {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState<Slip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  function load() {
    setError(null);
    apiFetch<Slip[]>(`/api/v1/admin/slip-uploads?status_filter=${filter}`)
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }
  useEffect(load, [filter]);

  async function review(id: string, action: "approve" | "reject") {
    setActing(id);
    try {
      const note = action === "reject"
        ? window.prompt("เหตุผลที่ปฏิเสธ (ผู้ใช้จะเห็นในประวัติคำสั่งซื้อ)") ?? ""
        : "";
      await apiFetch(`/api/v1/admin/slip-uploads/${id}/${action}`, {
        method: "POST", body: JSON.stringify({ note }),
      });
      load();
    } catch (e: any) {
      setError(e?.message ?? "ดำเนินการไม่สำเร็จ");
    } finally { setActing(null); }
  }

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — งานการเงิน">
        ตรวจสอบสลิปการโอน
      </PageTitle>

      <nav className="flex flex-wrap gap-x-6 gap-y-2 mb-8 border-y border-rule py-3">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key} onClick={() => setFilter(f.key)}
              className={
                "text-[13px] py-1 transition border-b-2 " +
                (active
                  ? "border-oxblood text-oxblood font-medium"
                  : "border-transparent text-ink/80 hover:text-ink")
              }
            >
              {f.label}
            </button>
          );
        })}
      </nav>

      <ErrorNote>{error}</ErrorNote>

      {rows.length === 0 ? (
        <p className="text-muted italic py-8">ไม่มีรายการในหมวดนี้</p>
      ) : (
        <ol className="border-t border-rule">
          {rows.map((s, i) => (
            <li key={s.id} className="border-b border-rule py-6 grid grid-cols-[3rem_8rem_1fr] gap-6">
              <span className="font-mono text-muted text-[12px] tabular-nums pt-1">
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <a href={s.image_url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.image_url} alt="slip"
                  className="w-full h-40 object-cover border border-rule"
                />
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted mt-1 block">
                  คลิกเพื่อขยาย
                </span>
              </a>
              <div className="min-w-0 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[18px] truncate">
                    {s.user_email ?? "— (ผู้ใช้ถูกลบ)"}
                  </p>
                  <p className="font-mono tabular-nums text-[18px] whitespace-nowrap">
                    {formatTHB(s.amount_baht)}
                  </p>
                </div>
                {s.target && (
                  <p className="text-[13px] text-muted">
                    {s.target.type === "course" ? "คอร์ส" : "บทเรียน"}: {s.target.title}
                  </p>
                )}
                <p className="text-[12px] text-muted font-mono">
                  ยื่นเมื่อ {formatThaiDateTime(s.created_at)}
                  {s.slip_ref && <> · ref {s.slip_ref}</>}
                </p>
                <div className="flex items-center gap-3 pt-1">
                  {statusPill(s.status)}
                  {s.review_note && (
                    <span className="text-[12px] text-muted italic">
                      {s.review_note}
                    </span>
                  )}
                </div>
                {s.status === "pending" && (
                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={() => review(s.id, "approve")}
                      disabled={acting === s.id}
                    >
                      อนุมัติ + เปิดสิทธิ์
                    </Button>
                    <Button tone="ghost"
                      onClick={() => review(s.id, "reject")}
                      disabled={acting === s.id}
                    >
                      ปฏิเสธ
                    </Button>
                  </div>
                )}
                {s.verify_response && (
                  <details className="text-[12px] text-muted pt-1">
                    <summary className="cursor-pointer underline underline-offset-4 decoration-1">
                      ผลตรวจ SlipOK
                    </summary>
                    <pre className="whitespace-pre-wrap break-words mt-2 font-mono text-[11px] bg-cream/40 p-3 border-l-2 border-muted">
                      {s.verify_response}
                    </pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}
