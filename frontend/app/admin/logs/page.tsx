"use client";
import { useEffect, useState } from "react";
import { adminApi, type LogRow } from "@/lib/admin";
import { formatThaiDateTime } from "@/lib/format";
import {
  Button, ErrorNote, Input, Page, PageTitle, Pill, Select,
  TD, TH, THead, TR, Table,
} from "@/components/ui";

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<{
    granted?: "true" | "false" | "";
    user_id: string; video_id: string;
  }>({ granted: "", user_id: "", video_id: "" });
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    adminApi.logs({
      granted: filter.granted === "" ? undefined : filter.granted === "true",
      user_id: filter.user_id || undefined,
      video_id: filter.video_id || undefined,
      limit: 200,
    }).then(setLogs).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ — งานตรวจสอบ">
        บันทึกการเข้าถึงคีย์
      </PageTitle>

      <div className="grid sm:grid-cols-4 gap-4 mb-8">
        <Select
          value={filter.granted}
          onChange={(e) => setFilter({ ...filter, granted: e.target.value as any })}
        >
          <option value="">ทั้งหมด</option>
          <option value="true">อนุมัติเท่านั้น</option>
          <option value="false">ปฏิเสธเท่านั้น</option>
        </Select>
        <Input placeholder="user_id" value={filter.user_id} className="font-mono"
          onChange={(e) => setFilter({ ...filter, user_id: e.target.value })} />
        <Input placeholder="video_id" value={filter.video_id} className="font-mono"
          onChange={(e) => setFilter({ ...filter, video_id: e.target.value })} />
        <Button onClick={load}>ค้นหา</Button>
      </div>

      <ErrorNote>{error}</ErrorNote>

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TH>เวลา</TH>
            <TH>ผล</TH>
            <TH>ผู้ใช้</TH>
            <TH>วิดีโอ</TH>
            <TH>IP</TH>
            <TH>เหตุผล</TH>
            <TH>UA</TH>
          </THead>
          <tbody>
            {logs.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono text-[11px] text-muted whitespace-nowrap">
                  {formatThaiDateTime(r.created_at)}
                </TD>
                <TD>
                  {r.granted
                    ? <Pill tone="ok">อนุมัติ</Pill>
                    : <Pill tone="warn">ปฏิเสธ</Pill>}
                </TD>
                <TD className="font-mono text-[11px]">
                  {r.user_id?.slice(0, 8) ?? "—"}
                </TD>
                <TD className="font-mono text-[11px]">
                  {r.video_id.slice(0, 8)}
                </TD>
                <TD className="font-mono text-[11px]">{r.ip}</TD>
                <TD className="text-[12px]">{r.reason}</TD>
                <TD className="text-[11px] text-muted truncate max-w-[14rem]"
                    title={r.user_agent ?? ""}>
                  {r.user_agent ?? "—"}
                </TD>
              </TR>
            ))}
            {logs.length === 0 && (
              <TR>
                <TD colSpan={7} className="text-muted italic text-center">
                  ไม่มีรายการ
                </TD>
              </TR>
            )}
          </tbody>
        </Table>
      </div>

      <p className="mt-6 text-[12px] italic text-muted leading-relaxed max-w-prose">
        จุดที่ควรเฝ้าระวัง — user_id เดียวได้รับคีย์จาก IP จำนวนมาก (สัญญาณการใช้บัญชีร่วมกัน)
        การปฏิเสธจำนวนมากจาก IP เดียว (อาจเป็นสคริปต์ดูดเนื้อหา)
        หรือการอนุมัติคีย์เพิ่มขึ้นผิดปกติของวิดีโอใดวิดีโอหนึ่งนอกเวลาทำการ
      </p>
    </Page>
  );
}
