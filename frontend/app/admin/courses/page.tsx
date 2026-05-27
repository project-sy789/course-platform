"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { adminApi } from "@/lib/admin";
import { formatTHB } from "@/lib/format";
import {
  Button, ErrorNote, Field, Input, Page, PageTitle, Pill, Section,
  TD, TH, THead, TR, Table, Textarea,
} from "@/components/ui";

type Course = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
  access_duration_days?: number | null;
  pixel_watermark?: boolean;
};

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    slug: "", title: "", description: "", price_cents: 0,
    access_duration_days: "" as string,
    pixel_watermark: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    apiFetch<Course[]>("/api/v1/courses").then(setCourses).catch(() => setCourses([]));

  useEffect(() => { reload(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const dur = form.access_duration_days.trim();
      await adminApi.createCourse({
        slug: form.slug,
        title: form.title,
        description: form.description || undefined,
        price_cents: Number(form.price_cents) || 0,
        access_duration_days: dur === "" ? null : Number(dur),
        pixel_watermark: form.pixel_watermark,
      });
      setForm({
        slug: "", title: "", description: "", price_cents: 0,
        access_duration_days: "", pixel_watermark: false,
      });
      await reload();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageTitle kicker="กองบรรณาธิการ">คอร์ส</PageTitle>

      <Section
        title="สร้างคอร์สใหม่"
        hint="เผยแพร่คอร์สเป็นการเริ่มต้น — บทเรียนและวิดีโอเพิ่มได้ในขั้นถัดไป"
      >
        <form onSubmit={submit} className="space-y-5 max-w-xl">
          <Field label="Slug" hint="ตัวระบุใน URL เช่น thai-history-modern">
            <Input required value={form.slug} className="font-mono"
              onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </Field>
          <Field label="ชื่อคอร์ส">
            <Input required value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="คำอธิบาย" hint="ไม่บังคับ — ใช้แสดงบนหน้าคอร์ส">
            <Textarea rows={3} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="ราคา (สตางค์)" hint="๑๐๐ สตางค์ = ๑ บาท · กรอก 0 เพื่อให้เรียนฟรี">
            <Input type="number" min={0} value={form.price_cents} className="font-mono"
              onChange={(e) => setForm({ ...form, price_cents: Number(e.target.value) })} />
          </Field>
          <Field label="ระยะเวลาเข้าถึง (วัน)" hint="ปล่อยว่างเพื่อให้เข้าถึงได้ตลอดชีพ">
            <Input type="number" min={1} placeholder="ว่าง = ตลอดชีพ"
              value={form.access_duration_days}
              onChange={(e) => setForm({ ...form, access_duration_days: e.target.value })} />
          </Field>

          <label className="flex items-start gap-3 text-[14px] cursor-pointer pt-2">
            <input
              type="checkbox" checked={form.pixel_watermark}
              onChange={(e) => setForm({ ...form, pixel_watermark: e.target.checked })}
              className="mt-[5px] accent-oxblood w-4 h-4"
            />
            <span>
              <span className="font-display text-[16px]">
                ฝังลายน้ำลงในพิกเซลวิดีโอ
              </span>
              <span className="block text-[12px] text-muted mt-1 leading-snug max-w-prose">
                ลายน้ำจะติดไปกับการบันทึกหน้าจอด้วย
                แต่กิน CPU และแบตเตอรี่มากกว่าประมาณร้อยละ ๓๐
                และปิดการเร่งฮาร์ดแวร์ — แนะนำเฉพาะคอร์สที่มีมูลค่าสูง
              </span>
            </span>
          </label>

          <ErrorNote>{error}</ErrorNote>
          <Button disabled={busy}>{busy ? "…" : "สร้างคอร์ส →"}</Button>
        </form>
      </Section>

      <Section
        title="คอร์สทั้งหมด"
        hint={`${courses.length} รายการในระบบ`}
      >
        <Table>
          <THead>
            <TH>Slug</TH>
            <TH>ชื่อคอร์ส</TH>
            <TH>ราคา</TH>
            <TH>เข้าถึง</TH>
            <TH>ลายน้ำ</TH>
          </THead>
          <tbody>
            {courses.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-[12px]">{c.slug}</TD>
                <TD className="font-display text-[15px]">{c.title}</TD>
                <TD className="font-mono">
                  {c.price_cents === 0 ? "ฟรี" : formatTHB(c.price_cents)}
                </TD>
                <TD>
                  {c.access_duration_days == null
                    ? "ตลอดชีพ"
                    : `${c.access_duration_days} วัน`}
                </TD>
                <TD>
                  {c.pixel_watermark
                    ? <Pill tone="ok">เปิด</Pill>
                    : <Pill tone="neutral">ปิด</Pill>}
                </TD>
              </TR>
            ))}
            {courses.length === 0 && (
              <TR>
                <TD colSpan={5} className="text-muted italic text-center">
                  ยังไม่มีคอร์ส
                </TD>
              </TR>
            )}
          </tbody>
        </Table>
      </Section>
    </Page>
  );
}
