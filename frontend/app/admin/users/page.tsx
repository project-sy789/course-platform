"use client";
import { useEffect, useState } from "react";
import { adminApi, type AdminUser } from "@/lib/admin";

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
      <h1 className="text-xl font-semibold mb-6">Users & enrollments</h1>

      <form onSubmit={submit} className="rounded-xl border border-neutral-800 p-4 mb-8 grid gap-3 max-w-xl">
        <h2 className="font-medium">Grant enrollment</h2>
        <input
          required type="email" placeholder="user email" value={grant.user_email}
          onChange={(e) => setGrant({ ...grant, user_email: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <input
          required placeholder="course slug" value={grant.course_slug}
          onChange={(e) => setGrant({ ...grant, course_slug: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="rounded bg-white text-black font-medium py-2">Grant access</button>
      </form>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900">
            <tr className="text-left">
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
              <th className="p-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-neutral-800">
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  {u.is_admin ? <span className="text-yellow-400">admin</span> : "user"}
                </td>
                <td className="p-3">
                  {u.is_active ? "active" : <span className="text-red-400">disabled</span>}
                </td>
                <td className="p-3 opacity-60">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} className="p-3 opacity-50 text-center">No users yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
