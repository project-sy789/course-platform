"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { adminApi } from "@/lib/admin";

type Course = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
};

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({ slug: "", title: "", description: "", price_cents: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    apiFetch<Course[]>("/api/v1/courses").then(setCourses).catch(() => setCourses([]));

  useEffect(() => { reload(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await adminApi.createCourse({
        slug: form.slug,
        title: form.title,
        description: form.description || undefined,
        price_cents: Number(form.price_cents) || 0,
      });
      setForm({ slug: "", title: "", description: "", price_cents: 0 });
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Courses</h1>

      <form onSubmit={submit} className="rounded-xl border border-neutral-800 p-4 mb-8 grid gap-3 max-w-xl">
        <h2 className="font-medium">Create course</h2>
        <input
          required placeholder="slug (e.g. intro)" value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <input
          required placeholder="title" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <textarea
          placeholder="description (optional)" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        <input
          type="number" min={0} placeholder="price (cents)" value={form.price_cents}
          onChange={(e) => setForm({ ...form, price_cents: Number(e.target.value) })}
          className="rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="rounded bg-white text-black font-medium py-2 disabled:opacity-50">
          {busy ? "…" : "Create"}
        </button>
      </form>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900">
            <tr className="text-left">
              <th className="p-3">Slug</th>
              <th className="p-3">Title</th>
              <th className="p-3">Price</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id} className="border-t border-neutral-800">
                <td className="p-3 font-mono">{c.slug}</td>
                <td className="p-3">{c.title}</td>
                <td className="p-3">{c.price_cents === 0 ? "Free" : `$${(c.price_cents / 100).toFixed(2)}`}</td>
              </tr>
            ))}
            {courses.length === 0 && (
              <tr><td colSpan={3} className="p-3 opacity-50 text-center">No courses yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
