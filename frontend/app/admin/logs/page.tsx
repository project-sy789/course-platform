"use client";
import { useEffect, useState } from "react";
import { adminApi, type LogRow } from "@/lib/admin";
import { formatThaiDateTime } from "@/lib/format";

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<{ granted?: "true" | "false" | ""; user_id: string; video_id: string }>({
    granted: "",
    user_id: "",
    video_id: "",
  });
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    adminApi
      .logs({
        granted: filter.granted === "" ? undefined : filter.granted === "true",
        user_id: filter.user_id || undefined,
        video_id: filter.video_id || undefined,
        limit: 200,
      })
      .then(setLogs)
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">บันทึกการเข้าถึงคีย์</h1>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filter.granted}
          onChange={(e) => setFilter({ ...filter, granted: e.target.value as any })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm"
        >
          <option value="">ทั้งหมด</option>
          <option value="true">อนุมัติเท่านั้น</option>
          <option value="false">ปฏิเสธเท่านั้น</option>
        </select>
        <input
          placeholder="user_id" value={filter.user_id}
          onChange={(e) => setFilter({ ...filter, user_id: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm font-mono"
        />
        <input
          placeholder="video_id" value={filter.video_id}
          onChange={(e) => setFilter({ ...filter, video_id: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm font-mono"
        />
        <button onClick={load} className="rounded bg-white text-black font-medium px-4 text-sm">
          ค้นหา
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">เกิดข้อผิดพลาด: {error}</p>}

      <div className="rounded-xl border border-neutral-800 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-900 text-left">
            <tr>
              <th className="p-2">เวลา</th>
              <th className="p-2">ผล</th>
              <th className="p-2">ผู้ใช้</th>
              <th className="p-2">วิดีโอ</th>
              <th className="p-2">IP</th>
              <th className="p-2">เหตุผล</th>
              <th className="p-2">UA</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="p-2 whitespace-nowrap opacity-70">
                  {formatThaiDateTime(r.created_at)}
                </td>
                <td className="p-2">
                  {r.granted ? (
                    <span className="text-emerald-400">อนุมัติ</span>
                  ) : (
                    <span className="text-red-400">ปฏิเสธ</span>
                  )}
                </td>
                <td className="p-2 font-mono">{r.user_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-2 font-mono">{r.video_id.slice(0, 8)}</td>
                <td className="p-2">{r.ip}</td>
                <td className="p-2">{r.reason}</td>
                <td className="p-2 truncate max-w-[16rem]" title={r.user_agent ?? ""}>
                  {r.user_agent ?? "—"}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={7} className="p-3 opacity-50 text-center">ไม่มีรายการ</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs opacity-60">
        จุดที่ควรเฝ้าระวัง: user_id เดียวได้รับคีย์จาก IP จำนวนมาก (ใช้บัญชีร่วมกัน)
        การปฏิเสธจำนวนมากจาก IP เดียว (สแครป / ใช้ token ซ้ำ)
        การเพิ่มขึ้นผิดปกติของการอนุมัติคีย์วิดีโอใดวิดีโอหนึ่งนอกเวลาทำการ
      </p>
    </div>
  );
}
