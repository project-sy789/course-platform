"use client";
// Sticky bottom bar that nudges the user back to wherever they paused.
// Hidden when there's nothing to resume (logged-out / no in-progress lesson)
// and dismissable per session — we don't want to hector the same user every
// page load if they're deliberately browsing elsewhere.

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";

type Resume = {
	course_slug: string;
	course_title: string;
	lesson_id: string;
	lesson_title: string;
	lesson_position: number;
	watched_pct: number;
	updated_at: string;
};

const DISMISS_KEY = "ondemand.resume.dismissed.v1";

function toThaiNum(s: string | number): string {
	const t = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
	return String(s).replace(/\d/g, (d) => t[Number(d)]!);
}

export default function ResumeBar() {
	const [data, setData] = useState<Resume | null>(null);
	const [dismissed, setDismissed] = useState(true); // start hidden until we know

	useEffect(() => {
		// sessionStorage so the dismissal evaporates on a fresh tab/window —
		// localStorage would be too sticky for a "soft" prompt.
		try {
			setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
		} catch { /* private mode */ }
		apiFetch<Resume | null>("/api/v1/account/resume")
			.then(setData)
			.catch((e: ApiError) => {
				// 401 = guest. silently no-op; bar simply never appears.
				if (e.status !== 401) setData(null);
			});
	}, []);

	if (!data || dismissed) return null;

	const dismiss = () => {
		try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
		setDismissed(true);
	};

	return (
		<div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 backdrop-blur-sm">
			<div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4 flex-wrap">
				<div className="text-[11px] uppercase tracking-[0.22em] text-oxblood">
					ค้างไว้
				</div>
				<div className="grow min-w-[14rem]">
					<p className="text-[14px] font-display leading-tight">
						บทที่ {toThaiNum(data.lesson_position)} · {data.lesson_title}
					</p>
					<p className="text-[12px] text-muted leading-tight mt-0.5">
						จาก “{data.course_title}” · ดูแล้ว {toThaiNum(data.watched_pct)}%
					</p>
				</div>
				<Link
					href={`/courses/${data.course_slug}/lessons/${data.lesson_id}`}
					className="px-4 py-2 text-[12px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition"
				>
					เรียนต่อ →
				</Link>
				<button
					onClick={dismiss}
					aria-label="ปิดแถบเรียนต่อ"
					className="text-[14px] text-muted hover:text-ink transition-colors px-1"
				>
					×
				</button>
			</div>
		</div>
	);
}
