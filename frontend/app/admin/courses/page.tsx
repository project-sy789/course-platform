"use client";
import { useEffect, useState, Fragment } from "react";
import Link from "next/link";
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
  price_baht: number;
  access_duration_days?: number | null;
  pixel_watermark?: boolean;
};

type EditForm = {
  title: string;
  description: string;
  price_baht: number;
  access_duration_days: string;
  pixel_watermark: boolean;
};

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    slug: "", title: "", description: "", price_baht: 0,
    access_duration_days: "" as string,
    pixel_watermark: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
        price_baht: Number(form.price_baht) || 0,
        access_duration_days: dur === "" ? null : Number(dur),
        pixel_watermark: form.pixel_watermark,
      });
      setForm({
        slug: "", title: "", description: "", price_baht: 0,
        access_duration_days: "", pixel_watermark: false,
      });
      await reload();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  function startEdit(c: Course) {
    setEditingSlug(c.slug);
    setEditError(null);
    setEditForm({
      title: c.title,
      description: c.description ?? "",
      price_baht: c.price_baht,
      access_duration_days: c.access_duration_days == null ? "" : String(c.access_duration_days),
      pixel_watermark: !!c.pixel_watermark,
    });
  }

  function cancelEdit() {
    setEditingSlug(null);
    setEditForm(null);
    setEditError(null);
  }

  async function saveEdit(slug: string) {
    if (!editForm) return;
    setEditBusy(true); setEditError(null);
    try {
      const dur = editForm.access_duration_days.trim();
      await adminApi.updateCourse(slug, {
        title: editForm.title,
        description: editForm.description,
        price_baht: Number(editForm.price_baht) || 0,
        access_duration_days: dur === "" ? null : Number(dur),
        pixel_watermark: editForm.pixel_watermark,
      });
      await reload();
      cancelEdit();
    } catch (e: any) { setEditError(e.message); }
    finally { setEditBusy(false); }
  }

  async function remove(slug: string, title: string) {
    if (!window.confirm(`ลบคอร์ส "${title}" ?\n\nระบบจะปฏิเสธหากมีผู้ใช้กำลังเรียนอยู่ — ต้องถอนสิทธิ์ก่อน`)) return;
    try {
      await adminApi.deleteCourse(slug);
      await reload();
    } catch (e: any) { window.alert(e.message); }
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
          <Field label="ราคา (บาท)" hint="กรอกเป็นจำนวนเต็ม · 0 = เรียนฟรี">
            <Input type="number" min={0} value={form.price_baht} className="font-mono"
              onChange={(e) => setForm({ ...form, price_baht: Number(e.target.value) })} />
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
            <TH className="text-right">จัดการ</TH>
          </THead>
          <tbody>
            {courses.map((c) => {
              const isEditing = editingSlug === c.slug;
              return (
                <Fragment key={c.id}>
                  <TR>
                    <TD className="font-mono text-[12px]">{c.slug}</TD>
                    <TD className="font-display text-[15px]">{c.title}</TD>
                    <TD className="font-mono">
                      {c.price_baht === 0 ? "ฟรี" : formatTHB(c.price_baht)}
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
                    <TD className="text-right whitespace-nowrap">
                      {isEditing ? (
                        <button
                          onClick={cancelEdit}
                          className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-1"
                        >
                          ยกเลิก
                        </button>
                      ) : (
                        <span className="inline-flex gap-x-4">
                          <Link
                            href={`/admin/courses/${c.slug}`}
                            className="text-[12px] text-ink hover:text-oxblood underline underline-offset-4 decoration-1"
                          >
                            บทเรียน →
                          </Link>
                          <button
                            onClick={() => startEdit(c)}
                            className="text-[12px] text-ink hover:text-oxblood underline underline-offset-4 decoration-1"
                          >
                            แก้ไข
                          </button>
                          <button
                            onClick={() => remove(c.slug, c.title)}
                            className="text-[12px] text-oxblood hover:underline underline-offset-4 decoration-1"
                          >
                            ลบ
                          </button>
                        </span>
                      )}
                    </TD>
                  </TR>
                  {isEditing && editForm && (
                    <tr key={c.id + "-edit"} className="bg-cream/40">
                      <td colSpan={6} className="px-4 py-5">
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 max-w-3xl">
                          <Field label="ชื่อคอร์ส">
                            <Input value={editForm.title}
                              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                          </Field>
                          <Field label="ราคา (บาท)">
                            <Input type="number" min={0} className="font-mono"
                              value={editForm.price_baht}
                              onChange={(e) => setEditForm({ ...editForm, price_baht: Number(e.target.value) })} />
                          </Field>
                          <div className="sm:col-span-2">
                            <Field label="คำอธิบาย">
                              <Textarea rows={2} value={editForm.description}
                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                            </Field>
                          </div>
                          <Field label="ระยะเวลาเข้าถึง (วัน)" hint="ว่าง = ตลอดชีพ">
                            <Input type="number" min={1} placeholder="ว่าง = ตลอดชีพ"
                              value={editForm.access_duration_days}
                              onChange={(e) => setEditForm({ ...editForm, access_duration_days: e.target.value })} />
                          </Field>
                          <label className="flex items-start gap-3 text-[14px] cursor-pointer pt-7">
                            <input
                              type="checkbox" checked={editForm.pixel_watermark}
                              onChange={(e) => setEditForm({ ...editForm, pixel_watermark: e.target.checked })}
                              className="mt-[5px] accent-oxblood w-4 h-4"
                            />
                            <span className="font-display text-[15px]">ฝังลายน้ำในพิกเซล</span>
                          </label>
                        </div>
                        <ErrorNote>{editError}</ErrorNote>
                        <div className="flex gap-3 mt-4">
                          <Button disabled={editBusy} onClick={() => saveEdit(c.slug)}>
                            {editBusy ? "…" : "บันทึก →"}
                          </Button>
                          <button
                            onClick={cancelEdit}
                            className="text-[13px] text-muted hover:text-ink underline underline-offset-4 decoration-1"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {courses.length === 0 && (
              <TR>
                <TD colSpan={6} className="text-muted italic text-center">
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
