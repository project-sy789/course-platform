"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

type Course = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
};

export default function HomePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Course[]>("/api/v1/courses")
      .then(setCourses)
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-8">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Courses</h1>
        <Link href="/login" className="text-sm underline opacity-80">Login</Link>
      </header>
      {loading ? (
        <p className="opacity-60">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="opacity-60">No courses yet.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <li key={c.id} className="rounded-xl border border-neutral-800 p-4 hover:border-neutral-600 transition">
              <Link href={`/courses/${c.slug}`}>
                <h2 className="font-medium mb-1">{c.title}</h2>
                {c.description && <p className="text-sm opacity-70">{c.description}</p>}
                <p className="text-xs opacity-50 mt-2">
                  {c.price_cents === 0 ? "Free" : `$${(c.price_cents / 100).toFixed(2)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
