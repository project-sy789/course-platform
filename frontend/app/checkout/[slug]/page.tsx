"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError, getSlipInfo, uploadSlip, SlipInfo } from "@/lib/api";
import { formatTHB } from "@/lib/format";

type Course = {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
};

export default function CheckoutPage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [info, setInfo] = useState<SlipInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    apiFetch<Course>(`/api/v1/courses/${params.slug}`)
      .then(setCourse)
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/login");
        else setError(e.message);
      });
    getSlipInfo().then(setInfo).catch((e: ApiError) => setError(e.message));
  }, [params.slug, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !course) return;
    setBusy(true); setError(null);
    try {
      const r = await uploadSlip({ image: file, course_slug: course.slug });
      setResult({ status: r.status, message: r.message });
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        router.push("/login");
        return;
      }
      setError(e?.message ?? "อัปโหลดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (error && !course) return <main className="p-8 text-red-400">{error}</main>;
  if (!course || !info) return <main className="p-8 opacity-60">กำลังโหลด…</main>;

  if (result) {
    return (
      <main className="max-w-xl mx-auto p-8">
        <div className="rounded-xl border border-neutral-800 p-6 space-y-3">
          <h1 className="text-xl font-semibold">
            {result.status === "auto_approved" ? "ยืนยันการชำระเงินสำเร็จ" : "ได้รับสลิปแล้ว"}
          </h1>
          <p className="opacity-80">{result.message}</p>
          <div className="flex gap-2 pt-2">
            <Link
              href={`/courses/${course.slug}`}
              className="rounded-md bg-white text-black font-medium px-4 py-2"
            >
              ไปยังคอร์ส
            </Link>
            <Link href="/account" className="rounded-md border border-neutral-700 px-4 py-2">
              ดูสถานะการสั่งซื้อ
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto p-8 space-y-6">
      <Link href={`/courses/${course.slug}`} className="text-sm underline opacity-70">← กลับ</Link>

      <header>
        <h1 className="text-2xl font-semibold">ชำระเงิน</h1>
        <p className="opacity-70 mt-1">{course.title}</p>
        <p className="text-3xl font-semibold mt-3">{formatTHB(course.price_cents)}</p>
        <p className="text-xs opacity-50">รวมภาษีมูลค่าเพิ่ม 7% แล้ว</p>
      </header>

      <section className="rounded-xl border border-neutral-800 p-5 space-y-2">
        <h2 className="text-sm uppercase tracking-wide opacity-60">โอนเงินมาที่</h2>
        <dl className="text-sm grid grid-cols-[120px_1fr] gap-y-1">
          <dt className="opacity-60">ธนาคาร</dt><dd>{info.bank_name || "—"}</dd>
          <dt className="opacity-60">เลขบัญชี</dt>
          <dd className="font-mono">{info.account_number || "—"}</dd>
          <dt className="opacity-60">ชื่อบัญชี</dt><dd>{info.account_name || "—"}</dd>
          {info.promptpay_id && (
            <>
              <dt className="opacity-60">พร้อมเพย์</dt>
              <dd className="font-mono">{info.promptpay_id}</dd>
            </>
          )}
        </dl>
        <p className="text-xs opacity-50 pt-2">
          กรุณาโอนยอด <b>{formatTHB(course.price_cents)}</b> ให้ตรงตามจำนวน
          {info.auto_verify
            ? " ระบบจะตรวจสลิปอัตโนมัติและเปิดสิทธิ์ทันที"
            : " ทีมงานจะตรวจสอบและเปิดสิทธิ์ภายใน 24 ชั่วโมง"}
        </p>
      </section>

      <form onSubmit={submit} className="rounded-xl border border-neutral-800 p-5 space-y-3">
        <h2 className="text-sm uppercase tracking-wide opacity-60">แนบสลิป</h2>
        <input
          type="file" accept="image/png,image/jpeg,image/webp" required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-white"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit" disabled={!file || busy}
          className="w-full rounded-md bg-white text-black font-medium py-2 disabled:opacity-50"
        >
          {busy ? "กำลังอัปโหลด…" : "ส่งสลิป"}
        </button>
        <p className="text-xs opacity-50">
          รองรับไฟล์ JPG / PNG / WebP ขนาดไม่เกิน 4 MB
        </p>
      </form>
    </main>
  );
}
