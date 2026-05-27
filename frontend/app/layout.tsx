import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Serif, IBM_Plex_Mono, Sarabun } from "next/font/google";

const display = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const sans = Sarabun({
  subsets: ["latin", "thai"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "สถาบัน · Course Platform",
  description: "คอร์สเรียนภาษาไทย ระบบรักษาวิดีโอแบบครบวงจร",
};

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
          <Link href="/login" className="lede">เข้าสู่ระบบ →</Link>
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-paper text-ink font-sans">
        <Masthead />
        {children}
        <Colophon />
      </body>
    </html>
  );
}
