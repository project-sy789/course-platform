"use client";
import Link from "next/link";

export default function PaymentSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-emerald-700 bg-emerald-950/30 p-6 text-center">
        <h1 className="text-xl font-semibold mb-2">ได้รับการชำระเงินแล้ว</h1>
        <p className="opacity-80 mb-4">
          ระบบกำลังเปิดสิทธิ์เข้าเรียนให้คุณ ใช้เวลาประมาณไม่กี่วินาที
        </p>
        <Link href="/" className="underline">ดูคอร์สทั้งหมด</Link>
      </div>
    </main>
  );
}
