"use client";
import { useEffect, useState } from "react";
import { adminApi, type LogRow } from "@/lib/admin";

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
      <h1 className="text-xl font-semibold mb-6">Key access logs</h1>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filter.granted}
          onChange={(e) => setFilter({ ...filter, granted: e.target.value as any })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm"
        >
          <option value="">All outcomes</option>
          <option value="true">Granted only</option>
          <option value="false">Denied only</option>
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
          Apply
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">Error: {error}</p>}

      <div className="rounded-xl border border-neutral-800 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-900 text-left">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Outcome</th>
              <th className="p-2">User</th>
              <th className="p-2">Video</th>
              <th className="p-2">IP</th>
              <th className="p-2">Reason</th>
              <th className="p-2">UA</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="p-2 whitespace-nowrap opacity-70">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="p-2">
                  {r.granted ? (
                    <span className="text-emerald-400">grant</span>
                  ) : (
                    <span className="text-red-400">deny</span>
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
              <tr><td colSpan={7} className="p-3 opacity-50 text-center">No logs match filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs opacity-60">
        Patterns to watch: same user_id grants from many IPs (account sharing),
        many denials from one IP (scraping / token replay), spike of grants for one
        video_id outside normal hours.
      </p>
    </div>
  );
}
