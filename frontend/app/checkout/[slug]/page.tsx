"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError, getSlipInfo, uploadSlip, SlipInfo } from "@/lib/api";
import { formatTHB } from "@/lib/format";
import {
  Button, ErrorNote, KeyValue, Loading, Page, PageTitle, Section,
} from "@/components/ui";

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
      if (e instanceof ApiError && e.status === 401) { router.push("/login"); return; }
      setError(e?.message ?? "อัปโหลดไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  if (error && !course) return <Page width="narrow"><ErrorNote>{error}</ErrorNote></Page>;
  if (!course || !info) return <Page width="narrow"><Loading /></Page>;

  if (result) {
    return (
      <Page width="narrow">
        <div className="border-b border-rule pb-4 mb-6">
          <div className="text-[11px] uppercase tracking-[0.22em] text-oxblood mb-2">
            {result.status === "auto_approved" ? "ตรวจสอบสลิปอัตโนมัติ" : "รอเจ้าหน้าที่ตรวจ"}
          </div>
          <h1 className="font-display font-semibold text-[2.2rem] leading-none tracking-[-0.02em]">
            {result.status === "auto_approved" ? "ยืนยันการชำระเงินสำเร็จ" : "ได้รับสลิปแล้ว"}
          </h1>
        </div>
        <p className="text-[15px] leading-relaxed mb-6">{result.message}</p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/courses/${course.slug}`}
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] bg-ink text-paper border border-ink hover:bg-oxblood hover:border-oxblood transition">
            ไปยังคอร์ส →
          </Link>
          <Link href="/account"
            className="inline-block px-4 py-2 text-[13px] uppercase tracking-[0.14em] border border-rule hover:border-ink transition">
            ดูสถานะการสั่งซื้อ
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page width="column">
      <Link href={`/courses/${course.slug}`}
        className="text-[13px] text-muted underline underline-offset-4 decoration-1 inline-block mb-6">
        ← กลับสู่หน้าคอร์ส
      </Link>

      <PageTitle kicker="ชำระเงิน">{course.title}</PageTitle>

      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-7 space-y-10">
          <section>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-4">
              ขั้นที่ ๑ — โอนเงินมาที่
            </div>
            <dl className="border-t border-rule">
              <KeyValue k="ธนาคาร" v={info.bank_name || "—"} />
              <KeyValue k="เลขบัญชี" v={info.account_number || "—"} />
              <KeyValue k="ชื่อบัญชี" v={info.account_name || "—"} />
              {info.promptpay_id && (
                <KeyValue k="พร้อมเพย์" v={info.promptpay_id} />
              )}
            </dl>
            <p className="text-[13px] text-muted leading-relaxed mt-4">
              โอนยอด{" "}
              <span className="font-mono text-ink font-medium">
                {formatTHB(course.price_cents)}
              </span>{" "}
              ให้ตรงตามจำนวน
              {info.auto_verify
                ? " ระบบจะตรวจสลิปอัตโนมัติและเปิดสิทธิ์ทันทีหลังจากแนบสลิป"
                : " เจ้าหน้าที่จะตรวจสอบและเปิดสิทธิ์ภายใน ๒๔ ชั่วโมง"}
            </p>
          </section>

          <Section
            title="ขั้นที่ ๒ — แนบสลิป"
            hint="รองรับ JPG / PNG / WebP ขนาดไม่เกิน ๔ MB"
          >
            <form onSubmit={submit} className="space-y-5">
              <input
                type="file" accept="image/png,image/jpeg,image/webp" required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[14px] file:mr-4 file:border file:border-ink
                           file:bg-ink file:text-paper file:px-4 file:py-2
                           file:text-[12px] file:uppercase file:tracking-[0.14em]
                           file:cursor-pointer hover:file:bg-oxblood hover:file:border-oxblood"
              />
              {file && (
                <p className="text-[12px] text-muted font-mono">
                  เลือกแล้ว: {file.name}
                </p>
              )}
              <ErrorNote>{error}</ErrorNote>
              <Button type="submit" disabled={!file || busy}>
                {busy ? "กำลังอัปโหลด…" : "ส่งสลิปยืนยัน →"}
              </Button>
            </form>
          </Section>
        </div>

        <aside className="md:col-span-5 md:border-l md:border-rule md:pl-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-3">
            สรุปคำสั่งซื้อ
          </div>
          <p className="font-display text-[20px] leading-snug mb-6">
            {course.title}
          </p>
          <dl className="border-t border-rule">
            <KeyValue k="ราคาคอร์ส" v={formatTHB(course.price_cents)} />
            <KeyValue k="ภาษีมูลค่าเพิ่ม" v="รวมในราคาแล้ว" />
          </dl>
          <div className="mt-6 pt-6 border-t border-rule">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted mb-2">
              ยอดที่ต้องโอน
            </div>
            <p className="font-display text-[40px] leading-none font-mono tabular-nums">
              {formatTHB(course.price_cents)}
            </p>
          </div>
        </aside>
      </div>
    </Page>
  );
}
