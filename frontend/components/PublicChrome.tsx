"use client";
// Public masthead + colophon. Hidden on /admin/* so the admin shell can own
// the chrome there. Lives outside the root layout because it needs
// usePathname() (a client hook) — the rest of the layout stays a Server
// Component.

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AccountNav from "./AccountNav";
import ResumeBar from "./ResumeBar";
import { cartCount, subscribe } from "@/lib/cart";

function CartLink() {
	const [n, setN] = useState(0);
	useEffect(() => {
		setN(cartCount());
		return subscribe((items) => setN(items.length));
	}, []);
	return (
		<Link href="/cart" className="lede flex items-baseline gap-1">
			ตะกร้า
			{n > 0 && (
				<span className="inline-block min-w-[1.4em] px-1.5 text-center text-[11px] font-mono bg-oxblood text-paper">
					{n}
				</span>
			)}
		</Link>
	);
}

function toThaiNum(s: string | number): string {
	const t = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
	return String(s).replace(/\d/g, (d) => t[Number(d)]!);
}

// Click-cycle taglines for "ราคา ๐ บาท". Editorial flourish that doubles as a
// soft-CTA — "the masthead is free, the courses are the product".
const PRICE_QUIPS = [
	"ราคา ๐ บาท",
	"เปิดสารบัญไม่เสียค่า",
	"บางคอร์สมีบทตัวอย่างฟรี",
	"ค่าเรียนเริ่ม ๒๙๙ บาท",
];

// Platform launch — used by the "ปีที่ X" header to count real elapsed time
// instead of a static "๑". Bump when the platform is rebooted / relaunched.
const PLATFORM_LAUNCH = new Date("2026-01-01T00:00:00+07:00");

function ageSinceLaunch(now: Date): { years: number; months: number; days: number } {
	const ms = now.getTime() - PLATFORM_LAUNCH.getTime();
	const days = Math.max(0, Math.floor(ms / 86_400_000));
	const months = Math.max(0, Math.floor(days / 30));
	const years = Math.max(1, Math.floor(days / 365) + 1); // 1-indexed: launch day = ปีที่ ๑
	return { years, months, days };
}

function shortThaiDate(d: Date): string {
	const months = [
		"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
		"ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
	];
	return `${toThaiNum(d.getDate())} ${months[d.getMonth()]} ${toThaiNum(d.getFullYear() + 543)}`;
}

function relativeIssue(d: Date): string {
	// Week-of-year approximation — fine for an editorial flourish, not for
	// scheduling. Counts ISO weeks from Jan 1 of the same year.
	const start = new Date(d.getFullYear(), 0, 1);
	const week = Math.ceil(((d.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
	return `วันนี้ · สัปดาห์ที่ ${toThaiNum(week)}`;
}

function Masthead() {
	const today = new Date();
	const adYear = today.getFullYear();
	const beYear = adYear + 543;
	const longDate = new Intl.DateTimeFormat("th-TH", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
		calendar: "buddhist",
	}).format(today);

	const [showAd, setShowAd] = useState(false);
	const [quipIdx, setQuipIdx] = useState(0);
	const [dateIdx, setDateIdx] = useState(0);   // 0 long · 1 short · 2 relative
	const [ageIdx, setAgeIdx] = useState(0);     // 0 ปี · 1 เดือน · 2 วัน
	const [pop, setPop] = useState(0);           // bumped each click → restarts CSS animation
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const age = ageSinceLaunch(today);
	const ageLabel = ageIdx === 0
		? `ปีที่ ${toThaiNum(age.years)}`
		: ageIdx === 1
			? `เดือนที่ ${toThaiNum(age.months)}`
			: `วันที่ ${toThaiNum(age.days)}`;

	const dateLabel = dateIdx === 0
		? toThaiNum(longDate)
		: dateIdx === 1
			? shortThaiDate(today)
			: relativeIssue(today);

	return (
		<header className="border-b border-rule">
			<div className="max-w-6xl mx-auto px-6 pt-6 pb-3 flex items-baseline justify-between text-[11px] uppercase tracking-[0.18em] text-muted">
				<span className="flex items-baseline gap-2" suppressHydrationWarning>
					<button
						type="button"
						onClick={() => setAgeIdx((i) => (i + 1) % 3)}
						title="กดเพื่อสลับ ปี / เดือน / วัน ตั้งแต่เปิดสถาบัน"
						className="hover:text-ink transition-colors cursor-pointer"
					>
						{mounted ? ageLabel : "ปีที่ ๑"}
					</button>
					<span aria-hidden>—</span>
					<button
						type="button"
						onClick={() => setShowAd((v) => !v)}
						title={showAd ? "กดเพื่อกลับเป็น พ.ศ." : "กดเพื่อสลับเป็น ค.ศ."}
						className="hover:text-ink transition-colors cursor-pointer"
					>
						เล่มที่{" "}
						<span className="font-mono">
							{showAd ? `ค.ศ. ${toThaiNum(adYear)}` : toThaiNum(beYear)}
						</span>
					</button>
				</span>
				<button
					type="button"
					onClick={() => setDateIdx((i) => (i + 1) % 3)}
					title="กดเพื่อสลับรูปแบบวันที่"
					className="hidden sm:inline hover:text-ink transition-colors cursor-pointer"
					suppressHydrationWarning
				>
					{mounted ? dateLabel : longDate}
				</button>
				<button
					type="button"
					onClick={() => setQuipIdx((i) => (i + 1) % PRICE_QUIPS.length)}
					title="กดเพื่อดูข้อความถัดไป"
					className="hover:text-ink transition-colors cursor-pointer"
				>
					{PRICE_QUIPS[quipIdx]}
				</button>
			</div>
			<div className="max-w-6xl mx-auto px-6 pb-4">
				<h1 className="font-display font-semibold leading-none tracking-[-0.03em] text-[clamp(2.6rem,7vw,5.5rem)]">
					<Link href="/">สถาบัน</Link>
					<span
						key={pop}
						role="button"
						tabIndex={0}
						aria-label="กดเล่นจุดท้ายชื่อ"
						onClick={(e) => { e.preventDefault(); setPop((n) => n + 1); }}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setPop((n) => n + 1);
							}
						}}
						className="italic font-normal text-oxblood inline-block cursor-pointer
						           origin-bottom select-none hover:scale-125 transition-transform
						           duration-300 motion-safe:animate-[wink_0.55s_cubic-bezier(0.34,1.56,0.64,1)]"
						style={pop === 0 ? { animation: "none" } : undefined}
					>
						.
					</span>
				</h1>
			</div>
			<nav className="border-t border-rule">
				<div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
					<Link href="/" className="font-medium">หน้าแรก</Link>
					<Link href="/courses" className="lede">สารบัญคอร์ส</Link>
					<Link href="/account" className="lede">บัญชีของฉัน</Link>
					<Link href="/account/devices" className="lede">อุปกรณ์ที่อนุญาต</Link>
					<CartLink />
					<span className="grow" />
					<AccountNav />
				</div>
			</nav>
		</header>
	);
}

function Colophon() {
	return (
		<footer className="border-t border-rule mt-24">
			<div className="max-w-6xl mx-auto px-6 py-10 grid sm:grid-cols-3 gap-8 text-[13px] text-muted">
				<div>
					<div className="font-display text-ink text-lg mb-1">สถาบัน</div>
					<p>
						สำนักพิมพ์การศึกษาทางไกล
						<br />
						กรุงเทพมหานคร
					</p>
				</div>
				<div>
					<div className="uppercase tracking-[0.18em] text-[11px] mb-2">ผู้อ่าน</div>
					<ul className="space-y-1">
						<li><Link href="/account" className="lede">บัญชี</Link></li>
						<li><Link href="/account/devices" className="lede">อุปกรณ์</Link></li>
						<li><Link href="/login" className="lede">เข้าสู่ระบบ</Link></li>
					</ul>
				</div>
				<div>
					<div className="uppercase tracking-[0.18em] text-[11px] mb-2">ติดต่อ</div>
					<p>support@example.com</p>
					<p className="font-mono text-[11px] mt-2 opacity-60">
						© {new Date().getFullYear() + 543} — เผยแพร่ภายใต้สัญญาอนุญาต
					</p>
				</div>
			</div>
		</footer>
	);
}

export function PublicMasthead() {
	const pathname = usePathname();
	if (pathname?.startsWith("/admin")) return null;
	return (
		<>
			<Masthead />
			<ResumeBar />
		</>
	);
}

export function PublicColophon() {
	const pathname = usePathname();
	if (pathname?.startsWith("/admin")) return null;
	return <Colophon />;
}
