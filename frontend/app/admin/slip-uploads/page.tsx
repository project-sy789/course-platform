"use client";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { formatTHB, formatThaiDateTime } from "@/lib/format";

type Slip = {
  id: string;
  user_email: string | null;
  amount_cents: number;
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
        ? window.prompt("เหตุผลในการปฏิเสธ (เห็นในประวัติของลูกค้า)") ?? ""
        : "";
      await apiFetch(`/api/v1/admin/slip-uploads/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      load();
    } catch (e: any) {
      setError(e?.message ?? "ดำเนินการไม่สำเร็จ");
    } finally {
      setActing(null);
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">ตรวจสอบสลิปการโอน</h1>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key} onClick={() => setFilter(f.key)}
            className={`text-sm rounded-md px-3 py-1.5 border ${
              filter === f.key
                ? "bg-white text-black border-white"
                : "border-neutral-700 hover:bg-neutral-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <ul className="space-y-3">
        {rows.length === 0 && (
          <p className="opacity-50 text-sm">ไม่มีรายการ</p>
        )}
        {rows.map((s) => (
          <li key={s.id} className="rounded-xl border border-neutral-800 p-4 flex gap-4">
            <a href={s.image_url} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image_url} alt="slip" className="w-32 h-40 object-cover rounded border border-neutral-800" />
            </a>
            <div className="flex-1 min-w-0 text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-medium truncate">{s.user_email ?? "(ผู้ใช้ถูกลบ)"}</p>
                  <p className="opacity-60 text-xs">
                    {s.target ? `${s.target.type === "course" ? "คอร์ส" : "บทเรียน"}: ${s.target.title}` : "—"}
                  </p>
                </div>
                <p className="font-semibold whitespace-nowrap">{formatTHB(s.amount_cents)}</p>
              </div>
              <p className="opacity-60 text-xs">
                ยื่นเมื่อ {formatThaiDateTime(s.created_at)}
                {s.slip_ref && <> · อ้างอิงสลิป {s.slip_ref}</>}
              </p>
              <p className="text-xs">
                <span className={`inline-block rounded px-2 py-0.5 mr-2 ${
                  s.status === "pending" ? "bg-yellow-900/40 text-yellow-300" :
                  s.status.includes("approved") ? "bg-green-900/40 text-green-300" :
                  "bg-red-900/40 text-red-300"
                }`}>{s.status}</span>
                {s.review_note && <span className="opacity-60">{s.review_note}</span>}
              </p>
              {s.status === "pending" && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => review(s.id, "approve")}
                    disabled={acting === s.id}
                    className="text-sm rounded-md bg-white text-black px-3 py-1.5 disabled:opacity-50"
                  >
                    อนุมัติ + เปิดสิทธิ์
                  </button>
                  <button
                    onClick={() => review(s.id, "reject")}
                    disabled={acting === s.id}
                    className="text-sm rounded-md border border-red-700 text-red-300 px-3 py-1.5 disabled:opacity-50"
                  >
                    ปฏิเสธ
                  </button>
                </div>
              )}
              {s.verify_response && (
                <details className="text-xs opacity-60">
                  <summary className="cursor-pointer">ผลตรวจ SlipOK</summary>
                  <pre className="whitespace-pre-wrap break-words mt-1">{s.verify_response}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
