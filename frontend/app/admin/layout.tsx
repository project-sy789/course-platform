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
  { href: "/admin/logs", label: "บันทึกคีย์" },
  { href: "/admin/settings", label: "ตั้งค่า" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiFetch<{ id: string; email: string }>("/api/v1/auth/me")
      .then(async () => {
        try {
          await apiFetch("/api/v1/admin/stats");
          setReady(true);
        } catch (e: any) {
          if (e instanceof ApiError && e.status === 403) router.replace("/");
          else throw e;
        }
      })
      .catch((e: ApiError) => {
        if (e.status === 401) router.replace("/login");
      });
  }, [router]);

  if (!ready) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-16">
        <p className="font-display italic text-muted">
          กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ…
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Admin sub-masthead — sits below the public masthead from RootLayout. */}
      <div className="border-y border-rule bg-cream/40">
        <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted">
          <span>กองบรรณาธิการ — เฉพาะผู้ดูแลระบบ</span>
          <Link href="/" className="text-muted hover:text-ink underline underline-offset-4 decoration-1">
            ออกจากกองบ.ก. →
          </Link>
        </div>
        <nav className="max-w-6xl mx-auto px-6 pb-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  "py-1 transition " +
                  (active
                    ? "text-oxblood font-medium border-b-2 border-oxblood"
                    : "text-ink/80 hover:text-ink border-b-2 border-transparent")
                }
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </>
  );
}
