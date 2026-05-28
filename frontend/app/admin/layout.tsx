"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";

type Me = { id: string; email: string; is_admin?: boolean };

const NAV = [
  { href: "/admin", label: "แดชบอร์ด" },
  { href: "/admin/courses", label: "คอร์ส" },
  { href: "/admin/upload", label: "อัปโหลดวิดีโอ" },
  { href: "/admin/users", label: "ผู้ใช้" },
  { href: "/admin/slip-uploads", label: "ตรวจสลิป" },
  { href: "/admin/coupons", label: "คูปอง" },
  { href: "/admin/logs", label: "บันทึกคีย์" },
  { href: "/admin/video-health", label: "สุขภาพวิดีโอ" },
  { href: "/admin/audit", label: "บันทึกแอดมิน" },
  { href: "/admin/broadcast", label: "ส่งเมล" },
  { href: "/admin/settings", label: "ตั้งค่า" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch<Me>("/api/v1/auth/me")
      .then(async (m) => {
        setMe(m);
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

  async function logout() {
    try {
      await apiFetch("/api/v1/auth/logout-all", { method: "POST" });
    } catch { /* ignore */ }
    router.push("/");
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-cream/30 flex items-center justify-center">
        <p className="font-display italic text-muted">
          กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream/30">
      {/* Admin-only shell — distinct from the public masthead. The wordmark
          shrinks; an oxblood block + "กองบรรณาธิการ" badge takes its place;
          the tab nav lives in the same band so /admin reads as one
          coherent backstage UI rather than a public page with a banner. */}
      <header className="bg-paper border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 pt-4 pb-3 flex items-center justify-between gap-6">
          <div className="flex items-baseline gap-4">
            <Link href="/" className="font-display font-semibold text-[1.5rem] leading-none tracking-[-0.02em]">
              สถาบัน<span className="italic font-normal text-oxblood">.</span>
            </Link>
            <span className="inline-block bg-ink text-paper px-2 py-[3px] text-[10px] uppercase tracking-[0.22em] font-mono">
              กองบรรณาธิการ
            </span>
          </div>
          <div className="flex items-center gap-x-5 text-[12px]">
            {me && (
              <span className="font-mono text-muted truncate max-w-[16rem] hidden sm:inline">
                {me.email}
              </span>
            )}
            <Link
              href="/"
              className="text-muted hover:text-ink underline underline-offset-4 decoration-1"
            >
              ดูหน้าผู้อ่าน →
            </Link>
            <button
              onClick={logout}
              className="text-muted hover:text-ink underline underline-offset-4 decoration-1"
            >
              ออก
            </button>
          </div>
        </div>
        <nav className="border-t border-rule/60">
          <div className="max-w-6xl mx-auto px-6 flex flex-wrap gap-x-8 gap-y-0 text-[13px]">
            {NAV.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={
                    "py-3 transition border-b-2 -mb-[2px] " +
                    (active
                      ? "border-oxblood text-oxblood font-medium"
                      : "border-transparent text-ink/80 hover:text-ink hover:border-ink/30")
                  }
                >
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <div className="pb-16">{children}</div>

      <footer className="border-t border-rule/60 bg-paper">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-muted font-mono">
          <span>กองบรรณาธิการ · เฉพาะภายใน</span>
          <span>{new Date().getFullYear() + 543}</span>
        </div>
      </footer>
    </div>
  );
}
