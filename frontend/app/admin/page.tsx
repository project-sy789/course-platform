"use client";
import { useEffect, useState } from "react";
import { adminApi, type Stats } from "@/lib/admin";

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "warn" ? "border-red-700 bg-red-950/30" : "border-neutral-800"}`}>
      <p className="text-xs uppercase tracking-wide opacity-60">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-400">Error: {error}</p>;
  if (!stats) return <p className="opacity-60">Loading…</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Courses" value={stats.courses} />
        <StatCard label="Lessons" value={stats.lessons} />
        <StatCard label="Enrollments" value={stats.enrollments} />
        <StatCard label="Key grants (24h)" value={stats.key_grants_24h} />
        <StatCard
          label="Key denials (24h)"
          value={stats.key_denials_24h}
          tone={stats.key_denials_24h > 0 ? "warn" : undefined}
        />
      </div>
      <p className="mt-6 text-xs opacity-60">
        High denial counts can signal credential stuffing or shared session-token replay attempts.
        Drill into Access logs to investigate.
      </p>
    </div>
  );
}
