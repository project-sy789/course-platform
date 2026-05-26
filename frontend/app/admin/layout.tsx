"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";

const NAV = [
  { href: "/admin", label: "แดชบอร์ด" },
  { href: "/admin/courses", label: "คอร์ส" },
  { href: "/admin/upload", label: "อัปโหลดวิดีโอ" },
  { href: "/admin/users", label: "ผู้ใช้" },
  { href: "/admin/slip-uploads", label: "ตรวจสลิป" },
  { href: "/admin/logs", label: "บันทึกการเข้าถึง" },
  { href: "/admin/settings", label: "ตั้งค่า" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiFetch<{ id: string; email: string }>("/api/v1/auth/me")
      .then(async (me) => {
        // Probe an admin-only endpoint to confirm role.
        try {
          await apiFetch("/api/v1/admin/stats");
          setReady(true);
        } catch (e: any) {
          if (e instanceof ApiError && e.status === 403) {
            router.replace("/");
          } else {
            throw e;
          }
        }
      })
      .catch((e: ApiError) => {
        if (e.status === 401) router.replace("/login");
      });
  }, [router]);

  if (!ready) return <div className="p-8 opacity-60">กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ…</div>;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-neutral-900 border-r border-neutral-800 p-4">
        <h2 className="font-semibold mb-4">ผู้ดูแลระบบ</h2>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-3 py-2 rounded text-sm ${
                pathname === n.href ? "bg-neutral-700" : "hover:bg-neutral-800"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/" className="block mt-6 text-xs underline opacity-60">← กลับสู่หน้าเว็บ</Link>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
