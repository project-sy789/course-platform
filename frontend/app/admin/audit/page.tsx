"use client";
import { useCallback, useEffect, useState } from "react";
import { adminApi, type AuditRow } from "@/lib/admin";
import { formatNumber, formatThaiDateTime } from "@/lib/format";
import {
  Button, ErrorNote, Input, Page, PageTitle, Pill,
  TD, TH, THead, TR, Table,
} from "@/components/ui";

export default function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [actorEmail, setActorEmail] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await adminApi.listAudit({
        actor_email: actorEmail || undefined,
        action: action || undefined,
        limit, offset,
      });
      setRows(r.rows); setTotal(r.total); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [actorEmail, action, limit, offset]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ">บันทึกการดำเนินการของแอดมิน</PageTitle>

      <section className="border-y border-rule py-4 my-4 flex flex-wrap items-end gap-3">
        <div className="grow min-w-[180px]">
          <label className="block text-[10px] uppercase tracking-[0.18em] text-muted mb-1">
            อีเมลผู้ดำเนินการ
          </label>
          <Input
            placeholder="admin@example.com"
            value={actorEmail}
            onChange={(e) => { setActorEmail(e.target.value); setOffset(0); }}
          />
        </div>
        <div className="grow min-w-[180px]">
          <label className="block text-[10px] uppercase tracking-[0.18em] text-muted mb-1">
            action (เช่น user.patch)
          </label>
          <Input
            placeholder="user.patch"
            className="font-mono"
            value={action}
            onChange={(e) => { setAction(e.target.value); setOffset(0); }}
          />
        </div>
        <Button tone="ghost" onClick={() => { setActorEmail(""); setAction(""); setOffset(0); }}>
          ล้างตัวกรอง
        </Button>
      </section>

      <ErrorNote>{error}</ErrorNote>

      <Table>
        <THead>
          <TH>เวลา</TH>
          <TH>ผู้ดำเนินการ</TH>
          <TH>action</TH>
          <TH>สรุป</TH>
          <TH>เป้าหมาย</TH>
          <TH>IP</TH>
          <TH>{""}</TH>
        </THead>
        <tbody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-mono text-[12px] text-muted whitespace-nowrap">
                {formatThaiDateTime(r.created_at)}
              </TD>
              <TD className="text-[13px]">{r.actor_email ?? <span className="text-muted italic">(ลบแล้ว)</span>}</TD>
              <TD><Pill>{r.action}</Pill></TD>
              <TD>{r.summary}</TD>
              <TD className="font-mono text-[12px] text-muted">
                {r.target_type ? `${r.target_type}${r.target_id ? `:${r.target_id.slice(0, 8)}` : ""}` : "—"}
              </TD>
              <TD className="font-mono text-[12px] text-muted">{r.ip ?? "—"}</TD>
              <TD>
                {r.detail && (
                  <button
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                    className="text-[12px] underline underline-offset-4"
                  >
                    {openId === r.id ? "ซ่อน" : "ดูรายละเอียด"}
                  </button>
                )}
              </TD>
            </TR>
          ))}
          {rows.length === 0 && (
            <TR>
              <TD colSpan={7} className="text-muted italic text-center">ยังไม่มีบันทึก</TD>
            </TR>
          )}
        </tbody>
      </Table>

      {openId && (() => {
        const r = rows.find((x) => x.id === openId);
        if (!r?.detail) return null;
        let pretty = r.detail;
        try { pretty = JSON.stringify(JSON.parse(r.detail), null, 2); } catch { /* keep raw */ }
        return (
          <pre className="mt-3 bg-ink/[0.04] border border-rule p-4 text-[12px] font-mono whitespace-pre-wrap break-all">
            {pretty}
          </pre>
        );
      })()}

      <div className="flex items-center justify-between mt-4 text-[12px] text-muted font-mono">
        <span>{formatNumber(offset + 1)}–{formatNumber(Math.min(offset + rows.length, total))} จาก {formatNumber(total)}</span>
        <span className="flex gap-2">
          <Button tone="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            ← ก่อนหน้า
          </Button>
          <Button tone="ghost" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            ถัดไป →
          </Button>
        </span>
      </div>
    </Page>
  );
}
