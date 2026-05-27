"use client";
// Installs the mock fetch interceptor on first client mount. Active when
// NEXT_PUBLIC_API_BASE is unset OR NEXT_PUBLIC_MOCK=1. Renders nothing.

import { useEffect, useState } from "react";
import { installMockFetch, resetMockState } from "@/lib/mock-backend";

function isMockEnabled(): boolean {
	const flag = process.env.NEXT_PUBLIC_MOCK;
	const base = process.env.NEXT_PUBLIC_API_BASE;
	if (flag === "1" || flag === "true") return true;
	if (!base) return true; // no real backend wired — safest default for demos
	return false;
}

export default function MockBackend() {
	const [shown, setShown] = useState(true);

	useEffect(() => {
		if (!isMockEnabled()) return;
		installMockFetch();
	}, []);

	if (!isMockEnabled()) return null;

	return (
		<div
			className={
				"fixed bottom-4 right-4 z-50 max-w-xs " +
				(shown ? "" : "pointer-events-none opacity-0")
			}
		>
			<div className="border border-ink bg-paper shadow-[4px_4px_0_0_rgba(28,24,20,0.18)]">
				<div className="flex items-center justify-between gap-2 border-b border-rule px-3 py-1.5">
					<span className="text-[10px] uppercase tracking-[0.22em] text-oxblood font-mono">
						โหมดตัวอย่าง · MOCK
					</span>
					<button
						onClick={() => setShown(false)}
						aria-label="ปิด"
						className="text-[14px] leading-none text-muted hover:text-ink"
					>
						×
					</button>
				</div>
				<div className="px-3 py-3 text-[12px] leading-relaxed">
					<p className="font-display text-[13px] mb-2">
						ระบบกำลังใช้ข้อมูลจำลอง — ไม่มี backend จริง
					</p>
					<p className="text-muted mb-2">
						ล็อกอินด้วยบัญชีตัวอย่างเพื่อดูหลังบ้าน:
					</p>
					<dl className="font-mono text-[11px] space-y-1 mb-3">
						<div>
							<dt className="inline text-muted">admin · </dt>
							<dd className="inline text-ink">admin@example.com</dd>
						</div>
						<div>
							<dt className="inline text-muted">รหัสผ่าน · </dt>
							<dd className="inline text-ink">admin1234</dd>
						</div>
					</dl>
					<button
						onClick={() => {
							resetMockState();
							window.location.reload();
						}}
						className="text-[11px] uppercase tracking-[0.18em] underline underline-offset-4 decoration-1 text-muted hover:text-ink"
					>
						รีเซ็ตข้อมูลจำลอง
					</button>
				</div>
			</div>
		</div>
	);
}
