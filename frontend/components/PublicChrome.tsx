"use client";
// Public masthead + colophon. Hidden on /admin/* so the admin shell can own
// the chrome there. Lives outside the root layout because it needs
// usePathname() (a client hook) — the rest of the layout stays a Server
// Component.

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountNav from "./AccountNav";

function Masthead() {
	const beYear = new Date().getFullYear() + 543;
	const issueDate = new Intl.DateTimeFormat("th-TH", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
		calendar: "buddhist",
	}).format(new Date());

	return (
		<header className="border-b border-rule">
			<div className="max-w-6xl mx-auto px-6 pt-6 pb-3 flex items-baseline justify-between text-[11px] uppercase tracking-[0.18em] text-muted">
				<span>ปีที่ ๑ — เล่มที่ {beYear}</span>
				<span className="hidden sm:inline">{issueDate}</span>
				<span>ราคา ๐ บาท</span>
			</div>
			<div className="max-w-6xl mx-auto px-6 pb-4">
				<Link href="/" className="block">
					<h1 className="font-display font-semibold leading-none tracking-[-0.03em] text-[clamp(2.6rem,7vw,5.5rem)]">
						สถาบัน<span className="italic font-normal text-oxblood">.</span>
					</h1>
				</Link>
			</div>
			<nav className="border-t border-rule">
				<div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
					<Link href="/" className="font-medium">หน้าแรก</Link>
					<Link href="/courses" className="lede">สารบัญคอร์ส</Link>
					<Link href="/account" className="lede">บัญชีของฉัน</Link>
					<Link href="/account/devices" className="lede">อุปกรณ์ที่อนุญาต</Link>
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
	return <Masthead />;
}

export function PublicColophon() {
	const pathname = usePathname();
	if (pathname?.startsWith("/admin")) return null;
	return <Colophon />;
}
