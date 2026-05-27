import Link from "next/link";

export default function NotFound() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-24">
      <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-oxblood mb-6">
        ๔๐๔ — ไม่พบหน้านี้ในสารบัญ
      </div>
      <h1 className="font-display font-semibold text-[clamp(2.6rem,6vw,4.4rem)] leading-[0.95] tracking-[-0.02em] mb-6">
        หน้านี้ยัง<span className="italic font-normal text-oxblood">ไม่ได้</span>ตีพิมพ์
      </h1>
      <p className="lede max-w-xl mb-10 text-[17px]">
        ที่อยู่ที่ท่านเรียกอาจถูกย้าย ลบ
        หรือพิมพ์ผิด — บรรณาธิการขออภัยในความไม่สะดวก
      </p>
      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-rule pt-6 text-[14px]">
        <Link href="/" className="lede">← กลับหน้าแรก</Link>
        <Link href="/courses" className="lede">สารบัญคอร์ส</Link>
        <Link href="/account" className="lede">บัญชีของฉัน</Link>
      </div>
    </main>
  );
}
