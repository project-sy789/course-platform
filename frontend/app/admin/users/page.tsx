"use client";
import { useEffect, useState } from "react";
import { adminApi, type AdminUser } from "@/lib/admin";
import { formatThaiDate } from "@/lib/format";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [grant, setGrant] = useState({ user_email: "", course_slug: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.users().then(setUsers).catch((e) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setError(null);
    try {
      const r = await adminApi.grantEnrollment(grant.user_email, grant.course_slug);
      setMsg(`${r.status}: ${r.id}`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">ผู้ใช้และการลงทะเบียน</h1>

      <form onSubmit={submit} className="rounded-xl border border-neutral-800 p-4 mb-8 grid gap-3 max-w-xl">
        <h2 className="font-medium">เพิ่มสิทธิ์เรียนให้ผู้ใช้</h2>
        <input
          required type="email" placeholder="อีเมลผู้ใช้" value={grant.user_email}
          onChange={(e) => setGrant({ ...grant, user_email: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <input
          required placeholder="slug ของคอร์ส" value={grant.course_slug}
          onChange={(e) => setGrant({ ...grant, course_slug: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="rounded bg-white text-black font-medium py-2">เปิดสิทธิ์</button>
      </form>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900">
            <tr className="text-left">
              <th className="p-3">อีเมล</th>
              <th className="p-3">บทบาท</th>
              <th className="p-3">สถานะ</th>
              <th className="p-3">วันที่สมัคร</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-neutral-800">
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  {u.is_admin ? <span className="text-yellow-400">ผู้ดูแล</span> : "ผู้ใช้"}
                </td>
                <td className="p-3">
                  {u.is_active ? "ใช้งานอยู่" : <span className="text-red-400">ระงับ</span>}
                </td>
                <td className="p-3 opacity-60">{formatThaiDate(u.created_at)}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} className="p-3 opacity-50 text-center">ยังไม่มีผู้ใช้</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
